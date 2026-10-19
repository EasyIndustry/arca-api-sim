// Configuracion por variables de entorno. Todo tiene un default razonable para
// levantar el simulador sin tocar nada.

function entero(nombre: string, porDefecto: number): number {
  const v = process.env[nombre];
  if (v === undefined || v === "") return porDefecto;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${nombre} debe ser un numero (vino "${v}")`);
  return n;
}

function booleano(nombre: string, porDefecto: boolean): boolean {
  const v = process.env[nombre];
  if (v === undefined || v === "") return porDefecto;
  return ["1", "true", "si", "yes"].includes(v.toLowerCase());
}

export interface Config {
  puerto: number;
  host: string;
  // Archivo donde se guarda el estado (numeracion, comprobantes, tickets). "memory" = no persistir.
  archivoDatos: string;
  // Puntos de venta habilitados para WS. Pedir CAE con otro devuelve error, como en ARCA.
  puntosVenta: number[];
  // Condicion del emisor: "RI" emite A/B, "MONOTRIBUTO" solo C.
  condicionEmisor: "RI" | "MONOTRIBUTO";
  // Como WSAA real: si el certificado ya tiene un TA vigente para el servicio, rechaza
  // el nuevo pedido con coe.alreadyAuthenticated. Obliga a cachear el TA.
  taUnico: boolean;
  // Si es false, WSFE no valida que Token/Sign hayan sido emitidos por este WSAA.
  validarToken: boolean;
  horasVigenciaTa: number;
  diasVencimientoCae: number;
  // Consumidor final sin identificar: a partir de este total ARCA exige DocTipo/DocNro.
  topeConsumidorFinal: number;
  // RG 5616: CondicionIVAReceptorId obligatorio. Con false solo se valida si viene.
  condicionIvaObligatoria: boolean;
  latenciaMs: number;
  cotizacionDolar: number;
}

export function cargarConfig(sobrescribir: Partial<Config> = {}): Config {
  const base: Config = {
    puerto: entero("PORT", 4100),
    host: process.env.HOST ?? "0.0.0.0",
    archivoDatos: process.env.ARCA_SIM_DATA ?? "data/estado.json",
    puntosVenta: (process.env.ARCA_SIM_PTOS_VENTA ?? "1,2")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
    condicionEmisor: process.env.ARCA_SIM_CONDICION_EMISOR === "MONOTRIBUTO" ? "MONOTRIBUTO" : "RI",
    taUnico: booleano("ARCA_SIM_TA_UNICO", true),
    validarToken: booleano("ARCA_SIM_VALIDAR_TOKEN", true),
    horasVigenciaTa: entero("ARCA_SIM_HORAS_TA", 12),
    diasVencimientoCae: entero("ARCA_SIM_DIAS_VTO_CAE", 10),
    topeConsumidorFinal: entero("ARCA_SIM_TOPE_CF", 10_000_000),
    condicionIvaObligatoria: booleano("ARCA_SIM_CONDICION_IVA_OBLIGATORIA", true),
    latenciaMs: entero("ARCA_SIM_LATENCIA_MS", 0),
    cotizacionDolar: entero("ARCA_SIM_COTIZACION_DOL", 1000),
  };
  return { ...base, ...sobrescribir };
}
