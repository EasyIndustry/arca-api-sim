import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Estado del simulador: tickets de acceso emitidos por WSAA y comprobantes
// autorizados por WSFE. La numeracion sale de los comprobantes guardados, igual que
// en ARCA: el "ultimo autorizado" es el mayor numero aceptado para esa clave.

export interface TicketAcceso {
  token: string;
  sign: string;
  servicio: string;
  // CUIT del certificado que firmo el TRA (null si no se pudo leer del CMS).
  cuit: string | null;
  // Huella del certificado, para la regla de "un TA vigente por certificado y servicio".
  huellaCert: string;
  emitido: string;
  vence: string;
}

export interface ComprobanteAutorizado {
  cuit: string;
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  cae: string;
  caeVto: string;
  fchProceso: string;
  resultado: "A";
  observaciones: { Code: number; Msg: string }[];
  // El detalle tal como llego en FECAEDetRequest, para devolverlo en FECompConsultar.
  detalle: Record<string, unknown>;
}

interface Estado {
  version: 1;
  tickets: TicketAcceso[];
  comprobantes: ComprobanteAutorizado[];
}

const vacio = (): Estado => ({ version: 1, tickets: [], comprobantes: [] });

export class Store {
  private estado: Estado;

  constructor(private archivo: string) {
    this.estado = this.cargar();
  }

  private cargar(): Estado {
    if (this.archivo === "memory" || !existsSync(this.archivo)) return vacio();
    const crudo = JSON.parse(readFileSync(this.archivo, "utf8")) as Estado;
    return { ...vacio(), ...crudo };
  }

  private guardar() {
    if (this.archivo === "memory") return;
    mkdirSync(dirname(this.archivo), { recursive: true });
    const tmp = `${this.archivo}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.estado, null, 2));
    renameSync(tmp, this.archivo);
  }

  // --- Tickets ---

  ticketVigente(huellaCert: string, servicio: string, ahora: Date): TicketAcceso | undefined {
    return this.estado.tickets.find(
      (t) => t.huellaCert === huellaCert && t.servicio === servicio && new Date(t.vence) > ahora
    );
  }

  buscarTicket(token: string, sign: string): TicketAcceso | undefined {
    return this.estado.tickets.find((t) => t.token === token && t.sign === sign);
  }

  agregarTicket(t: TicketAcceso, ahora: Date) {
    // Se descartan los vencidos para que el archivo no crezca sin limite.
    this.estado.tickets = this.estado.tickets.filter((x) => new Date(x.vence) > ahora);
    this.estado.tickets.push(t);
    this.guardar();
  }

  borrarTickets() {
    this.estado.tickets = [];
    this.guardar();
  }

  listarTickets(): TicketAcceso[] {
    return this.estado.tickets;
  }

  // --- Comprobantes ---

  ultimoAutorizado(cuit: string, ptoVta: number, cbteTipo: number): ComprobanteAutorizado | undefined {
    let ultimo: ComprobanteAutorizado | undefined;
    for (const c of this.estado.comprobantes) {
      if (c.cuit === cuit && c.ptoVta === ptoVta && c.cbteTipo === cbteTipo) {
        if (!ultimo || c.cbteNro > ultimo.cbteNro) ultimo = c;
      }
    }
    return ultimo;
  }

  buscar(cuit: string, ptoVta: number, cbteTipo: number, cbteNro: number): ComprobanteAutorizado | undefined {
    return this.estado.comprobantes.find(
      (c) => c.cuit === cuit && c.ptoVta === ptoVta && c.cbteTipo === cbteTipo && c.cbteNro === cbteNro
    );
  }

  agregarComprobantes(cs: ComprobanteAutorizado[]) {
    if (cs.length === 0) return;
    this.estado.comprobantes.push(...cs);
    this.guardar();
  }

  listarComprobantes(filtro: { cuit?: string; ptoVta?: number; cbteTipo?: number } = {}): ComprobanteAutorizado[] {
    return this.estado.comprobantes.filter(
      (c) =>
        (filtro.cuit === undefined || c.cuit === filtro.cuit) &&
        (filtro.ptoVta === undefined || c.ptoVta === filtro.ptoVta) &&
        (filtro.cbteTipo === undefined || c.cbteTipo === filtro.cbteTipo)
    );
  }

  /** Borra comprobantes (todos, o los de un CUIT). La numeracion vuelve a 0. */
  reset(cuit?: string) {
    if (cuit) {
      this.estado.comprobantes = this.estado.comprobantes.filter((c) => c.cuit !== cuit);
    } else {
      this.estado = vacio();
    }
    this.guardar();
  }
}
