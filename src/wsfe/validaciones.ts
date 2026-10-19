import { cuitValido } from "../cuit.js";
import { aaaammdd, diasEntre, parseAaaammdd } from "../fechas.js";
import { texto } from "../soap.js";
import type { Contexto } from "../contexto.js";
import {
  ALICUOTAS_IVA,
  CONCEPTOS,
  CONDICIONES_IVA_RECEPTOR,
  DOC_CUIL,
  DOC_CUIT,
  DOC_DNI,
  DOC_OTRO,
  MONEDAS,
  TIPOS_CBTE,
  TIPOS_DOC,
  type TipoCbte,
} from "./catalogos.js";
import { E, type Mensaje } from "./errores.js";

// Validaciones de un FECAEDetRequest. Devuelven observaciones: si hay alguna, el
// comprobante se rechaza (Resultado "R") y no consume numero, igual que en ARCA.

const TOLERANCIA = 0.01;

export function num(v: unknown): number {
  const t = texto(v);
  if (t === undefined || t.trim() === "") return NaN;
  return Number(t);
}

const iguales = (a: number, b: number) => Math.abs(a - b) <= TOLERANCIA + 1e-9;

function lista(v: unknown, hijo: string): Record<string, unknown>[] {
  if (!v || typeof v !== "object") return [];
  const x = (v as Record<string, unknown>)[hijo];
  if (Array.isArray(x)) return x as Record<string, unknown>[];
  return x && typeof x === "object" ? [x as Record<string, unknown>] : [];
}

export interface EntradaValidacion {
  det: Record<string, unknown>;
  cuit: string;
  ptoVta: number;
  tipo: TipoCbte;
  numeroEsperado: number;
  fechaUltimo: string | undefined;
  hoy: string;
}

