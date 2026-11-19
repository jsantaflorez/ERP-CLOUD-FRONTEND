// NEW (2026-11-17): lectura del Inventario y Balance de SIEWIN cuando el
// archivo se abrió, se editó y se guardó en Excel (un .xlsx real).
//
// Caso real (Navarra): SIEWIN exporta el balance solo hasta el nivel 4, y
// el contador agrega a mano en Excel el detalle de nivel 5 (la cartera por
// casa). Al guardar, Excel convierte en FECHA los códigos de 2 y 3 tramos
// que parecen fechas: "11-05" -> 11/may/<año actual>, "11-05-05" ->
// 11/may/2005, "27-05-50" -> 27/may/1950. Los de 4+ tramos ("11-05-05-01")
// y los números (grupos "11", documentos de terceros) no se tocan.
//
// Aquí se reconstruye el código original desde la celda de fecha:
//   día-mes            si el año es el de la edición (Excel pone el año en
//                      curso cuando el texto tenía solo dos tramos)
//   día-mes-aa         en otro caso (aa = año % 100)
// Único caso ambiguo: un código de 3 tramos cuyo tercer tramo coincide con
// el año en curso ("xx-yy-26" en 2026). Se resuelve mirando el siguiente
// código de cuenta del archivo: si empieza por "xx-yy-26-", era de 3 tramos.
// Si aun así algo quedara mal, el backend lo detecta (cuenta inexistente o
// subtotales que no cuadran) y no importa nada.
//
// Devuelve las mismas filas que parseSiewinBalanceHtml():
//   { rowIndex, rawCode, name, amount }
// con rowIndex = número de fila de Excel, para que el usuario la ubique.

const ACCOUNT_CODE = /^\d{1,2}(-\d+)+$/;
const TOTAL_ROW = /^total\b/i;

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Formato de número que muestra una fecha (d, m, y fuera de comillas y de
// corchetes de color/condición). Se evita depender de XLSX.SSF, que no
// siempre se expone en el build ESM de SheetJS.
function isDateFormat(fmt) {
  if (!fmt || fmt === "General") return false;
  const cleaned = String(fmt).replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[dmy]/i.test(cleaned);
}

// Serial de Excel -> {y, m, d}, en UTC para no depender de la zona horaria.
function serialToDate(serial, date1904) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const dt = new Date(base + Math.floor(serial) * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** true si el ArrayBuffer es un .xlsx real (zip: empieza por "PK"). */
export function isZipXlsx(buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b;
}

/**
 * @param {ArrayBuffer} buffer contenido del .xlsx
 * @param {object} XLSX el módulo SheetJS (import * as XLSX from "xlsx")
 * @returns {{ rows: Array<{rowIndex:number, rawCode:string, name:string, amount:number|null}>,
 *             rebuiltCodes: Array<{row:number, code:string}>,
 *             formulaCells: Array<{row:number, formula:string, value:unknown}> }}
 */
export function parseSiewinBalanceExcel(buffer, XLSX) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false, cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const date1904 = Boolean(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  if (!ws || !ws["!ref"]) return { rows: [], rebuiltCodes: [], formulaCells: [] };
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // 1) Celdas no vacías de cada fila, conservando el tipo (fecha / número / texto).
  const sheetRows = [];
  // Celdas con fórmula: se usa el valor calculado que guardó Excel, pero se
  // listan para que el usuario confirme que no son totales de control
  // (caso real: "=SUMA(C20:C23)" escrito en la fila de una casa).
  const formulaCells = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
      const isDate = cell.t === "n" && isDateFormat(cell.z);
      if (cell.f) {
        formulaCells.push({ row: r + 1, formula: `=${cell.f}`, value: cell.v });
      }
      cells.push({ v: cell.v, isDate, isNumber: cell.t === "n" && !isDate });
    }
    sheetRows.push({ excelRow: r + 1, cells });
  }

  // Año que Excel asigna a "dd-mm": el de la edición (se acepta ±1 por si
  // el archivo se editó cerca del cambio de año).
  const currentYear = new Date().getFullYear();

  // Códigos de texto (no convertidos) en orden, para la búsqueda hacia adelante.
  const textCodes = [];
  sheetRows.forEach((sr, i) => {
    const first = sr.cells[0];
    if (first && typeof first.v === "string" && ACCOUNT_CODE.test(first.v.trim())) {
      textCodes.push({ i, code: first.v.trim() });
    }
  });
  const nextTextCode = (i) => {
    const found = textCodes.find((tc) => tc.i > i);
    return found ? found.code : "";
  };

  const rows = [];
  const rebuiltCodes = [];
  sheetRows.forEach((sr, i) => {
    if (sr.cells.length < 2) return;
    const first = sr.cells[0];
    let code;
    if (first.isDate) {
      const d = serialToDate(first.v, date1904);
      const two = `${pad2(d.d)}-${pad2(d.m)}`;
      const three = `${two}-${pad2(d.y % 100)}`;
      const sameYear = d.y === currentYear || d.y === currentYear - 1 || d.y === currentYear + 1;
      code = sameYear && !nextTextCode(i).startsWith(`${three}-`) ? two : three;
      rebuiltCodes.push({ row: sr.excelRow, code });
    } else if (first.isNumber) {
      code = String(Math.trunc(first.v));
    } else {
      code = String(first.v).trim();
    }
    if (!code || TOTAL_ROW.test(code)) return;

    const name = String(sr.cells[1].v ?? "").trim();
    let amount = null;
    for (let k = 2; k < sr.cells.length; k++) {
      const cell = sr.cells[k];
      if (cell.isNumber) {
        amount = cell.v;
        break;
      }
      if (typeof cell.v === "string") {
        const n = Number(cell.v.replace(/\./g, "").replace(",", "."));
        if (cell.v.trim() !== "" && Number.isFinite(n)) {
          amount = n;
          break;
        }
      }
    }
    rows.push({ rowIndex: sr.excelRow, rawCode: code, name, amount });
  });

  return { rows, rebuiltCodes, formulaCells };
}
