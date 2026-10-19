import { randomUUID } from "node:crypto";

// Fallas forzadas: sirven para probar como reacciona el sistema ante cosas que en
// homologacion son dificiles de provocar a proposito (ARCA caido, timeouts, rechazos).
// Se cargan por /admin/escenarios y se consumen en orden, una por pedido que coincida.

export type TipoEscenario =
  | "caido" // HTTP 503, como cuando ARCA esta fuera de servicio
  | "timeout" // demora la respuesta demoraMs (el cliente deberia cortar antes)
  | "error" // WSFE: Errors con codigo/mensaje. WSAA: soap fault
  | "rechazo" // FECAESolicitar: Resultado R con una observacion
  | "observacion"; // FECAESolicitar: Resultado A pero con una observacion

export interface Escenario {
  id: string;
  servicio: "wsaa" | "wsfe";
  metodo?: string;
  tipo: TipoEscenario;
  codigo?: number;
  mensaje?: string;
  demoraMs?: number;
  restantes: number;
}

export type NuevoEscenario = Omit<Escenario, "id" | "restantes"> & { veces?: number };

const TIPOS: TipoEscenario[] = ["caido", "timeout", "error", "rechazo", "observacion"];

export class Escenarios {
  private cola: Escenario[] = [];

  agregar(e: NuevoEscenario): Escenario {
    if (e.servicio !== "wsaa" && e.servicio !== "wsfe") throw new Error('servicio debe ser "wsaa" o "wsfe"');
    if (!TIPOS.includes(e.tipo)) throw new Error(`tipo debe ser uno de: ${TIPOS.join(", ")}`);
    if ((e.tipo === "rechazo" || e.tipo === "observacion") && e.servicio !== "wsfe") {
      throw new Error(`"${e.tipo}" solo aplica a wsfe (FECAESolicitar)`);
    }
    const nuevo: Escenario = {
      id: randomUUID(),
      servicio: e.servicio,
      metodo: e.tipo === "rechazo" || e.tipo === "observacion" ? "FECAESolicitar" : e.metodo,
      tipo: e.tipo,
      codigo: e.codigo,
      mensaje: e.mensaje,
      demoraMs: e.demoraMs,
      restantes: Math.max(1, Math.floor(e.veces ?? 1)),
    };
    this.cola.push(nuevo);
    return nuevo;
  }

  tomar(servicio: "wsaa" | "wsfe", metodo: string): Escenario | undefined {
    const i = this.cola.findIndex((e) => e.servicio === servicio && (!e.metodo || e.metodo === metodo));
    if (i === -1) return undefined;
    const e = this.cola[i];
    e.restantes -= 1;
    if (e.restantes <= 0) this.cola.splice(i, 1);
    return { ...e };
  }

  listar(): Escenario[] {
    return this.cola;
  }

  borrar(id?: string) {
    this.cola = id ? this.cola.filter((e) => e.id !== id) : [];
  }
}
