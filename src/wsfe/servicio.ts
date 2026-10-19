import { randomInt } from "node:crypto";
import { aaaammdd, fchProceso, sumarDias } from "../fechas.js";
import { aXml, fault, sobre, texto, type NodoXml, type PedidoSoap, type ValorXml } from "../soap.js";
import type { Contexto, RespuestaSoap } from "../contexto.js";
import type { ComprobanteAutorizado } from "../store.js";
import type { Escenario } from "../escenarios.js";
import {
  ALICUOTAS_IVA,
  CONCEPTOS,
  CONDICIONES_IVA_RECEPTOR,
  FCH_DESDE,
  MONEDAS,
  TIPOS_CBTE,
  TIPOS_DOC,
  TRIBUTOS,
  textoClases,
} from "./catalogos.js";
import { E, type Mensaje } from "./errores.js";
import { hoyArgentina, num, validarDetalle } from "./validaciones.js";

// WSFEv1 (service.asmx). Cada metodo devuelve el nodo <Metodo>Result; el envoltorio
// SOAP y <Metodo>Response los arma responder().

export const NS_WSFE = "http://ar.gov.afip.dif.FEV1/";
const MAX_REG_X_REQUEST = 250;

// Evento que viaja en cada respuesta: deja claro en los logs del cliente que esto no es ARCA.
const EVENTO_SIMULADOR: Mensaje = { Code: 1, Msg: "arca-api-sim: respuesta simulada, sin validez fiscal" };

type Params = Record<string, unknown>;

function errores(lista: Mensaje[]): NodoXml | undefined {
  return lista.length ? { Err: lista } as unknown as NodoXml : undefined;
}

function eventos(): NodoXml {
  return { Evt: [EVENTO_SIMULADOR] } as unknown as NodoXml;
}

function responder(p: PedidoSoap, resultado: NodoXml): RespuestaSoap {
  const op = p.operacion;
  return {
    status: 200,
    xml: sobre(p.version, `<${op}Response xmlns="${NS_WSFE}">${aXml(`${op}Result`, resultado)}</${op}Response>`),
  };
}

/** Valida Auth (Token/Sign/Cuit). Devuelve el CUIT representado o el error. */
function autenticar(params: Params, ctx: Contexto): { cuit: string } | { error: Mensaje } {
  const auth = (params.Auth ?? {}) as Params;
  const cuit = texto(auth.Cuit) ?? "";
  if (ctx.config.validarToken) {
    const ticket = ctx.store.buscarTicket(texto(auth.Token) ?? "", texto(auth.Sign) ?? "");
    if (!ticket || ticket.servicio !== "wsfe") return { error: E.tokenInvalido() };
    if (new Date(ticket.vence) <= ctx.ahora()) return { error: E.tokenVencido() };
    if (ticket.cuit && ticket.cuit !== cuit) return { error: E.cuitNoRepresentada(cuit) };
  }
  if (!/^\d{11}$/.test(cuit)) return { error: E.cuitNoRepresentada(cuit) };
  return { cuit };
}

function generarCae(ctx: Contexto): string {
  for (;;) {
    let cae = "7";
    for (let i = 0; i < 13; i++) cae += String(randomInt(0, 10));
    if (!ctx.store.listarComprobantes().some((c) => c.cae === cae)) return cae;
  }
}

// --- Metodos ---

function feDummy(): NodoXml {
  return { AppServer: "OK", DbServer: "OK", AuthServer: "OK" };
}

function feCompUltimoAutorizado(params: Params, ctx: Contexto): NodoXml {
  const ptoVta = num(params.PtoVta);
  const cbteTipo = num(params.CbteTipo);
  const base = { PtoVta: ptoVta || 0, CbteTipo: cbteTipo || 0, CbteNro: 0 };
  const a = autenticar(params, ctx);
  if ("error" in a) return { ...base, Errors: errores([a.error]), Events: eventos() };
  if (!TIPOS_CBTE.some((t) => t.id === cbteTipo)) {
    return { ...base, Errors: errores([E.cbteTipoInvalido(cbteTipo)]), Events: eventos() };
  }
  if (!ctx.config.puntosVenta.includes(ptoVta)) {
    return { ...base, Errors: errores([E.ptoVtaInvalido(ptoVta)]), Events: eventos() };
  }
  const ultimo = ctx.store.ultimoAutorizado(a.cuit, ptoVta, cbteTipo);
  return { ...base, CbteNro: ultimo?.cbteNro ?? 0, Events: eventos() };
}

