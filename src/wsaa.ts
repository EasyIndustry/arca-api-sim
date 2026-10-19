import { randomBytes, randomInt } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { leerCms } from "./cms.js";
import { isoArgentina } from "./fechas.js";
import { escapar, fault, sobre, texto, type PedidoSoap } from "./soap.js";
import type { Contexto, RespuestaSoap } from "./contexto.js";

// WSAA (LoginCms). Recibe el TRA firmado en CMS y devuelve un Ticket de Acceso (TA)
// con token y sign. Los codigos de falla son los de la especificacion de WSAA.

const NS_AXIS = "http://xml.apache.org/axis/";
const NS_RESPUESTA = "http://wsaa.view.sua.dvadac.desein.afip.gov";
const SERVICIOS = new Set(["wsfe"]);

const parserTra = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: true });

function falla(p: PedidoSoap, codigo: string, mensaje: string): RespuestaSoap {
  return { status: 500, xml: fault(p.version, `ns1:${codigo}`, mensaje, NS_AXIS) };
}

export function loginCms(p: PedidoSoap, ctx: Contexto): RespuestaSoap {
  if (p.operacion !== "loginCms") {
    return falla(p, "Server.userException", `Operacion no soportada por WSAA: ${p.operacion}`);
  }
  const in0 = texto(p.parametros.in0);
  if (!in0) return falla(p, "cms.bad", "No se recibio el CMS (parametro in0)");

  let cms;
  try {
    cms = leerCms(in0);
  } catch (e) {
    return falla(p, "cms.bad", `CMS invalido: ${(e as Error).message}`);
  }

  let tra: Record<string, unknown>;
  try {
    const doc = parserTra.parse(cms.tra) as Record<string, unknown>;
    tra = doc.loginTicketRequest as Record<string, unknown>;
    if (!tra || typeof tra !== "object") throw new Error();
  } catch {
    return falla(p, "xml.bad", "No se ha podido interpretar el XML contra el SCHEMA");
  }

  const header = (tra.header ?? {}) as Record<string, unknown>;
  const servicio = texto(tra.service);
  const generacion = new Date(texto(header.generationTime) ?? "");
  const expiracion = new Date(texto(header.expirationTime) ?? "");
  const ahora = ctx.ahora();

  if (!servicio || !texto(header.uniqueId)) {
    return falla(p, "xml.bad", "No se ha podido interpretar el XML contra el SCHEMA");
  }
  // WSAA tolera unos minutos de desfase de reloj; mas que eso es un generationTime invalido.
  if (Number.isNaN(generacion.getTime()) || generacion.getTime() > ahora.getTime() + 10 * 60_000) {
    return falla(p, "xml.generationTime.invalid", "generationTime posee formato o dato inválido");
  }
  if (Number.isNaN(expiracion.getTime()) || expiracion <= generacion) {
    return falla(p, "xml.expirationTime.invalid", "expirationTime posee formato o dato inválido");
  }
  if (expiracion <= ahora) {
    return falla(p, "xml.expirationTime.expired", "expirationTime expiró");
  }
  if (!SERVICIOS.has(servicio)) {
    return falla(p, "wsn.notFound", `Servicio informado inexistente (el simulador solo implementa wsfe): ${servicio}`);
  }
  if (ctx.config.taUnico && ctx.store.ticketVigente(cms.huellaCert, servicio, ahora)) {
    return falla(p, "coe.alreadyAuthenticated", "El CEE ya posee un TA valido para el acceso al WSN solicitado");
  }

  const vence = new Date(ahora.getTime() + ctx.config.horasVigenciaTa * 3_600_000);
  const uniqueId = String(randomInt(1, 2 ** 31 - 1));
  const origen = "CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239";
  const destino = cms.sujeto ?? "CN=desconocido";
  const tokenXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sso version="2.0"><id src="${escapar(origen)}" dst="CN=${servicio}, O=AFIP, C=AR" unique_id="${uniqueId}" ` +
    `gen_time="${Math.floor(ahora.getTime() / 1000)}" exp_time="${Math.floor(vence.getTime() / 1000)}"/>` +
    `<operation type="login" value="granted"><login entity="33693450239" service="${servicio}" ` +
    `uid="${escapar(destino)}" authmethod="cms" regmethod="22">` +
    `<relations><relation key="${cms.cuit ?? "0"}" reltype="4"/></relations></login></operation>` +
    `<simulador>arca-api-sim ${randomBytes(8).toString("hex")} - sin validez fiscal</simulador></sso>`;
  const token = Buffer.from(tokenXml).toString("base64");
  const sign = randomBytes(128).toString("base64");

  ctx.store.agregarTicket(
    {
      token,
      sign,
      servicio,
      cuit: cms.cuit,
      huellaCert: cms.huellaCert,
      emitido: ahora.toISOString(),
      vence: vence.toISOString(),
    },
    ahora
  );

  const ta =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<loginTicketResponse version="1.0"><header>` +
    `<source>${escapar(origen)}</source><destination>${escapar(destino)}</destination>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${isoArgentina(ahora)}</generationTime><expirationTime>${isoArgentina(vence)}</expirationTime>` +
    `</header><credentials><token>${token}</token><sign>${sign}</sign></credentials></loginTicketResponse>`;

  return {
    status: 200,
    xml: sobre(p.version, `<loginCmsResponse xmlns="${NS_RESPUESTA}"><loginCmsReturn>${escapar(ta)}</loginCmsReturn></loginCmsResponse>`),
  };
}
