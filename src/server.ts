import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { cargarConfig, type Config } from "./config.js";
import { Escenarios } from "./escenarios.js";
import { Store } from "./store.js";
import type { Contexto, RespuestaSoap } from "./contexto.js";
import { ErrorSoap, contentTypeRespuesta, fault, parsearPedido } from "./soap.js";
import { loginCms } from "./wsaa.js";
import { atenderWsfe } from "./wsfe/servicio.js";
import { registrarAdmin } from "./admin.js";

// Mismas rutas que ARCA, para que pasar a homologacion/produccion sea cambiar solo el host:
//   WSAA  https://wsaahomo.afip.gov.ar/ws/services/LoginCms   ->  http://<sim>/ws/services/LoginCms
//   WSFE  https://wswhomo.afip.gov.ar/wsfev1/service.asmx     ->  http://<sim>/wsfev1/service.asmx
export const RUTA_WSAA = "/ws/services/LoginCms";
export const RUTA_WSFE = "/wsfev1/service.asmx";

const dirWsdl = fileURLToPath(new URL("../wsdl/", import.meta.url));
const WSDL_WSAA = readFileSync(`${dirWsdl}wsaa.wsdl`, "utf8");
const WSDL_WSFE = readFileSync(`${dirWsdl}wsfe.wsdl`, "utf8");

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpcionesApp {
  config?: Partial<Config>;
  ahora?: () => Date;
  logger?: boolean;
}

export function crearApp(opciones: OpcionesApp = {}): { app: FastifyInstance; ctx: Contexto } {
  const config = cargarConfig(opciones.config);
  const ctx: Contexto = {
    config,
    store: new Store(config.archivoDatos),
    escenarios: new Escenarios(),
    ahora: opciones.ahora ?? (() => new Date()),
  };
  const app = Fastify({ logger: opciones.logger ?? false, trustProxy: true, bodyLimit: 5 * 1024 * 1024 });

  // SOAP llega como text/xml (1.1) o application/soap+xml (1.2); se recibe como texto.
  app.addContentTypeParser(["text/xml", "application/soap+xml", "application/xml"], { parseAs: "string" }, (_req, body, done) =>
    done(null, body)
  );

  const baseUrl = (req: FastifyRequest) => `${req.protocol}://${req.headers.host ?? `localhost:${config.puerto}`}`;
  const tieneWsdl = (req: FastifyRequest) => Object.keys(req.query as object).some((k) => k.toLowerCase() === "wsdl");

  function enviarWsdl(req: FastifyRequest, reply: FastifyReply, wsdl: string, ruta: string, original: RegExp) {
    reply.type("text/xml; charset=utf-8").send(wsdl.replace(original, `location="${baseUrl(req)}${ruta}"`));
  }

  async function atenderSoap(
    servicio: "wsaa" | "wsfe",
    req: FastifyRequest,
    reply: FastifyReply,
    atender: (p: ReturnType<typeof parsearPedido>, e: ReturnType<Escenarios["tomar"]>) => RespuestaSoap
  ) {
    let pedido;
    try {
      pedido = parsearPedido(String(req.body ?? ""), req.headers["content-type"]);
    } catch (e) {
      const msg = e instanceof ErrorSoap ? e.message : "Pedido SOAP invalido";
      return reply.code(500).type(contentTypeRespuesta("1.1")).send(fault("1.1", "soap:Client", msg));
    }
    if (config.latenciaMs > 0) await esperar(config.latenciaMs);

    const escenario = ctx.escenarios.tomar(servicio, pedido.operacion);
    if (escenario) req.log.info({ escenario }, "aplicando escenario forzado");
    if (escenario?.tipo === "caido") {
      return reply.code(503).type("text/html").send("<html><body><h1>503 Service Unavailable</h1></body></html>");
    }
    if (escenario?.tipo === "timeout") await esperar(escenario.demoraMs ?? 30_000);
    if (servicio === "wsaa" && escenario?.tipo === "error") {
      const r = fault(
        pedido.version,
        "ns1:wsn.unavailable",
        escenario.mensaje ?? "El servicio al que se desea acceder se encuentra momentáneamente fuera de servicio",
        "http://xml.apache.org/axis/"
      );
      return reply.code(500).type(contentTypeRespuesta(pedido.version)).send(r);
    }

    const r = atender(pedido, escenario);
    return reply.code(r.status).type(contentTypeRespuesta(pedido.version)).send(r.xml);
  }

  app.get(RUTA_WSAA, async (req, reply) => {
    if (!tieneWsdl(req)) return reply.code(404).send("Agregar ?wsdl para obtener el WSDL de WSAA");
    enviarWsdl(req, reply, WSDL_WSAA, RUTA_WSAA, /location="https:\/\/wsaahomo\.afip\.gov\.ar\/ws\/services\/LoginCms"/);
  });
  app.post(RUTA_WSAA, (req, reply) => atenderSoap("wsaa", req, reply, (p) => loginCms(p, ctx)));

  app.get(RUTA_WSFE, async (req, reply) => {
    if (!tieneWsdl(req)) return reply.code(404).send("Agregar ?WSDL para obtener el WSDL de WSFEv1");
    enviarWsdl(req, reply, WSDL_WSFE, RUTA_WSFE, /location="https:\/\/wswhomo\.afip\.gov\.ar\/wsfev1\/service\.asmx"/g);
  });
  app.post(RUTA_WSFE, (req, reply) => atenderSoap("wsfe", req, reply, (p, e) => atenderWsfe(p, ctx, e)));

  app.get("/health", async () => ({ ok: true, simulador: true }));

  registrarAdmin(app, ctx);

  return { app, ctx };
}
