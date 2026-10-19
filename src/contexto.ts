import type { Config } from "./config.js";
import type { Escenarios } from "./escenarios.js";
import type { Store } from "./store.js";

export interface Contexto {
  config: Config;
  store: Store;
  escenarios: Escenarios;
  // Inyectable para los tests (vencimientos de TA, fechas de comprobante).
  ahora: () => Date;
}

export interface RespuestaSoap {
  status: number;
  xml: string;
}
