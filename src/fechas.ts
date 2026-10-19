// ARCA trabaja en hora argentina (UTC-3, sin horario de verano). Todas las fechas
// que viajan en los webservices se arman con este desfase, no con el del servidor.

const OFFSET_MS = -3 * 60 * 60 * 1000;

function partes(d: Date) {
  const ar = new Date(d.getTime() + OFFSET_MS);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return {
    y: p(ar.getUTCFullYear(), 4),
    m: p(ar.getUTCMonth() + 1),
    d: p(ar.getUTCDate()),
    hh: p(ar.getUTCHours()),
    mi: p(ar.getUTCMinutes()),
    ss: p(ar.getUTCSeconds()),
    ms: p(ar.getUTCMilliseconds(), 3),
  };
}

/** yyyymmdd en hora argentina (formato de CbteFch, CAEFchVto, etc.). */
export function aaaammdd(d: Date): string {
  const x = partes(d);
  return `${x.y}${x.m}${x.d}`;
}

/** yyyymmddhhmmss en hora argentina (formato de FchProceso). */
export function fchProceso(d: Date): string {
  const x = partes(d);
  return `${x.y}${x.m}${x.d}${x.hh}${x.mi}${x.ss}`;
}

/** ISO 8601 con -03:00, como lo devuelve WSAA. */
export function isoArgentina(d: Date): string {
  const x = partes(d);
  return `${x.y}-${x.m}-${x.d}T${x.hh}:${x.mi}:${x.ss}.${x.ms}-03:00`;
}

/** Parsea yyyymmdd como medianoche argentina. null si el formato no es valido. */
export function parseAaaammdd(s: string | undefined): Date | null {
  if (!s || !/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc - OFFSET_MS);
}

/** Diferencia en dias calendario (b - a) entre dos fechas yyyymmdd. */
export function diasEntre(a: string, b: string): number {
  const da = parseAaaammdd(a);
  const db = parseAaaammdd(b);
  if (!da || !db) return NaN;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function sumarDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * 86_400_000);
}
