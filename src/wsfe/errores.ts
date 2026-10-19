// Codigos de error y observacion de WSFEv1 que usa el simulador.
//
// OJO: estan transcriptos del manual del desarrollador de WSFEv1 a mejor entender,
// no copiados de la tabla oficial. Los que son "contrato" y conviene manejar por
// codigo (600, 601, 602, 10016) son estables desde hace anios; para el resto, el
// sistema deberia mostrar el Msg y no depender del numero exacto. Antes de salir a
// produccion hay que contrastarlos con el manual vigente.

export interface Mensaje {
  Code: number;
  Msg: string;
}

const m = (Code: number, Msg: string): Mensaje => ({ Code, Msg });

export const E = {
  // Autenticacion
  tokenInvalido: () => m(600, "ValidacionDeToken: No validaron las firmas digitales"),
  tokenVencido: () => m(600, "ValidacionDeToken: Error al verificar hash: VerificacionDeHash: El tiempo de expiración del token ha vencido"),
  cuitNoRepresentada: (cuit: string) => m(601, `CUIT representada no incluida en Token. CUIT: ${cuit}`),
  sinResultados: () => m(602, "Sin Resultados: - En el metodo FECompConsultar"),

  // Cabecera
  cantRegNoCoincide: () => m(10001, "El campo CantReg debe ser igual a la cantidad de registros del detalle (FECAEDetRequest)."),
  cantRegMaximo: (max: number) => m(10002, `La cantidad de registros por request no puede superar ${max}.`),
  ptoVtaInvalido: (pv: number) =>
    m(10004, `El punto de venta ${pv} no se encuentra habilitado a usar en el presente WS. Consultar metodo FEParamGetPtosVenta.`),
  cbteTipoInvalido: (t: number) => m(10007, `El campo CbteTipo (${t}) no es valido. Consultar metodo FEParamGetTiposCbte.`),
  claseNoPermitidaEmisor: (clase: string) =>
    m(10005, `El CUIT emisor no se encuentra autorizado a emitir comprobantes clase ${clase}.`),

  // Detalle
  conceptoInvalido: () => m(10011, "El campo Concepto debe ser 1 (Productos), 2 (Servicios) o 3 (Productos y Servicios)."),
  docTipoInvalido: () => m(10012, "El campo DocTipo no es valido. Consultar metodo FEParamGetTiposDoc."),
  claseARequiereCuit: () => m(10013, "Para comprobantes clase A el campo DocTipo debe ser 80 (CUIT)."),
  docNroInvalido: () => m(10015, "El campo DocNro no es valido para el DocTipo informado."),
  consumidorFinalTope: (tope: number) =>
    m(10015, `Para comprobantes clase B con ImpTotal mayor o igual a ${tope} se debe identificar al receptor (DocTipo y DocNro).`),
  noCorrelativo: () =>
    m(10016, "El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado."),
  rangoInvalido: () => m(10017, "CbteDesde debe ser igual a CbteHasta: el simulador autoriza de a un comprobante por registro."),
  fechaInvalida: () => m(10019, "El campo CbteFch tiene formato invalido (yyyymmdd)."),
  fechaFueraDeRango: (dias: number) =>
    m(10019, `La fecha del comprobante (CbteFch) no puede diferir en mas de ${dias} dias de la fecha de envio.`),
  fechaAnteriorAlUltimo: () =>
    m(10016, "La fecha del comprobante no puede ser anterior a la del ultimo comprobante autorizado del mismo tipo y punto de venta."),
  fechasServicioObligatorias: () =>
    m(10035, "Para Concepto 2 o 3 son obligatorios FchServDesde, FchServHasta y FchVtoPago (yyyymmdd)."),
  fechasServicioInvalidas: () => m(10036, "FchServDesde no puede ser posterior a FchServHasta."),
  vtoPagoAnterior: () => m(10037, "FchVtoPago no puede ser anterior a CbteFch."),
  cbteAsocObligatorio: () => m(10040, "Para Notas de Credito y Debito es obligatorio informar CbtesAsoc o PeriodoAsoc."),
  cbteAsocInexistente: (t: number, pv: number, n: number) =>
    m(10041, `El comprobante asociado (tipo ${t}, punto de venta ${pv}, numero ${n}) no existe como autorizado.`),
  cbteAsocClase: () => m(10042, "El comprobante asociado debe ser de la misma clase (A, B o C) que la nota."),
  importeNegativo: (campo: string) => m(10047, `El campo ${campo} no puede ser negativo.`),
  totalNoSuma: () =>
    m(10048, "El campo 'Importe Total' ImpTotal, debe ser igual a la suma de ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA."),
  tributosNoSuman: () => m(10049, "La suma de los importes de Tributos debe ser igual a ImpTrib."),
  ivaObligatorio: () => m(10070, "Si ImpNeto es mayor a 0 el objeto IVA es obligatorio para comprobantes clase A y B."),
  ivaEnClaseC: () => m(10071, "Para comprobantes clase C el objeto IVA no debe informarse."),
  claseCConIva: () => m(10071, "Para comprobantes clase C los campos ImpIVA e ImpTotConc deben ser 0."),
  alicuotaInvalida: (id: string) => m(10051, `El Id de alicuota de IVA (${id}) no es valido. Consultar metodo FEParamGetTiposIva.`),
  ivaNoSuma: () => m(10052, "La suma de los importes de las alicuotas (AlicIva.Importe) debe ser igual a ImpIVA."),
  baseNoSuma: () => m(10053, "La suma de las bases imponibles (AlicIva.BaseImp) debe ser igual a ImpNeto."),
  ivaMalCalculado: (id: string) => m(10054, `El importe de IVA de la alicuota ${id} no se corresponde con BaseImp x porcentaje.`),
  monedaInvalida: () => m(10119, "El campo MonId no es valido. Consultar metodo FEParamGetTiposMonedas."),
  cotizacionInvalida: () => m(10120, "Para MonId PES el campo MonCotiz debe ser 1; para otras monedas debe ser mayor a 0."),
  condicionIvaObligatoria: () =>
    m(10246, "Campo Condicion Frente al IVA del receptor (CondicionIVAReceptorId) es obligatorio conforme lo reglamentado en la Resolución General N° 5616."),
  condicionIvaInvalida: () =>
    m(10242, "El campo CondicionIVAReceptorId no es valido. Consultar metodo FEParamGetCondicionIvaReceptor."),
  condicionIvaClase: (clase: string) =>
    m(10243, `La Condicion Frente al IVA del receptor informada no es valida para comprobantes clase ${clase}.`),

  // Escenarios
  errorInterno: () => m(500, "Error interno de aplicación"),
};
