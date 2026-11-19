import { useEffect, useRef, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { inputClass } from "../ui/tokens";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import { downloadIssuesCsv } from "../../utils/downloadIssuesCsv";
import * as XLSX from "xlsx";
import { isZipXlsx, parseSiewinBalanceExcel } from "../../utils/siewinBalanceExcel";

// NEW (2026-11-12): Migración de Saldos de Apertura desde SIEWIN -- ver
// claude/analisis-migracion-saldos-siewin-2026-11-12.md para el diseño
// completo aprobado por el usuario.
//
// El archivo que exporta el RPV v.6 de SIEWIN ("Libro de Inventario y
// Balance de Cierre") NO es un .xlsx/.xls real -- es HTML malformado
// (celdas <TD> sin ninguna etiqueta <TR> de apertura) codificado en
// Latin-1/ISO-8859-1 (ver sección 6.1 del documento). Ninguna librería
// de hojas de cálculo (ni SheetJS, que este frontend ya usa para los
// importadores de PUC/Terceros, ni el backend) puede leerlo -- se probó
// explícitamente contra el archivo real. Por eso este importador NO usa
// `xlsx`: parseSiewinBalanceHtml() de abajo es un parser tolerante hecho
// a mano, basado en el análisis línea por línea del archivo real
// (invy_balance_navarra_2026), que:
//   1. Decodifica los bytes crudos como Latin-1 (nunca UTF-8 -- los
//      nombres con tildes/Ñ salen corruptos si no).
//   2. Trata cada línea física del archivo como una fila candidata.
//   3. Extrae el contenido de cada <TD>...</TD> en orden, quitando las
//      etiquetas internas (<FONT>, <i>, <b>) que SIEWIN nunca cierra.
//   4. La celda 0 es el código (de cuenta o de tercero), la celda 1 es
//      el nombre, y el saldo es la primera celda no vacía después de
//      esas dos que parsea como número -- su posición exacta varía según
//      la profundidad de la cuenta (es una columna indentada en el
//      reporte impreso), así que se busca por contenido, no por índice
//      fijo (sección 6.3).
// Ninguna clasificación de negocio (¿es cuenta? ¿es tercero? ¿es un
// "TOTAL" a descartar?) ocurre aquí -- eso cruza contra el PUC/Terceros
// ya migrados de la compañía y vive enteramente en
// SiewinBalanceImportService, igual que SiewinBalanceRowDTO documenta.
const TD_RE = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;

function stripTagsAndDecode(raw) {
  if (raw == null) return "";
  let s = String(raw).replace(/<[^>]*>/g, "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  return s.trim();
}

// Tolerante a enteros simples ("65579450"), signo al inicio o al final
// ("-254400" / "254400-"), paréntesis contables ("(254400)"), y
// separador de miles con punto + decimales con coma ("65.579.450,25") --
// el archivo real de Navarra solo usa el primer caso, pero otros clientes
// de SIEWIN podrían exportar con formato distinto.
function parseSiewinAmount(cellText) {
  let s = (cellText || "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    s = s.slice(1, -1).trim();
    neg = true;
  }
  if (s.endsWith("-")) {
    s = s.slice(0, -1).trim();
    neg = true;
  }
  if (s.startsWith("-")) {
    s = s.slice(1).trim();
    neg = true;
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

function parseSiewinBalanceHtml(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const rows = [];
  let idx = 0;
  for (const line of lines) {
    if (!line.includes("<TD") && !line.includes("<td")) continue;
    const cells = [];
    let m;
    TD_RE.lastIndex = 0;
    while ((m = TD_RE.exec(line)) !== null) {
      cells.push(stripTagsAndDecode(m[1]));
    }
    if (cells.length < 2) continue;

    const rawCode = cells[0];
    const name = cells[1];
    let amount = null;
    for (let i = 2; i < cells.length; i++) {
      const parsed = parseSiewinAmount(cells[i]);
      if (parsed !== null) {
        amount = parsed;
        break;
      }
    }

    rows.push({ rowIndex: idx, rawCode, name, amount });
    idx++;
  }
  // El backend nunca asume que esto ya se hizo (ver SiewinBalanceRowDTO),
  // pero se descartan aquí también las filas "TOTAL :" -- no traen un
  // código ni un saldo utilizable, su número vive como texto dentro de la
  // propia celda del código.
  return rows.filter((r) => r.rawCode && !/^total\b/i.test(r.rawCode));
}

// NEW (2026-11-18, user request): el archivo ya leído se conserva si el
// usuario sale de esta pantalla (p. ej. a Períodos Contables a configurar
// las cuentas de cierre) y vuelve, para no obligarlo a cargarlo de nuevo.
// Vive en memoria del módulo (no en localStorage): se pierde al recargar la
// página o cambiar de empresa, y solo se restaura para la misma compañía.
let draftCache = null;

function OpeningBalanceImportPage({ language = "es" }) {
  const { session } = useAuth();
  const draft = draftCache && String(draftCache.companyId) === String(session.companyId) ? draftCache : null;
  const [closingYear, setClosingYear] = useState(draft ? draft.closingYear : new Date().getFullYear() - 1);
  const [fileName, setFileName] = useState(draft ? draft.fileName : "");
  const [parsedRows, setParsedRows] = useState(draft ? draft.parsedRows : null);
  const [parseError, setParseError] = useState("");
  // NEW (2026-11-17): archivo editado y guardado en Excel (ver
  // utils/siewinBalanceExcel.js): códigos reconstruidos y celdas con fórmula.
  const [excelNotice, setExcelNotice] = useState(draft ? draft.excelNotice : null);
  // NEW (2026-11-18): un error de la migración (p. ej. cuentas de cierre sin
  // configurar) se queda en pantalla hasta el siguiente intento; antes era
  // un toast que desaparecía en segundos.
  const [importError, setImportError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [issues, setIssues] = useState(null);
  const [outOfBalanceList, setOutOfBalanceList] = useState(null);
  const [successResult, setSuccessResult] = useState(null);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  // NEW (2026-11-18): ¿ya existe un comprobante de apertura? Migrar de
  // nuevo lo reemplaza completo, incluidos los ajustes hechos a mano.
  const [openingStatus, setOpeningStatus] = useState(null);
  const loadOpeningStatus = async () => {
    try {
      const response = await api.get("/v1/journal-entries/opening-balance-status");
      setOpeningStatus(response.data?.data || null);
    } catch {
      setOpeningStatus(null); // solo informativo: sin estado no se muestra la advertencia
    }
  };
  useEffect(() => {
    loadOpeningStatus();
  }, []);

  useEffect(() => {
    draftCache = { companyId: session.companyId, closingYear, fileName, parsedRows, excelNotice };
  }, [session.companyId, closingYear, fileName, parsedRows, excelNotice]);

  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Migración de Saldos de Apertura (SIEWIN)",
      subtitle: "Carga el Libro de Inventario y Balance de Cierre exportado desde SIEWIN",
      yearLabel: "Año de cierre que estás migrando",
      yearHint: "El comprobante de apertura queda fechado el 31 de diciembre de este año.",
      warningTitle: "Antes de continuar",
      warningBody:
        "Esta carga reemplaza por completo cualquier comprobante de apertura anterior de esta compañía (se anula, nunca se edita a mano). Puedes volver a cargar el archivo cuantas veces lo necesites mientras el año no esté cerrado en el sistema, sin duplicar nada.",
      costCenterWarning:
        "Los centros de costo NO se migran con esta herramienta -- si algún cliente los usa en cuentas por cobrar u otras cuentas, esas cuentas deben quedar en cero en el archivo y migrarse a mano.",
      dropHint: "Arrastra el archivo aquí o haz clic para seleccionarlo",
      chooseFileButton: "Elegir archivo",
      changeFileButton: "Cambiar archivo",
      fileReadyPrefix: "Archivo leído:",
      rowsSuffix: "filas detectadas",
      parseEmpty: "El archivo no tiene filas reconocibles. Verifica que sea el export de SIEWIN (RPV v.6).",
      parseError: "No se pudo leer el archivo. Verifica que sea el export de SIEWIN (Libro de Inventario y Balance).",
      excelTitle: "Archivo de Excel leído correctamente",
      excelRebuilt: (n) => `Al guardar, Excel convierte algunos códigos de cuenta en fechas (por ejemplo, 11-05 en "11 de mayo"). Ya corregimos ${n} automáticamente; no necesitas hacer nada.`,
      excelNoDates: "No necesitas hacer nada.",
      excelShowCodes: "Ver códigos corregidos",
      excelFormulasTitle: "Revisa antes de migrar: hay celdas con fórmula",
      excelFormulasBody: "Se usará el resultado de la fórmula como saldo. Si es un saldo real, puedes continuar. Si es una suma que hiciste para verificar, bórrala del archivo: de lo contrario los subtotales no cuadrarán y la migración se detendrá sin guardar nada.",
      excelRowLabel: "fila",
      importErrorTitle: "No se pudo migrar",
      importErrorNothingSaved: "No se guardó nada. Corrige lo indicado y vuelve a pulsar el botón de migrar; no necesitas cargar el archivo de nuevo.",
      importButton: "Migrar Saldos de Apertura",
      // NEW (2026-11-18): el año va en el botón para que no se migre con el
      // año equivocado sin darse cuenta.
      importButtonWithYear: (y) => `Migrar saldos con cierre al 31/12/${y}`,
      issuesTitle: "El archivo tiene problemas que impiden la importación:",
      issueAccountNotFound: "Código de cuenta que no existe en el Plan de Cuentas",
      issueAccountInactive: "Cuenta que existe pero está inactiva (actívala en Plan de Cuentas)",
      accountNotFoundHint: "¿El PUC cambió en SIEWIN después de migrarlo? En Migración desde SIEWIN, paso 1, usa \"Agregar cuentas nuevas del PUC\" con el PUC actual y vuelve a cargar este archivo.",
      issueThirdPartyNotFound: "Tercero que no existe en el catálogo",
      issueCostCenterNotSupported: "Cuenta con Centro de Costo y saldo distinto de cero (no soportado)",
      issueThirdPartyMismatch: "El desglose de terceros no cuadra con el saldo de la cuenta",
      issueUnexpectedThirdParty: "Cuenta con desglose de terceros que no lo requiere",
      issueDuplicateLeafLines: "Cuenta/tercero que aparece más de una vez",
      issueMore: "más",
      downloadErrors: "Descargar errores (CSV)",
      csvHeaders: ["Tipo de problema", "Fila", "Detalle"],
      csvFileBase: "errores-migracion-saldos",
      outOfBalanceTitle: "Los subtotales del archivo no cuadran contra las cuentas recalculadas:",
      successTitle: "¡Saldos de apertura migrados!",
      successEntryPrefix: "Comprobante:",
      successAccountLines: "líneas de cuenta",
      successThirdPartyLines: "líneas de tercero",
      successNetResult: "Resultado neto:",
      successReplaced: "Se reemplazó el comprobante de apertura anterior de esta compañía.",
      existingTitle: (doc) => `Esta compañía ya tiene comprobante de apertura (${doc})`,
      existingBody: (date, n) => `Fechado el ${date}, con ${n} líneas. Si migras de nuevo, se reemplaza completo: el actual queda anulado (no se borra) y se pierden los ajustes que le hayas hecho a mano en Documentos Contables.`,
      editTip: "Puedes ajustar este comprobante en Documentos Contables. Si luego vuelves a migrar, el comprobante se reemplaza completo y esos ajustes se pierden.",
      successNotReplaced: "Primera carga de apertura para esta compañía.",
      duplicateBlocksTitle: "Bloques de filas duplicadas detectados y descartados automáticamente (bug conocido de SIEWIN RPV v.6):",
      importAnotherButton: "Cargar otro archivo",
      cancel: "Cancelar",
      errorConn: "Error de conexión. Intenta de nuevo.",
      invalidYear: "Indica un año válido.",
    },
    en: {
      title: "Opening Balance Migration (SIEWIN)",
      subtitle: "Upload the closing Inventory & Balance Book exported from SIEWIN",
      yearLabel: "Closing year you're migrating",
      yearHint: "The opening entry is dated December 31 of this year.",
      warningTitle: "Before you continue",
      warningBody:
        "This upload fully replaces any previous opening entry for this company (it's annulled, never hand-edited). You can re-upload the file as many times as needed while the year isn't closed in the system, without duplicating anything.",
      costCenterWarning:
        "Cost centers are NOT migrated by this tool -- if a client uses them on receivables or other accounts, those accounts must be zero in the file and migrated by hand.",
      dropHint: "Drag your file here or click to select it",
      chooseFileButton: "Choose file",
      changeFileButton: "Change file",
      fileReadyPrefix: "File read:",
      rowsSuffix: "rows detected",
      parseEmpty: "The file has no recognizable rows. Check that it's the SIEWIN export (RPV v.6).",
      parseError: "Could not read the file. Check that it's the SIEWIN export (Inventory & Balance Book).",
      excelTitle: "Excel file read correctly",
      excelRebuilt: (n) => `When saving, Excel turns some account codes into dates (e.g. 11-05 into "May 11"). We fixed ${n} automatically; you don't need to do anything.`,
      excelNoDates: "You don't need to do anything.",
      excelShowCodes: "Show fixed codes",
      excelFormulasTitle: "Check before migrating: some cells contain a formula",
      excelFormulasBody: "The formula result will be used as the balance. If it is a real balance, you can continue. If it is a sum you added to check totals, delete it from the file: otherwise the subtotals won't match and the migration will stop without saving anything.",
      excelRowLabel: "row",
      importErrorTitle: "The migration could not be completed",
      importErrorNothingSaved: "Nothing was saved. Fix what is indicated and press the migrate button again; you don't need to load the file again.",
      importButton: "Migrate Opening Balances",
      importButtonWithYear: (y) => `Migrate balances closing 12/31/${y}`,
      issuesTitle: "The file has problems that prevent importing:",
      issueAccountNotFound: "Account code not found in the Chart of Accounts",
      issueAccountInactive: "Account exists but is inactive (activate it in Chart of Accounts)",
      accountNotFoundHint: "Did the PUC change in SIEWIN after migrating it? In Migration from SIEWIN, step 1, use \"Add new PUC accounts\" with the current PUC and upload this file again.",
      issueThirdPartyNotFound: "Third party not found in the catalog",
      issueCostCenterNotSupported: "Account with a Cost Center and a non-zero balance (not supported)",
      issueThirdPartyMismatch: "The third-party breakdown doesn't match the account's balance",
      issueUnexpectedThirdParty: "Account with a third-party breakdown that isn't required",
      issueDuplicateLeafLines: "Account/third party appears more than once",
      issueMore: "more",
      downloadErrors: "Download errors (CSV)",
      csvHeaders: ["Problem type", "Row", "Detail"],
      csvFileBase: "balance-migration-errors",
      outOfBalanceTitle: "The file's subtotals don't match the recalculated accounts:",
      successTitle: "Opening balances migrated!",
      successEntryPrefix: "Entry:",
      successAccountLines: "account lines",
      successThirdPartyLines: "third-party lines",
      successNetResult: "Net result:",
      successReplaced: "The company's previous opening entry was replaced.",
      existingTitle: (doc) => `This company already has an opening entry (${doc})`,
      existingBody: (date, n) => `Dated ${date}, with ${n} lines. Migrating again replaces it completely: the current one is annulled (not deleted) and any manual adjustments made to it in Journal Entries are lost.`,
      editTip: "You can adjust this entry in Journal Entries. If you migrate again later, the entry is replaced completely and those adjustments are lost.",
      successNotReplaced: "First opening upload for this company.",
      duplicateBlocksTitle: "Duplicate row blocks detected and automatically dropped (known SIEWIN RPV v.6 bug):",
      importAnotherButton: "Upload another file",
      cancel: "Cancel",
      errorConn: "Connection error. Please try again.",
      invalidYear: "Enter a valid year.",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const resetFileState = () => {
    setFileName("");
    setParsedRows(null);
    setParseError("");
    setExcelNotice(null);
    setImportError("");
    setIssues(null);
    setOutOfBalanceList(null);
  };

  const processFile = async (file) => {
    if (!file) return;
    resetFileState();
    setSuccessResult(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      let rows;
      if (isZipXlsx(buffer)) {
        // NEW (2026-11-17): .xlsx real (abierto y guardado en Excel, p. ej.
        // para agregar a mano el nivel 5 que SIEWIN no exporta).
        const parsed = parseSiewinBalanceExcel(buffer, XLSX);
        rows = parsed.rows;
        setExcelNotice({ rebuiltCodes: parsed.rebuiltCodes, formulaCells: parsed.formulaCells });
      } else {
        const text = new TextDecoder("iso-8859-1").decode(buffer);
        rows = parseSiewinBalanceHtml(text);
      }
      if (rows.length === 0) {
        setParseError(t.parseEmpty);
        setParsedRows(null);
        return;
      }
      setParsedRows(rows);
    } catch {
      setParseError(t.parseError);
      setParsedRows(null);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) processFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleImport = async () => {
    if (!parsedRows || parsedRows.length === 0) return;
    const year = parseInt(closingYear, 10);
    if (!year || year < 1900 || year > 2100) {
      showToast(t.invalidYear, "error");
      return;
    }
    setImporting(true);
    setIssues(null);
    setOutOfBalanceList(null);
    setImportError("");
    try {
      const response = await api.post("/v1/journal-entries/import-opening-balances-siewin", {
        closingYear: year,
        rows: parsedRows,
      });
      if (response.data && response.data.success) {
        const result = response.data.data || {};
        setSuccessResult(result);
        loadOpeningStatus();
        setParsedRows(null);
        showToast(t.successTitle);
      } else {
        setImportError(response.data?.message || t.errorConn);
      }
    } catch (error) {
      const code = error?.response?.data?.message;
      const details = error?.response?.data?.data;
      if (code === "SIEWIN_BALANCE_IMPORT_INTEGRITY_GAP" && details) {
        setIssues(details);
      } else if (code === "SIEWIN_BALANCE_OUT_OF_BALANCE" && details) {
        setOutOfBalanceList(details);
      } else {
        setImportError(getApiErrorMessage(error, language, t.errorConn));
      }
    } finally {
      setImporting(false);
    }
  };

  const startOver = () => {
    resetFileState();
    setSuccessResult(null);
  };

  return (
    <div className="space-y-6 p-4">
      <AppHeader title={t.title} subtitle={t.subtitle} tenantId={activeTenantId} language={language} />

      <Alert tone="warning" title={t.warningTitle}>
        <p>{t.warningBody}</p>
        <p className="mt-2">{t.costCenterWarning}</p>
      </Alert>

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-5 max-w-2xl">
        {!successResult && (
          <>
            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">
                {t.yearLabel}
              </label>
              <input
                type="number"
                className={`${inputClass()} max-w-[140px]`}
                value={closingYear}
                min={1900}
                max={2100}
                onChange={(e) => setClosingYear(e.target.value)}
                disabled={importing}
              />
              <p className="mt-1 text-[11px] text-slate-500">{t.yearHint}</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.htm,.html"
              className="hidden"
              onChange={handleFileChange}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                parsedRows
                  ? "border-emerald-300 bg-emerald-50"
                  : dragOver
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-slate-200 bg-slate-50 hover:border-indigo-300"
              }`}
            >
              <svg className="mx-auto h-8 w-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="mt-2 text-sm font-semibold text-slate-600">
                {fileName ? `${t.fileReadyPrefix} ${fileName}` : t.dropHint}
              </p>
              {parsedRows && (
                <p className="mt-1 text-xs text-emerald-600">{parsedRows.length} {t.rowsSuffix}</p>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                {fileName ? t.changeFileButton : t.chooseFileButton}
              </Button>
            </div>

            {parseError && <Alert tone="error">{parseError}</Alert>}

            {excelNotice && !parseError && (
              <Alert tone="success" title={t.excelTitle}>
                <p>
                  {excelNotice.rebuiltCodes.length > 0
                    ? t.excelRebuilt(excelNotice.rebuiltCodes.length)
                    : t.excelNoDates}
                </p>
                {excelNotice.rebuiltCodes.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs underline">{t.excelShowCodes}</summary>
                    <p className="mt-1 font-mono text-xs">
                      {excelNotice.rebuiltCodes.map((c) => `${t.excelRowLabel} ${c.row}: ${c.code}`).join(" · ")}
                    </p>
                  </details>
                )}
              </Alert>
            )}
            {importError && (
              <Alert tone="error" title={t.importErrorTitle}>
                <p>{importError}</p>
                <p className="mt-1 text-xs">{t.importErrorNothingSaved}</p>
              </Alert>
            )}
            {excelNotice && !parseError && excelNotice.formulaCells.length > 0 && (
              <Alert tone="warning" title={t.excelFormulasTitle}>
                <p>{t.excelFormulasBody}</p>
                <ul className="ml-4 mt-1 list-disc font-mono text-xs">
                  {excelNotice.formulaCells.map((f) => (
                    <li key={`${f.row}-${f.formula}`}>
                      {t.excelRowLabel} {f.row}: {f.formula} = {String(f.value)}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}

            {issues && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{t.issuesTitle}</p>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => downloadIssuesCsv(
                      [
                        { title: t.issueAccountNotFound, items: issues.accountNotFound },
                        { title: t.issueAccountInactive, items: issues.accountInactive },
                        { title: t.issueThirdPartyNotFound, items: issues.thirdPartyNotFound },
                        { title: t.issueCostCenterNotSupported, items: issues.costCenterNotSupported },
                        { title: t.issueThirdPartyMismatch, items: issues.thirdPartyMismatch },
                        { title: t.issueUnexpectedThirdParty, items: issues.unexpectedThirdParty },
                        { title: t.issueDuplicateLeafLines, items: issues.duplicateLeafLines },
                      ],
                      { fileBaseName: t.csvFileBase, headers: t.csvHeaders }
                    )}
                  >
                    {t.downloadErrors}
                  </Button>
                </div>
                <IssueList title={t.issueAccountNotFound} items={issues.accountNotFound} moreLabel={t.issueMore} />
                {issues.accountNotFound?.length > 0 && (
                  <p className="rounded-md bg-white/70 px-2 py-1.5 text-slate-700">{t.accountNotFoundHint}</p>
                )}
                <IssueList title={t.issueAccountInactive} items={issues.accountInactive} moreLabel={t.issueMore} />
                <IssueList title={t.issueThirdPartyNotFound} items={issues.thirdPartyNotFound} moreLabel={t.issueMore} />
                <IssueList title={t.issueCostCenterNotSupported} items={issues.costCenterNotSupported} moreLabel={t.issueMore} />
                <IssueList title={t.issueThirdPartyMismatch} items={issues.thirdPartyMismatch} moreLabel={t.issueMore} />
                <IssueList title={t.issueUnexpectedThirdParty} items={issues.unexpectedThirdParty} moreLabel={t.issueMore} />
                <IssueList title={t.issueDuplicateLeafLines} items={issues.duplicateLeafLines} moreLabel={t.issueMore} />
              </div>
            )}

            {outOfBalanceList && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 space-y-3">
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => downloadIssuesCsv(
                      [{ title: t.outOfBalanceTitle, items: outOfBalanceList }],
                      { fileBaseName: t.csvFileBase, headers: t.csvHeaders }
                    )}
                  >
                    {t.downloadErrors}
                  </Button>
                </div>
                <IssueList title={t.outOfBalanceTitle} items={outOfBalanceList} moreLabel={t.issueMore} />
              </div>
            )}

            {openingStatus?.exists && (
              <Alert tone="warning" title={t.existingTitle(openingStatus.documentNumber)}>
                <p>
                  {t.existingBody(
                    openingStatus.entryDate
                      ? new Date(`${openingStatus.entryDate}T00:00:00`).toLocaleDateString(language === "en" ? "en-US" : "es-CO")
                      : "",
                    openingStatus.lineCount
                  )}
                </p>
              </Alert>
            )}

            <Button
              type="button"
              variant="primary"
              fullWidth
              loading={importing}
              disabled={!parsedRows || parsedRows.length === 0}
              onClick={handleImport}
            >
              {/^\d{4}$/.test(String(closingYear)) ? t.importButtonWithYear(closingYear) : t.importButton}
            </Button>
          </>
        )}

        {successResult && (
          <div className="space-y-3">
            <Alert tone="success" title={t.successTitle}>
              <p>
                {t.successEntryPrefix} <span className="font-semibold">{successResult.openingEntryDocumentNumber}</span>
                {" · "}
                {successResult.accountLinesPosted} {t.successAccountLines}
                {" · "}
                {successResult.thirdPartyLinesPosted} {t.successThirdPartyLines}
              </p>
              <p className="mt-1">{t.successNetResult} {successResult.netResult}</p>
              <p className="mt-1">{successResult.replacedExistingEntry ? t.successReplaced : t.successNotReplaced}</p>
              <p className="mt-1">{t.editTip}</p>
            </Alert>

            {successResult.duplicateBlocksRemoved?.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-2">
                <IssueList title={t.duplicateBlocksTitle} items={successResult.duplicateBlocksRemoved} moreLabel={t.issueMore} />
              </div>
            )}

            <Button type="button" variant="secondary" onClick={startOver}>
              {t.importAnotherButton}
            </Button>
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${toast.type === "error" ? "bg-red-700" : "bg-emerald-700"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// Mismo patrón "primeros 20 + '...N más'" que los otros importadores
// SIEWIN (ChartOfAccountPage.jsx / ThirdPartyPage.jsx). No renderiza nada
// cuando la categoría no tiene violaciones.
function IssueList({ title, items, moreLabel }) {
  if (!items || items.length === 0) return null;
  const shown = items.slice(0, 20);
  const extra = items.length - shown.length;
  return (
    <div>
      <p className="font-semibold">{title} ({items.length})</p>
      <ul className="mt-1 max-h-28 overflow-y-auto list-disc pl-4">
        {shown.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
      {extra > 0 && <p className="mt-1 italic">...{extra} {moreLabel}</p>}
    </div>
  );
}

export default OpeningBalanceImportPage;