function mismoDetalle(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const sinFecha = (x: Record<string, unknown>) => JSON.stringify({ ...x, CbteFch: undefined });
  return sinFecha(a) === sinFecha(b) && (!texto(b.CbteFch) || texto(a.CbteFch) === texto(b.CbteFch));
}

function feCaeSolicitar(params: Params, ctx: Contexto, escenario: Escenario | undefined): NodoXml {
  const a = autenticar(params, ctx);
  if ("error" in a) return { Errors: errores([a.error]), Events: eventos() };
  const cuit = a.cuit;

  const req = (params.FeCAEReq ?? {}) as Params;
  const cab = (req.FeCabReq ?? {}) as Params;
  const dets = ((req.FeDetReq as Params | undefined)?.FECAEDetRequest ?? []) as Params[];
  const ptoVta = num(cab.PtoVta);
  const cbteTipo = num(cab.CbteTipo);
  const cantReg = num(cab.CantReg);
  const ahora = ctx.ahora();
  const proceso = fchProceso(ahora);
  const hoy = hoyArgentina(ctx);

  const cabResp = (resultado: string, reproceso = "N"): NodoXml => ({
    Cuit: cuit,
    PtoVta: ptoVta || 0,
    CbteTipo: cbteTipo || 0,
    FchProceso: proceso,
    CantReg: cantReg || 0,
    Resultado: resultado,
    Reproceso: reproceso,
  });

  const tipo = TIPOS_CBTE.find((t) => t.id === cbteTipo);
  const erroresCab: Mensaje[] = [];
  if (!tipo) erroresCab.push(E.cbteTipoInvalido(cbteTipo));
  if (!ctx.config.puntosVenta.includes(ptoVta)) erroresCab.push(E.ptoVtaInvalido(ptoVta));
  if (tipo) {
    const permitidas = ctx.config.condicionEmisor === "MONOTRIBUTO" ? ["C"] : ["A", "B"];
    if (!permitidas.includes(tipo.clase)) erroresCab.push(E.claseNoPermitidaEmisor(tipo.clase));
  }
  if (cantReg !== dets.length) erroresCab.push(E.cantRegNoCoincide());
  if (dets.length > MAX_REG_X_REQUEST) erroresCab.push(E.cantRegMaximo(MAX_REG_X_REQUEST));
  if (erroresCab.length || !tipo) {
    return { FeCabResp: cabResp("R"), Errors: errores(erroresCab), Events: eventos() };
  }

  const ultimo = ctx.store.ultimoAutorizado(cuit, ptoVta, cbteTipo);
  let siguiente = (ultimo?.cbteNro ?? 0) + 1;
  let fechaUltimo = texto(ultimo?.detalle.CbteFch);
  const aprobados: ComprobanteAutorizado[] = [];
  let reproceso = false;

  const detResp = dets.map((det) => {
    const base = {
      Concepto: num(det.Concepto) || 0,
      DocTipo: num(det.DocTipo) || 0,
      DocNro: texto(det.DocNro) ?? "0",
      CbteDesde: num(det.CbteDesde) || 0,
      CbteHasta: num(det.CbteHasta) || 0,
      CbteFch: texto(det.CbteFch) || hoy,
    };

    // Reproceso: el mismo comprobante, ya autorizado, mandado de nuevo (tipico despues
    // de un timeout). ARCA devuelve el CAE original en vez de rechazarlo.
    const previo = ctx.store.buscar(cuit, ptoVta, cbteTipo, base.CbteDesde);
    if (previo && base.CbteDesde === base.CbteHasta && mismoDetalle(previo.detalle, det)) {
      reproceso = true;
      return {
        ...base,
        CbteFch: texto(previo.detalle.CbteFch),
        Resultado: "A",
        Observaciones: previo.observaciones.length ? { Obs: previo.observaciones } : undefined,
        CAE: previo.cae,
        CAEFchVto: previo.caeVto,
        _ok: true,
      };
    }

    let obs = validarDetalle(
      { det, cuit, ptoVta, tipo, numeroEsperado: siguiente, fechaUltimo, hoy },
      ctx
    );
    if (obs.length === 0 && escenario?.tipo === "rechazo") {
      obs = [{ Code: escenario.codigo ?? 10016, Msg: escenario.mensaje ?? "Rechazo forzado por escenario del simulador" }];
    }
    if (obs.length) {
      return { ...base, Resultado: "R", Observaciones: { Obs: obs }, CAE: "", CAEFchVto: "", _ok: false };
    }

    const obsAprobado: Mensaje[] =
      escenario?.tipo === "observacion"
        ? [{ Code: escenario.codigo ?? 10217, Msg: escenario.mensaje ?? "Observacion forzada por escenario del simulador" }]
        : [];
    const cae = generarCae(ctx);
    const caeVto = aaaammdd(sumarDias(ahora, ctx.config.diasVencimientoCae));
    aprobados.push({
      cuit,
      ptoVta,
      cbteTipo,
      cbteNro: base.CbteDesde,
      cae,
      caeVto,
      fchProceso: proceso,
      resultado: "A",
      observaciones: obsAprobado,
      detalle: { ...det, CbteFch: base.CbteFch },
    });
    siguiente += 1;
    fechaUltimo = base.CbteFch;
    return {
      ...base,
      Resultado: "A",
      Observaciones: obsAprobado.length ? { Obs: obsAprobado } : undefined,
      CAE: cae,
      CAEFchVto: caeVto,
      _ok: true,
    };
  });

  ctx.store.agregarComprobantes(aprobados);

  const okCount = detResp.filter((d) => d._ok).length;
  const resultado = okCount === dets.length ? "A" : okCount === 0 ? "R" : "P";
  return {
    FeCabResp: cabResp(resultado, reproceso ? "S" : "N"),
    FeDetResp: { FECAEDetResponse: detResp.map(({ _ok, ...d }) => d) } as unknown as NodoXml,
    Events: eventos(),
  };
}

