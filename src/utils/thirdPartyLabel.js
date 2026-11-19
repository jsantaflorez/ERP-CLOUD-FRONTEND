// NEW (2026-11-18, user request): etiqueta única de un tercero en reportes,
// en pantalla y en las exportaciones a Excel y PDF: "documento - nombre"
// (p. ej. "79762603 - FAUNIER ROLANDO LOPEZ AVILA"), para poder ubicarlo
// sin ambigüedad aunque haya nombres repetidos o parecidos. Mismo formato
// que ya usaban el Auxiliar y el Libro Diario.
export function thirdPartyLabel(docNumber, name, empty = "—") {
  const doc = docNumber == null ? "" : String(docNumber).trim();
  const nm = name == null ? "" : String(name).trim();
  if (doc && nm) return `${doc} - ${nm}`;
  return doc || nm || empty;
}
