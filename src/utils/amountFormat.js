// amountFormat.js — puntuación colombiana de montos (UI 2026-11-10):
// punto para miles/millones, coma para centavos. La usan AmountInput (en
// vivo, mientras se digita) y los totales/lecturas de la captura.
export const GROUP_SEP = ".";
export const DECIMAL_SEP = ",";

const groupInt = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP);

// "1234567.5" -> "1.234.567,5" (respeta lo digitado: no rellena decimales).
export function formatAmountTyping(raw) {
  if (raw === "" || raw == null) return "";
  let s = String(raw);
  let [int, dec] = s.split(".");
  if (dec !== undefined && dec.length > 2) {
    // Valores calculados (p. ej. F9 autocuadre) pueden traer ruido binario.
    [int, dec] = Number(s).toFixed(2).split(".");
  }
  int = (int || "").replace(/^0+(?=\d)/, "");
  if (int === "" && dec !== undefined) int = "0";
  return dec !== undefined ? `${groupInt(int)}${DECIMAL_SEP}${dec}` : groupInt(int);
}

// Monto con 2 decimales fijos y signo, para totales y lecturas
// ("-1.234,50"). Mismo formato que el campo, para que lo digitado y los
// totales se lean igual.
export function formatMoney(n) {
  const v = Number.isFinite(n) ? n : 0;
  const [int, dec] = Math.abs(v).toFixed(2).split(".");
  return `${v < 0 && Number(Math.abs(v).toFixed(2)) !== 0 ? "-" : ""}${groupInt(int)}${DECIMAL_SEP}${dec}`;
}

