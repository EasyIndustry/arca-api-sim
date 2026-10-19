// Validacion del digito verificador de CUIT/CUIL (modulo 11), la misma que hace ARCA.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function cuitValido(valor: string | number): boolean {
  const s = String(valor).replace(/\D/g, "");
  if (s.length !== 11) return false;
  const digitos = s.split("").map(Number);
  const suma = PESOS.reduce((acc, p, i) => acc + p * digitos[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === digitos[10];
}
