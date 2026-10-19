import { X509Certificate, createHash } from "node:crypto";

// Lectura del CMS (PKCS#7 SignedData) que llega a WSAA.loginCms. No se verifica la
// firma -- el simulador acepta cualquier certificado --, pero si se extrae el TRA
// firmado y el certificado, para poder validar el TRA y saber que CUIT lo pidio.

interface Nodo {
  tag: number;
  construido: boolean;
  inicio: number; // offset del tag
  inicioContenido: number;
  fin: number; // offset despues del ultimo byte (incluye el 00 00 si es indefinido)
  hijos: Nodo[];
}

function leerNodo(buf: Buffer, pos: number): Nodo {
  const inicio = pos;
  if (pos + 2 > buf.length) throw new Error("DER truncado");
  const tag = buf[pos++];
  if ((tag & 0x1f) === 0x1f) throw new Error("tags multibyte no soportados");
  const construido = (tag & 0x20) !== 0;
  let largo = buf[pos++];
  let indefinido = false;
  if (largo === 0x80) {
    indefinido = true;
  } else if (largo & 0x80) {
    const n = largo & 0x7f;
    if (n > 4 || pos + n > buf.length) throw new Error("largo DER invalido");
    largo = 0;
    for (let i = 0; i < n; i++) largo = largo * 256 + buf[pos++];
  }
  const inicioContenido = pos;
  const hijos: Nodo[] = [];
  if (indefinido) {
    if (!construido) throw new Error("largo indefinido en tipo primitivo");
    while (!(buf[pos] === 0 && buf[pos + 1] === 0)) {
      const h = leerNodo(buf, pos);
      hijos.push(h);
      pos = h.fin;
      if (pos + 2 > buf.length) throw new Error("BER indefinido sin cierre");
    }
    return { tag, construido, inicio, inicioContenido, fin: pos + 2, hijos };
  }
  const fin = inicioContenido + largo;
  if (fin > buf.length) throw new Error("DER truncado");
  if (construido) {
    while (pos < fin) {
      const h = leerNodo(buf, pos);
      hijos.push(h);
      pos = h.fin;
    }
  }
  return { tag, construido, inicio, inicioContenido, fin, hijos };
}

/** Contenido de un OCTET STRING, sea primitivo o construido por partes (BER). */
function octetos(buf: Buffer, n: Nodo): Buffer {
  if (!n.construido) return buf.subarray(n.inicioContenido, n.fin);
  return Buffer.concat(n.hijos.map((h) => octetos(buf, h)));
}

export interface CmsLeido {
  tra: string;
  cuit: string | null;
  sujeto: string | null;
  huellaCert: string;
}

export function leerCms(base64: string): CmsLeido {
  const buf = Buffer.from(base64.replace(/\s+/g, ""), "base64");
  if (buf.length === 0) throw new Error("CMS vacio");

  let tra: string | null = null;
  let certDer: Buffer | null = null;
  try {
    const contentInfo = leerNodo(buf, 0);
    const signedData = contentInfo.hijos[1]?.hijos[0];
    if (!signedData) throw new Error("no es SignedData");
    // version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
    const encap = signedData.hijos[2];
    const eContent = encap?.hijos[1]?.hijos[0];
    if (eContent) tra = octetos(buf, eContent).toString("utf8");
    const certs = signedData.hijos.find((h, i) => i > 2 && h.tag === 0xa0);
    const primero = certs?.hijos[0];
    if (primero) certDer = buf.subarray(primero.inicio, primero.fin);
  } catch {
    // Si la estructura no es la esperada se intenta igual encontrar el TRA como texto.
  }
  if (!tra) {
    const plano = buf.toString("latin1");
    const m = plano.match(/<\?xml[\s\S]*?<\/loginTicketRequest>|<loginTicketRequest[\s\S]*?<\/loginTicketRequest>/);
    if (m) tra = Buffer.from(m[0], "latin1").toString("utf8");
  }
  if (!tra) throw new Error("No se encontro el TRA (loginTicketRequest) dentro del CMS");

  let cuit: string | null = null;
  let sujeto: string | null = null;
  let huellaCert = createHash("sha256").update(buf).digest("hex");
  if (certDer) {
    try {
      const cert = new X509Certificate(certDer);
      sujeto = cert.subject.replace(/\n/g, ", ");
      cuit = cert.subject.match(/CUIT\s*(\d{11})/i)?.[1] ?? null;
      huellaCert = cert.fingerprint256;
    } catch {
      // certificado ilegible: se sigue sin CUIT
    }
  }
  return { tra, cuit, sujeto, huellaCert };
}
