// Tablas de parametros de WSFEv1 (lo que devuelven los FEParamGet*). Solo estan los
// valores que usa un service tecnico que factura A/B/C; el resto de los tipos de
// comprobante (M, FCE MiPyME, recibos) no los soporta el simulador.

export type Clase = "A" | "B" | "C";

export interface TipoCbte {
  id: number;
  desc: string;
  clase: Clase;
  tipo: "FACTURA" | "NOTA_DEBITO" | "NOTA_CREDITO";
}

export const TIPOS_CBTE: TipoCbte[] = [
  { id: 1, desc: "Factura A", clase: "A", tipo: "FACTURA" },
  { id: 2, desc: "Nota de Débito A", clase: "A", tipo: "NOTA_DEBITO" },
  { id: 3, desc: "Nota de Crédito A", clase: "A", tipo: "NOTA_CREDITO" },
  { id: 6, desc: "Factura B", clase: "B", tipo: "FACTURA" },
  { id: 7, desc: "Nota de Débito B", clase: "B", tipo: "NOTA_DEBITO" },
  { id: 8, desc: "Nota de Crédito B", clase: "B", tipo: "NOTA_CREDITO" },
  { id: 11, desc: "Factura C", clase: "C", tipo: "FACTURA" },
  { id: 12, desc: "Nota de Débito C", clase: "C", tipo: "NOTA_DEBITO" },
  { id: 13, desc: "Nota de Crédito C", clase: "C", tipo: "NOTA_CREDITO" },
];

export const TIPOS_DOC = [
  { id: 80, desc: "CUIT" },
  { id: 86, desc: "CUIL" },
  { id: 87, desc: "CDI" },
  { id: 89, desc: "LE" },
  { id: 90, desc: "LC" },
  { id: 91, desc: "CI Extranjera" },
  { id: 94, desc: "Pasaporte" },
  { id: 96, desc: "DNI" },
  { id: 99, desc: "Doc. (Otro)" },
];

export const DOC_CUIT = 80;
export const DOC_CUIL = 86;
export const DOC_DNI = 96;
export const DOC_OTRO = 99;

// Id de alicuota -> porcentaje.
export const ALICUOTAS_IVA: { id: number; desc: string; porcentaje: number }[] = [
  { id: 3, desc: "0%", porcentaje: 0 },
  { id: 4, desc: "10.5%", porcentaje: 10.5 },
  { id: 5, desc: "21%", porcentaje: 21 },
  { id: 6, desc: "27%", porcentaje: 27 },
  { id: 8, desc: "5%", porcentaje: 5 },
  { id: 9, desc: "2.5%", porcentaje: 2.5 },
];

export const CONCEPTOS = [
  { id: 1, desc: "Producto" },
  { id: 2, desc: "Servicios" },
  { id: 3, desc: "Productos y Servicios" },
];

export const MONEDAS = [
  { id: "PES", desc: "Pesos Argentinos" },
  { id: "DOL", desc: "Dólar Estadounidense" },
  { id: "060", desc: "Euro" },
];

export const TRIBUTOS = [
  { id: 1, desc: "Impuestos nacionales" },
  { id: 2, desc: "Impuestos provinciales" },
  { id: 3, desc: "Impuestos municipales" },
  { id: 4, desc: "Impuestos Internos" },
  { id: 99, desc: "Otro" },
];

// RG 5616: condicion frente al IVA del receptor y que clases de comprobante admite.
export const CONDICIONES_IVA_RECEPTOR: { id: number; desc: string; clases: Clase[] }[] = [
  { id: 1, desc: "IVA Responsable Inscripto", clases: ["A", "C"] },
  { id: 4, desc: "IVA Sujeto Exento", clases: ["B", "C"] },
  { id: 5, desc: "Consumidor Final", clases: ["B", "C"] },
  { id: 6, desc: "Responsable Monotributo", clases: ["A", "C"] },
  { id: 7, desc: "Sujeto No Categorizado", clases: ["B", "C"] },
  { id: 8, desc: "Proveedor del Exterior", clases: ["B", "C"] },
  { id: 9, desc: "Cliente del Exterior", clases: ["B", "C"] },
  { id: 10, desc: "IVA Liberado – Ley N° 19.640", clases: ["B", "C"] },
  { id: 13, desc: "Monotributista Social", clases: ["A", "C"] },
  { id: 15, desc: "IVA No Alcanzado", clases: ["B", "C"] },
  { id: 16, desc: "Monotributo Trabajador Independiente Promovido", clases: ["A", "C"] },
];

// ARCA informa la clase como "A/M/C" o "B/C"; M no se soporta pero se respeta el texto.
export function textoClases(clases: Clase[]): string {
  return clases.includes("A") ? "A/M/C" : "B/C";
}

export const FCH_DESDE = "20100917";
