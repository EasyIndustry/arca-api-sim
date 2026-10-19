import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import soap from "soap";
import { crearApp, RUTA_WSAA, RUTA_WSFE } from "../src/server.js";
import type { Config } from "../src/config.js";

export const CUIT_EMISOR = "20409378472";
export const CUIT_RECEPTOR = "20111111112";

const dir = mkdtempSync(join(tmpdir(), "arca-sim-test-"));

/** Certificado autofirmado con el CUIT en el serialNumber, como los de ARCA. */
export function generarCertificado(cuit: string, nombre = "sim") {
  const key = join(dir, `${nombre}.key`);
  const crt = join(dir, `${nombre}.crt`);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
    "-keyout", key, "-out", crt, "-subj", `/C=AR/O=Test/CN=${nombre}/serialNumber=CUIT ${cuit}`,
  ], { stdio: "ignore" });
  return { key, crt };
}

/** Arma y firma el TRA en CMS (lo mismo que hace cualquier cliente de WSAA). */
export function firmarTra(cert: { key: string; crt: string }, servicio = "wsfe", ahora = new Date()): string {
  const gen = new Date(ahora.getTime() - 60_000).toISOString();
  const exp = new Date(ahora.getTime() + 10 * 60_000).toISOString();
  const tra =
    `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId><generationTime>${gen}</generationTime>` +
    `<expirationTime>${exp}</expirationTime></header><service>${servicio}</service></loginTicketRequest>`;
  const entrada = join(dir, `tra-${Math.random().toString(36).slice(2)}.xml`);
  writeFileSync(entrada, tra);
  const der = execFileSync("openssl", [
    "cms", "-sign", "-in", entrada, "-signer", cert.crt, "-inkey", cert.key, "-nodetach", "-outform", "DER",
  ]);
  return der.toString("base64");
}

export async function levantar(config: Partial<Config> = {}, ahora?: () => Date) {
  const { app, ctx } = crearApp({ config: { archivoDatos: "memory", ...config }, ahora });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  // Clientes SOAP genericos, armados a partir del WSDL que sirve el simulador.
  const wsaa = await soap.createClientAsync(`${url}${RUTA_WSAA}?wsdl`);
  const wsfe = await soap.createClientAsync(`${url}${RUTA_WSFE}?WSDL`);
  return { app, ctx, url, wsaa, wsfe, cerrar: () => app.close() };
}

export async function login(wsaa: soap.Client, cms: string) {
  const [res] = await wsaa.loginCmsAsync({ in0: cms });
  const ta: string = res.loginCmsReturn;
  const token = ta.match(/<token>([^<]+)<\/token>/)![1];
  const sign = ta.match(/<sign>([^<]+)<\/sign>/)![1];
  return { ta, token, sign };
}

export function leer(path: string) {
  return readFileSync(path, "utf8");
}

export function facturaB(nro: number, extra: Record<string, unknown> = {}) {
  return {
    Concepto: 2,
    DocTipo: 99,
    DocNro: 0,
    CbteDesde: nro,
    CbteHasta: nro,
    ImpTotal: 121,
    ImpTotConc: 0,
    ImpNeto: 100,
    ImpOpEx: 0,
    ImpTrib: 0,
    ImpIVA: 21,
    FchServDesde: hoy(),
    FchServHasta: hoy(),
    FchVtoPago: hoy(),
    MonId: "PES",
    MonCotiz: 1,
    CondicionIVAReceptorId: 5,
    Iva: { AlicIva: [{ Id: 5, BaseImp: 100, Importe: 21 }] },
    ...extra,
  };
}

export function hoy(d = new Date()) {
  const ar = new Date(d.getTime() - 3 * 3_600_000);
  return ar.toISOString().slice(0, 10).replace(/-/g, "");
}

export function pedido(auth: { token: string; sign: string }, cbteTipo: number, dets: Record<string, unknown>[], ptoVta = 1) {
  return {
    Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_EMISOR },
    FeCAEReq: {
      FeCabReq: { CantReg: dets.length, PtoVta: ptoVta, CbteTipo: cbteTipo },
      FeDetReq: { FECAEDetRequest: dets },
    },
  };
}
