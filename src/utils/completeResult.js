// src/utils/completeResult.js
//
// Bloque 0.4 (auditoria 2026-11-19, F1-25). Reports that ask the backend for
// "everything" in one page (size: 10000) were silently truncated: Spring Data
// caps a page at 2.000 rows by default, and these screens used `content`
// without looking at `totalElements`. The Libro Diario of a company with
// 2.500 entries showed 2.000, with totals that still balanced on their own.
//
// completeContent() returns the page content only when it is the WHOLE
// result. If the backend says there are more rows than it returned, it
// throws, and the screen shows the message instead of an incomplete report.
// The error has the same shape as an axios error ({ response.data.message })
// so the existing catch blocks (getApiErrorMessage) display it unchanged.

const MESSAGES = {
  es: (shown, total) =>
    `El resultado tiene ${total.toLocaleString("es-CO")} comprobantes y el servidor solo entregó ${shown.toLocaleString("es-CO")}. ` +
    "No se muestra un reporte incompleto: reduce el rango de fechas o filtra por tipo de documento.",
  en: (shown, total) =>
    `The result has ${total.toLocaleString("en-US")} entries but the server only returned ${shown.toLocaleString("en-US")}. ` +
    "An incomplete report is not shown: narrow the date range or filter by document type.",
};

export function completeContent(pageData, language = "es") {
  const content = Array.isArray(pageData?.content) ? pageData.content : [];
  const total = Number(pageData?.totalElements);
  if (Number.isFinite(total) && total > content.length) {
    const message = (MESSAGES[language] || MESSAGES.es)(content.length, total);
    const error = new Error(message);
    error.code = "INCOMPLETE_RESULT";
    error.response = { data: { message } };
    throw error;
  }
  return content;
}
