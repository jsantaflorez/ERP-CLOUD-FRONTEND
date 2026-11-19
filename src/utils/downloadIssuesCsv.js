// NEW (2026-11-17, user request): descargas CSV de los importadores.
//
// Se generan 100% en el navegador a partir de datos que el backend YA
// devolvió (errores de validación, o la lista de cuentas creadas): no hay
// endpoint nuevo, ni CPU ni tráfico extra en Cloud Run (costo cero en la
// nube). CSV = texto plano, el formato más liviano, y Excel lo abre directo.
//
// Formato: separador ";" (el que Excel usa con configuración regional de
// Colombia/español, donde la coma es el decimal) y BOM UTF-8 para que las
// tildes y la Ñ se vean bien al abrirlo con doble clic.

const SEP = ";";
const BOM = "﻿";
const ROW_PREFIX = /^fila\s+(\d+)\s*:\s*/i;

function csvField(value) {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Descarga genérica: encabezados + filas (arreglos de valores) como CSV.
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @param {string} fileBaseName nombre base (sin extensión); se le agrega fecha y hora.
 */
export function downloadCsv(headers, rows, fileBaseName) {
  const lines = [headers, ...rows].map((r) => r.map(csvField).join(SEP));
  const blob = new Blob([BOM + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  a.href = url;
  a.download = `${fileBaseName}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Errores de un importador: una fila por mensaje.
 * @param {Array<{title: string, items?: string[]}>} sections grupos de
 *        errores (título del tipo de problema + mensajes del backend).
 * @param {object} opts
 * @param {string} opts.fileBaseName  nombre base del archivo (sin extensión).
 * @param {string[]} opts.headers     encabezados [tipo, fila, detalle].
 * @returns {number} cantidad de filas exportadas.
 */
export function downloadIssuesCsv(sections, { fileBaseName, headers }) {
  const rows = [];
  for (const { title, items } of sections) {
    for (const item of items || []) {
      const text = String(item ?? "");
      // "fila 12: 11-05 - CAJA" -> fila 12 en su propia columna, para poder
      // ordenar/filtrar en Excel. Los mensajes sin fila la dejan vacía.
      const m = text.match(ROW_PREFIX);
      rows.push([title, m ? m[1] : "", m ? text.slice(m[0].length) : text]);
    }
  }
  downloadCsv(headers, rows, fileBaseName);
  return rows.length;
}
