// src/utils/journalBook.js
//
// Fase 4 (2026-11-24, auditoría F1-25 / A6): Libro Diario sin límite de
// tamaño. Reemplaza el "traer todo en una página" (size=10000, que Spring
// cortaba en 2.000) del Libro Diario, el Buscador por valor, el Resumen por
// tipo de comprobante y el export del listado de documentos.
//
//   1. GET /v1/reports/journal-lines/totals  -> totales exactos (BigDecimal
//      en el servidor) para los mismos filtros, por estado.
//   2. GET /v1/reports/journal-lines?...&afterDate&afterId  -> páginas de
//      hasta 500 documentos (con sus renglones) por cursor, hasta hasMore=false.
//   3. Verificación: lo recibido debe sumar EXACTAMENTE los totales (número
//      de documentos, de renglones, débitos y créditos en centavos). Si no
//      cuadra -- p. ej. alguien guardó un documento mientras se leían las
//      páginas -- no se muestra un libro incompleto: se lanza un error con
//      la misma forma que un error de axios, para que los catch existentes
//      (getApiErrorMessage) muestren el mensaje tal cual.
//
// Los documentos tienen las mismas propiedades que los de GET /journal-entries
// (documentNumber, entryDate, annulled, reversal..., items[].accountCode...).
import api from "../services/api";

const PAGE_SIZE = 500;
const MAX_PAGES = 100000; // salvaguarda contra un cursor que no avanza

const MESSAGES = {
  es: {
    changed: "Los documentos cambiaron mientras se generaba el reporte (alguien guardó, editó o anuló uno). No se muestra un reporte incompleto: vuelve a generarlo.",
    stuck: "El servidor devolvió una paginación inválida. Vuelve a generar el reporte.",
  },
  en: {
    changed: "Entries changed while the report was being generated (someone saved, edited or annulled one). An incomplete report is not shown: generate it again.",
    stuck: "The server returned invalid pagination. Generate the report again.",
  },
};

function reportError(language, key) {
  const message = (MESSAGES[language] || MESSAGES.es)[key];
  const error = new Error(message);
  error.code = "JOURNAL_BOOK_MISMATCH";
  error.response = { data: { message } };
  return error;
}

/** Centavos exactos de un monto que llega como número (1234.5) o texto ("1234.50"). */
export function toCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.round(value * 100);
  const text = String(value).trim();
  const negative = text.startsWith("-");
  const [intPart, fracPart = ""] = text.replace(/^[-+]/, "").split(".");
  const cents = Number(intPart || "0") * 100 + Number((fracPart + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Parámetros de filtro comunes (los vacíos no se envían). */
function filterParams({ startDate, endDate, documentTypeId, searchTerm }) {
  const params = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  if (documentTypeId) params.documentTypeId = documentTypeId;
  if (searchTerm && String(searchTerm).trim()) params.searchTerm = searchTerm;
  return params;
}

/**
 * Trae todos los documentos que cumplen los filtros, página por página.
 * @param filters { startDate, endDate, documentTypeId, searchTerm }
 * @param options { language, onProgress(loaded, total) }
 * @returns { entries, totals } -- totals: { all, active, annulled }, cada uno
 *   { entryCount, lineCount, debit, credit } con los montos como texto exacto.
 */
export async function fetchJournalBook(filters, { language = "es", onProgress } = {}) {
  const base = filterParams(filters);
  const totalsResponse = await api.get("/v1/reports/journal-lines/totals", { params: base });
  const totals = totalsResponse.data?.data;
  const expected = totals?.all || { entryCount: 0, lineCount: 0, debit: "0", credit: "0" };
  onProgress?.(0, expected.entryCount);

  const entries = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { ...base, size: PAGE_SIZE };
    if (after) {
      params.afterDate = after.date;
      params.afterId = after.id;
    }
    const response = await api.get("/v1/reports/journal-lines", { params });
    const data = response.data?.data || {};
    const pageEntries = Array.isArray(data.entries) ? data.entries : [];
    entries.push(...pageEntries);
    onProgress?.(entries.length, expected.entryCount);
    if (!data.hasMore) {
      verify(entries, expected, language);
      return { entries, totals };
    }
    const next = { date: data.nextAfterDate, id: data.nextAfterId };
    if (!next.date || next.id == null || (after && after.date === next.date && String(after.id) === String(next.id))) {
      throw reportError(language, "stuck");
    }
    after = next;
  }
  throw reportError(language, "stuck");
}

function verify(entries, expected, language) {
  let lines = 0;
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    for (const item of entry.items || []) {
      lines += 1;
      debit += toCents(item.debit);
      credit += toCents(item.credit);
    }
  }
  const ok = entries.length === Number(expected.entryCount)
    && lines === Number(expected.lineCount)
    && debit === toCents(expected.debit)
    && credit === toCents(expected.credit);
  if (!ok) throw reportError(language, "changed");
}

/** Texto de avance para el botón / la pantalla: "Cargando 1.500 de 12.000 documentos…". */
export function journalBookProgressLabel(progress, language = "es") {
  if (!progress) return null;
  const locale = language === "en" ? "en-US" : "es-CO";
  const loaded = Number(progress.loaded || 0).toLocaleString(locale);
  const total = Number(progress.total || 0).toLocaleString(locale);
  return language === "en"
    ? `Loading ${loaded} of ${total} entries…`
    : `Cargando ${loaded} de ${total} documentos…`;
}