// Orden de FEDetRequest en el WSDL; FECompConsultar devuelve los campos en este orden.
const CAMPOS_DETALLE = [
  "Concepto", "DocTipo", "DocNro", "CbteDesde", "CbteHasta", "CbteFch", "ImpTotal", "ImpTotConc",
  "ImpNeto", "ImpOpEx", "ImpTrib", "ImpIVA", "FchServDesde", "FchServHasta", "FchVtoPago", "MonId",
  "MonCotiz", "CanMisMonExt", "CondicionIVAReceptorId", "CbtesAsoc", "Tributos", "Iva", "Opcionales",
  "Compradores", "PeriodoAsoc",
];

function feCompConsultar(params: Params, ctx: Contexto): NodoXml {
  const a = autenticar(params, ctx);
  if ("error" in a) return { Errors: errores([a.error]), Events: eventos() };
  const req = (params.FeCompConsReq ?? {}) as Params;
  const c = ctx.store.buscar(a.cuit, num(req.PtoVta), num(req.CbteTipo), num(req.CbteNro));
  if (!c) return { Errors: errores([E.sinResultados()]), Events: eventos() };
  const resultGet: NodoXml = {};
  for (const campo of CAMPOS_DETALLE) resultGet[campo] = c.detalle[campo] as ValorXml;
  Object.assign(resultGet, {
    Resultado: c.resultado,
    CodAutorizacion: c.cae,
    EmisionTipo: "CAE",
    FchVto: c.caeVto,
    FchProceso: c.fchProceso,
    Observaciones: c.observaciones.length ? ({ Obs: c.observaciones } as unknown as NodoXml) : undefined,
    PtoVta: c.ptoVta,
    CbteTipo: c.cbteTipo,
  });
  return { ResultGet: resultGet, Events: eventos() };
}

function conAuth(params: Params, ctx: Contexto, resultGet: () => NodoXml): NodoXml {
  const a = autenticar(params, ctx);
  if ("error" in a) return { Errors: errores([a.error]), Events: eventos() };
  return { ResultGet: resultGet(), Events: eventos() };
}

const vigencia = { FchDesde: FCH_DESDE, FchHasta: "NULL" };