export function validarDetalle(e: EntradaValidacion, ctx: Contexto): Mensaje[] {
  const obs: Mensaje[] = [];
  const { det, tipo } = e;
  const clase = tipo.clase;

  // Concepto
  const concepto = num(det.Concepto);
  if (!CONCEPTOS.some((c) => c.id === concepto)) obs.push(E.conceptoInvalido());

  // Receptor
  const docTipo = num(det.DocTipo);
  const docNroTexto = texto(det.DocNro) ?? "";
  const docNro = Number(docNroTexto);
  if (!TIPOS_DOC.some((d) => d.id === docTipo)) {
    obs.push(E.docTipoInvalido());
  } else if (docTipo === DOC_CUIT || docTipo === DOC_CUIL) {
    if (!cuitValido(docNroTexto)) obs.push(E.docNroInvalido());
  } else if (docTipo === DOC_DNI) {
    if (!/^\d{7,8}$/.test(docNroTexto)) obs.push(E.docNroInvalido());
  } else if (!/^\d+$/.test(docNroTexto)) {
    obs.push(E.docNroInvalido());
  }
  if (clase === "A" && docTipo !== DOC_CUIT) obs.push(E.claseARequiereCuit());

  // Condicion frente al IVA del receptor (RG 5616)
  const condTexto = texto(det.CondicionIVAReceptorId);
  if (condTexto === undefined || condTexto === "") {
    if (ctx.config.condicionIvaObligatoria) obs.push(E.condicionIvaObligatoria());
  } else {
    const cond = CONDICIONES_IVA_RECEPTOR.find((c) => c.id === Number(condTexto));
    if (!cond) obs.push(E.condicionIvaInvalida());
    else if (!cond.clases.includes(clase)) obs.push(E.condicionIvaClase(clase));
  }

  // Numeracion
  const desde = num(det.CbteDesde);
  const hasta = num(det.CbteHasta);
  if (desde !== hasta) obs.push(E.rangoInvalido());
  else if (desde !== e.numeroEsperado) obs.push(E.noCorrelativo());

  // Fechas
  const cbteFch = texto(det.CbteFch) || e.hoy;
  if (!parseAaaammdd(cbteFch)) {
    obs.push(E.fechaInvalida());
  } else {
    const margen = concepto === 1 ? 5 : 10;
    if (Math.abs(diasEntre(e.hoy, cbteFch)) > margen) obs.push(E.fechaFueraDeRango(margen));
    if (e.fechaUltimo && diasEntre(e.fechaUltimo, cbteFch) < 0) obs.push(E.fechaAnteriorAlUltimo());
  }
  if (concepto === 2 || concepto === 3) {
    const fd = texto(det.FchServDesde);
    const fh = texto(det.FchServHasta);
    const fv = texto(det.FchVtoPago);
    if (!parseAaaammdd(fd) || !parseAaaammdd(fh) || !parseAaaammdd(fv)) {
      obs.push(E.fechasServicioObligatorias());
    } else {
      if (diasEntre(fd!, fh!) < 0) obs.push(E.fechasServicioInvalidas());
      if (parseAaaammdd(cbteFch) && diasEntre(cbteFch, fv!) < 0) obs.push(E.vtoPagoAnterior());
    }
  }

  // Importes
  const campos = ["ImpTotal", "ImpTotConc", "ImpNeto", "ImpOpEx", "ImpTrib", "ImpIVA"] as const;
  const imp = Object.fromEntries(campos.map((c) => [c, num(det[c])])) as Record<(typeof campos)[number], number>;
  for (const c of campos) {
    if (Number.isNaN(imp[c]) || imp[c] < 0) obs.push(E.importeNegativo(c));
  }
  if (!iguales(imp.ImpTotal, imp.ImpTotConc + imp.ImpNeto + imp.ImpOpEx + imp.ImpTrib + imp.ImpIVA)) {
    obs.push(E.totalNoSuma());
  }

  const tributos = lista(det.Tributos, "Tributo");
  if (tributos.length > 0 || imp.ImpTrib > 0) {
    const suma = tributos.reduce((acc, t) => acc + num(t.Importe), 0);
    if (!iguales(suma, imp.ImpTrib)) obs.push(E.tributosNoSuman());
  }

  // IVA
  const alicuotas = lista(det.Iva, "AlicIva");
  if (clase === "C") {
    if (alicuotas.length > 0) obs.push(E.ivaEnClaseC());
    if (imp.ImpIVA !== 0 || imp.ImpTotConc !== 0) obs.push(E.claseCConIva());
  } else {
    if (imp.ImpNeto > 0 && alicuotas.length === 0) obs.push(E.ivaObligatorio());
    let sumaIva = 0;
    let sumaBase = 0;
    for (const a of alicuotas) {
      const id = texto(a.Id) ?? "";
      const alic = ALICUOTAS_IVA.find((x) => x.id === Number(id));
      const base = num(a.BaseImp);
      const importe = num(a.Importe);
      sumaIva += importe;
      sumaBase += base;
      if (!alic) {
        obs.push(E.alicuotaInvalida(id));
        continue;
      }
      const esperado = Math.round(base * alic.porcentaje) / 100;
      if (!iguales(importe, esperado)) obs.push(E.ivaMalCalculado(id));
    }
    if (alicuotas.length > 0) {
      if (!iguales(sumaIva, imp.ImpIVA)) obs.push(E.ivaNoSuma());
      if (!iguales(sumaBase, imp.ImpNeto)) obs.push(E.baseNoSuma());
    }
  }

  // Consumidor final sin identificar por encima del tope
  if (clase === "B" && docTipo === DOC_OTRO && imp.ImpTotal >= ctx.config.topeConsumidorFinal) {
    obs.push(E.consumidorFinalTope(ctx.config.topeConsumidorFinal));
  }

  // Moneda
  const monId = texto(det.MonId) ?? "";
  const cotiz = num(det.MonCotiz);
  if (!MONEDAS.some((mo) => mo.id === monId)) obs.push(E.monedaInvalida());
  else if (monId === "PES" ? cotiz !== 1 : !(cotiz > 0)) obs.push(E.cotizacionInvalida());

  // Notas de credito / debito
  if (tipo.tipo !== "FACTURA") {
    const asociados = lista(det.CbtesAsoc, "CbteAsoc");
    const periodo = det.PeriodoAsoc;
    if (asociados.length === 0 && !periodo) obs.push(E.cbteAsocObligatorio());
    for (const a of asociados) {
      const t = num(a.Tipo);
      const pv = num(a.PtoVta);
      const n = num(a.Nro);
      const cuitAsoc = texto(a.Cuit);
      if (cuitAsoc && cuitAsoc !== e.cuit) continue; // comprobante de otro emisor: no se puede verificar
      const tipoAsoc = TIPOS_CBTE.find((x) => x.id === t);
      if (!ctx.store.buscar(e.cuit, pv, t, n)) obs.push(E.cbteAsocInexistente(t, pv, n));
      else if (tipoAsoc && tipoAsoc.clase !== clase) obs.push(E.cbteAsocClase());
    }
  }

  return obs;
}

export function hoyArgentina(ctx: Contexto): string {
  return aaaammdd(ctx.ahora());
}
