import { XMLParser } from "fast-xml-parser";

// Lo minimo de SOAP que hace falta para hablar como ARCA: leer el sobre (1.1 o 1.2),
// sacar la operacion y sus parametros, y armar la respuesta con el mismo sobre.

export const NS_SOAP11 = "http://schemas.xmlsoap.org/soap/envelope/";
export const NS_SOAP12 = "http://www.w3.org/2003/05/soap-envelope";

export type VersionSoap = "1.1" | "1.2";

// Elementos que pueden repetirse: se parsean siempre como array aunque venga uno solo.
const REPETIBLES = new Set([
  "FECAEDetRequest",
  "AlicIva",
  "CbteAsoc",
  "Tributo",
  "Opcional",
  "Comprador",
  "Actividad",
]);

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (nombre) => REPETIBLES.has(nombre),
});

export interface PedidoSoap {
  version: VersionSoap;
  operacion: string;
  parametros: Record<string, unknown>;
}

export class ErrorSoap extends Error {}

export function parsearPedido(cuerpo: string, contentType: string | undefined): PedidoSoap {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(cuerpo) as Record<string, unknown>;
  } catch {
    throw new ErrorSoap("El cuerpo no es XML valido");
  }
  const sobre = doc.Envelope as Record<string, unknown> | undefined;
  const body = sobre?.Body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") throw new ErrorSoap("No se encontro soap:Envelope/soap:Body");
  const operacion = Object.keys(body)[0];
  if (!operacion) throw new ErrorSoap("soap:Body vacio");
  const crudo = body[operacion];
  const version: VersionSoap =
    cuerpo.includes(NS_SOAP12) || (contentType ?? "").includes("application/soap+xml") ? "1.2" : "1.1";
  return {
    version,
    operacion,
    parametros: crudo && typeof crudo === "object" ? (crudo as Record<string, unknown>) : {},
  };
}

// --- Serializacion ---

export type ValorXml = string | number | boolean | null | undefined | NodoXml | ValorXml[];
export interface NodoXml {
  [hijo: string]: ValorXml;
}

export function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Serializa {nombre: valor}. Los arrays repiten el elemento; undefined/null se omiten. */
export function aXml(nombre: string, valor: ValorXml): string {
  if (valor === undefined || valor === null) return "";
  if (Array.isArray(valor)) return valor.map((v) => aXml(nombre, v)).join("");
  if (typeof valor === "object") {
    const hijos = Object.entries(valor)
      .map(([k, v]) => aXml(k, v))
      .join("");
    return `<${nombre}>${hijos}</${nombre}>`;
  }
  return `<${nombre}>${escapar(String(valor))}</${nombre}>`;
}

export function sobre(version: VersionSoap, cuerpo: string): string {
  const ns = version === "1.2" ? NS_SOAP12 : NS_SOAP11;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<soap:Body>${cuerpo}</soap:Body></soap:Envelope>`
  );
}

export function fault(version: VersionSoap, codigo: string, mensaje: string, nsCodigo?: string): string {
  const xmlnsCodigo = nsCodigo ? ` xmlns:ns1="${nsCodigo}"` : "";
  const cuerpo =
    version === "1.2"
      ? `<soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value><soap:Subcode><soap:Value${xmlnsCodigo}>${escapar(codigo)}</soap:Value></soap:Subcode></soap:Code><soap:Reason><soap:Text xml:lang="es">${escapar(mensaje)}</soap:Text></soap:Reason></soap:Fault>`
      : `<soap:Fault><faultcode${xmlnsCodigo}>${escapar(codigo)}</faultcode><faultstring>${escapar(mensaje)}</faultstring></soap:Fault>`;
  return sobre(version, cuerpo);
}

export function contentTypeRespuesta(version: VersionSoap): string {
  return version === "1.2" ? "application/soap+xml; charset=utf-8" : "text/xml; charset=utf-8";
}

/** Primer valor de texto de un nodo parseado (los repetibles vienen como array). */
export function texto(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return texto(v[0]);
  if (typeof v === "object") return undefined;
  return String(v);
}