function feParam(op: string, params: Params, ctx: Contexto): NodoXml | undefined {
  switch (op) {
    case "FEParamGetTiposCbte":
      return conAuth(params, ctx, () => ({ CbteTipo: TIPOS_CBTE.map((t) => ({ Id: t.id, Desc: t.desc, ...vigencia })) }) as unknown as NodoXml);
    case "FEParamGetTiposDoc":
      return conAuth(params, ctx, () => ({ DocTipo: TIPOS_DOC.map((t) => ({ Id: t.id, Desc: t.desc, ...vigencia })) }) as unknown as NodoXml);
    case "FEParamGetTiposIva":
      return conAuth(params, ctx, () => ({ IvaTipo: ALICUOTAS_IVA.map((t) => ({ Id: t.id, Desc: t.desc, ...vigencia })) }) as unknown as NodoXml);
    case "FEParamGetTiposConcepto":
      return conAuth(params, ctx, () => ({ ConceptoTipo: CONCEPTOS.map((t) => ({ Id: t.id, Desc: t.desc, ...vigencia })) }) as unknown as NodoXml);
    case "FEParamGetTiposMonedas":
      return conAuth(params, ctx, () => ({ Moneda: MONEDAS.map((t) => ({ Id: t.id, Desc: t.desc, ...vigencia })) }) as unknown as NodoXml);
    case "FEParamGetTiposTributos":
      return conAuth(params, ctx, () => ({ TributoTipo: TRIBUTOS.map((t) => ({ Id: t.id, Desc: t.desc, ...vigencia })) }) as unknown as NodoXml);
    case "FEParamGetTiposOpcional":
      return conAuth(params, ctx, () => ({}));
    case "FEParamGetTiposPaises":
      return conAuth(params, ctx, () => ({ PaisTipo: [{ Id: 200, Desc: "ARGENTINA" }] }) as unknown as NodoXml);
    case "FEParamGetPtosVenta":
      return conAuth(params, ctx, () =>
        ({ PtoVenta: ctx.config.puntosVenta.map((n) => ({ Nro: n, EmisionTipo: "CAE", Bloqueado: "N", FchBaja: "NULL" })) }) as unknown as NodoXml
      );
    case "FEParamGetCondicionIvaReceptor": {
      const clase = (texto(params.ClaseCmp) ?? "").toUpperCase();
      return conAuth(params, ctx, () =>
        ({
          CondicionIvaReceptor: CONDICIONES_IVA_RECEPTOR.filter((c) => !clase || c.clases.includes(clase as "A")).map((c) => ({
            Id: c.id,
            Desc: c.desc,
            Cmp_Clase: textoClases(c.clases),
          })),
        }) as unknown as NodoXml
      );
    }
    case "FEParamGetCotizacion": {
      const a = autenticar(params, ctx);
      if ("error" in a) return { Errors: errores([a.error]), Events: eventos() };
      const monId = texto(params.MonId) ?? "";
      const cotiz = monId === "PES" ? 1 : monId === "DOL" ? ctx.config.cotizacionDolar : monId === "060" ? Math.round(ctx.config.cotizacionDolar * 1.08) : NaN;
      if (Number.isNaN(cotiz)) return { Errors: errores([E.monedaInvalida()]), Events: eventos() };
      return { ResultGet: { MonId: monId, MonCotiz: cotiz, FchCotiz: hoyArgentina(ctx) }, Events: eventos() };
    }
    case "FECompTotXRequest": {
      const a = autenticar(params, ctx);
      if ("error" in a) return { RegXReq: 0, Errors: errores([a.error]), Events: eventos() };
      return { RegXReq: MAX_REG_X_REQUEST, Events: eventos() };
    }
  }
  return undefined;
}

const CAEA = new Set([
  "FECAEASolicitar",
  "FECAEAConsultar",
  "FECAEARegInformativo",
  "FECAEASinMovimientoConsultar",
  "FECAEASinMovimientoInformar",
]);

export function atenderWsfe(p: PedidoSoap, ctx: Contexto, escenario: Escenario | undefined): RespuestaSoap {
  if (escenario?.tipo === "error") {
    const err = { Code: escenario.codigo ?? 500, Msg: escenario.mensaje ?? E.errorInterno().Msg };
    return responder(p, { Errors: errores([err]), Events: eventos() });
  }
  switch (p.operacion) {
    case "FEDummy":
      return responder(p, feDummy());
    case "FECompUltimoAutorizado":
      return responder(p, feCompUltimoAutorizado(p.parametros, ctx));
    case "FECAESolicitar":
      return responder(p, feCaeSolicitar(p.parametros, ctx, escenario));
    case "FECompConsultar":
      return responder(p, feCompConsultar(p.parametros, ctx));
  }
  if (CAEA.has(p.operacion)) {
    // Desde la RG 5782 el CAEA queda solo para contingencias; el simulador no lo implementa.
    return responder(p, {
      Errors: errores([{ Code: 501, Msg: `${p.operacion}: CAEA no implementado en el simulador` }]),
      Events: eventos(),
    });
  }
  const param = feParam(p.operacion, p.parametros, ctx);
  if (param) return responder(p, param);
  return {
    status: 500,
    xml: fault(p.version, "soap:Client", `Server did not recognize the value of HTTP Header SOAPAction: ${NS_WSFE}${p.operacion}.`),
  };
}
