import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  addPdfReportHeader,
  addPdfRunningHeader,
  buildExcelHeaderRows,
  nowLocalIso,
  todayLocalIso,
} from "../../utils/reportExport";

// NEW (2026-10-25, user request): "Buscador de Movimientos por Valor" --
// an audit tool for the "Gestión y Terceros" report group, same family
// as IncompleteMovementsPage.jsx (whose "Editar" cross-navigation into
// Asientos Contables this page reuses as-is via the onEditEntry prop
// Dashboard.jsx already wires up). Finds every journal entry LINE (not
// whole vouchers) whose Debit OR Credit matches a value condition --
// exact, less-than, greater-than, or a range/tolerance -- in a date
// range. The classic use case: a contador knows a bank statement or an
// invoice is off by some amount but doesn't remember the exact posted
// figure to the cent, so they search a tolerance band around what they
// do remember instead of scanning the whole Libro Diario by eye.
//
// Design decisions made explicitly with the user (2026-10-25):
//   1. The value match checks BOTH Debit and Credit on each line (not a
//      separate selector to pick one) -- a line only ever has one of the
//      two non-zero anyway, so this just means "match this line
//      regardless of which side it posted to". Each result row shows
//      which side actually matched ("DB"/"CR"), same convention already
//      used by IncompleteMovementsPage.jsx's own "value (side)" column.
//   2. "Rango / Tolerancia" has two sub-modes: an explicit "Entre A y B"
//      range, or a "Valor ± Margen" center-and-tolerance pair (the
//      margin case is what the spec's "no recuerdan la cifra exacta"
//      note is actually asking for -- a plain A/B range would have made
//      the user do that +/- math themselves).
//
// Pure frontend tool: reuses GET /v1/journal-entries for the date range
// (same "fetch everything, compute client-side" pattern as every other
// report here) and GET /v1/document-types for the optional type filter;
// the value matching itself runs entirely in the browser over whatever
// was already fetched, so changing the operator/value after a search
// re-filters instantly without hitting the server again.
function ValueSearchPage({ language = "es", onEditEntry }) {
  const today = todayLocalIso();
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [includeAnnulled, setIncludeAnnulled] = useState(true);

  const [operator, setOperator] = useState("EQ"); // EQ | LT | GT | RANGE
  const [value, setValue] = useState("");
  const [rangeMode, setRangeMode] = useState("BETWEEN"); // BETWEEN | MARGIN
  const [valueA, setValueA] = useState("");
  const [valueB, setValueB] = useState("");
  const [centerValue, setCenterValue] = useState("");
  const [marginValue, setMarginValue] = useState("");

  const [documentTypes, setDocumentTypes] = useState([]);
  const [entries, setEntries] = useState(null); // null = not searched yet
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [editingEntryId, setEditingEntryId] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Buscador de Movimientos por Valor",
      subtitle: "Busca líneas de comprobantes por un valor exacto, menor, mayor, o dentro de un rango/tolerancia",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      documentType: "Tipo de Documento",
      allDocumentTypes: "— Todos los tipos —",
      includeAnnulled: "Incluir Documentos Anulados",
      operator: "Operador",
      operatorEq: "= (Igual a valor exacto)",
      operatorLt: "< (Menor que)",
      operatorGt: "> (Mayor que)",
      operatorRange: "Rango / Tolerancia",
      value: "Valor",
      rangeMode: "Modo",
      rangeModeBetween: "Entre A y B",
      rangeModeMargin: "Valor ± Margen",
      valueA: "Valor A",
      valueB: "Valor B",
      centerValue: "Valor Central",
      margin: "Margen (±)",
      marginHint: (min, max) => `= entre ${min} y ${max}`,
      generate: "Buscar",
      generating: "Buscando...",
      dateRequired: "Selecciona la fecha inicial y la fecha final para buscar.",
      dateRangeInvalid: "La fecha final no puede ser anterior a la fecha inicial.",
      valueRequired: "Ingresa un valor numérico válido.",
      rangeRequired: "Ingresa el Valor A y el Valor B.",
      marginRequired: "Ingresa el valor central y el margen.",
      marginInvalid: "El margen no puede ser negativo.",
      noResults: "No se encontraron líneas que coincidan con el valor buscado.",
      date: "Fecha",
      document: "Comprobante",
      documentTypeCol: "Tipo",
      account: "Cuenta",
      thirdParty: "Tercero",
      costCenter: "C. Costo",
      detail: "Detalle",
      amount: "Valor",
      actions: "Acción",
      edit: "Editar",
      annulled: "Anulado",
      totalRecords: "Líneas Encontradas",
      totalAmount: "Suma de Valores",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      exportTitle: "Buscador de Movimientos por Valor",
      exporting: "Exportando...",
      noDocType: "—",
    },
    en: {
      title: "Movement Value Search",
      subtitle: "Search voucher lines by an exact, less-than, greater-than, or range/tolerance value",
      startDate: "Start Date",
      endDate: "End Date",
      documentType: "Document Type",
      allDocumentTypes: "— All types —",
      includeAnnulled: "Include Annulled Vouchers",
      operator: "Operator",
      operatorEq: "= (Exact value)",
      operatorLt: "< (Less than)",
      operatorGt: "> (Greater than)",
      operatorRange: "Range / Tolerance",
      value: "Value",
      rangeMode: "Mode",
      rangeModeBetween: "Between A and B",
      rangeModeMargin: "Value ± Margin",
      valueA: "Value A",
      valueB: "Value B",
      centerValue: "Center Value",
      margin: "Margin (±)",
      marginHint: (min, max) => `= between ${min} and ${max}`,
      generate: "Search",
      generating: "Searching...",
      dateRequired: "Select a start date and an end date to search.",
      dateRangeInvalid: "End date can't be before start date.",
      valueRequired: "Enter a valid numeric value.",
      rangeRequired: "Enter Value A and Value B.",
      marginRequired: "Enter the center value and the margin.",
      marginInvalid: "The margin can't be negative.",
      noResults: "No lines matched the searched value.",
      date: "Date",
      document: "Voucher",
      documentTypeCol: "Type",
      account: "Account",
      thirdParty: "Third Party",
      costCenter: "Cost Center",
      detail: "Detail",
      amount: "Value",
      actions: "Action",
      edit: "Edit",
      annulled: "Voided",
      totalRecords: "Lines Found",
      totalAmount: "Sum of Values",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      exportTitle: "Movement Value Search",
      exporting: "Exporting...",
      noDocType: "—",
    },
  }[language];

  const money = (n) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(language === "es" ? "es-CO" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  useEffect(() => {
    api
      .get("/v1/document-types")
      .then((res) => {
        const data = res.data?.data ?? res.data;
        setDocumentTypes(Array.isArray(data) ? data : []);
      })
      .catch(() => setDocumentTypes([]));
  }, []);

  const documentTypeById = (id) => documentTypes.find((d) => String(d.id) === String(id));
  const documentTypeLabel = (entry) => {
    const dt = documentTypeById(entry.documentTypeId);
    return dt ? `${dt.code} - ${dt.name}` : t.noDocType;
  };

  // Live preview of the effective min/max while in "Valor ± Margen" mode,
  // so the user sees exactly what range they're about to search before
  // clicking Buscar.
  const marginPreview = useMemo(() => {
    if (operator !== "RANGE" || rangeMode !== "MARGIN") return null;
    const center = Number(centerValue);
    const margin = Number(marginValue);
    if (!Number.isFinite(center) || !Number.isFinite(margin) || margin < 0) return null;
    return { min: money(center - margin), max: money(center + margin) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator, rangeMode, centerValue, marginValue, language]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError(t.dateRequired);
      return;
    }
    if (endDate < startDate) {
      setError(t.dateRangeInvalid);
      return;
    }

    if (operator === "RANGE") {
      if (rangeMode === "BETWEEN") {
        if (valueA === "" || valueB === "" || !Number.isFinite(Number(valueA)) || !Number.isFinite(Number(valueB))) {
          setError(t.rangeRequired);
          return;
        }
      } else {
        if (centerValue === "" || marginValue === "" || !Number.isFinite(Number(centerValue)) || !Number.isFinite(Number(marginValue))) {
          setError(t.marginRequired);
          return;
        }
        if (Number(marginValue) < 0) {
          setError(t.marginInvalid);
          return;
        }
      }
    } else if (value === "" || !Number.isFinite(Number(value))) {
      setError(t.valueRequired);
      return;
    }

    setLoading(true);
    setEntries(null);
    try {
      // Same "fetch everything matching the date/type filters in one
      // shot" pattern used by every other report here -- the value
      // condition itself is applied client-side in `results` below, not
      // sent to the backend, so tweaking it afterwards re-filters
      // instantly without a new request.
      const response = await api.get("/v1/journal-entries", {
        params: {
          startDate,
          endDate,
          ...(documentTypeId ? { documentTypeId } : {}),
          page: 0,
          size: 10000,
          sort: "entryDate,asc",
        },
      });
      const pageData = response.data?.data;
      setEntries(Array.isArray(pageData?.content) ? pageData.content : []);
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setLoading(false);
    }
  };

  // One row per matching LINE (not per voucher) -- a line only ever has
  // one of debit/credit non-zero, so checking both just means "match
  // this line regardless of which side it posted to"; `side` records
  // which one actually matched for display.
  const results = useMemo(() => {
    if (!Array.isArray(entries)) return null;

    const EPS = 0.005;
    let matcher = null;

    if (operator === "EQ") {
      const target = Number(value);
      if (Number.isFinite(target)) matcher = (v) => Math.abs(v - target) < EPS;
    } else if (operator === "LT") {
      const target = Number(value);
      if (Number.isFinite(target)) matcher = (v) => v < target;
    } else if (operator === "GT") {
      const target = Number(value);
      if (Number.isFinite(target)) matcher = (v) => v > target;
    } else if (operator === "RANGE") {
      let min = null;
      let max = null;
      if (rangeMode === "BETWEEN") {
        const a = Number(valueA);
        const b = Number(valueB);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          min = Math.min(a, b);
          max = Math.max(a, b);
        }
      } else {
        const center = Number(centerValue);
        const margin = Number(marginValue);
        if (Number.isFinite(center) && Number.isFinite(margin) && margin >= 0) {
          min = center - margin;
          max = center + margin;
        }
      }
      if (min != null && max != null) {
        matcher = (v) => v >= min - EPS && v <= max + EPS;
      }
    }

    if (!matcher) return [];

    const filteredEntries = includeAnnulled ? entries : entries.filter((e) => !e.annulled);
    const rows = [];
    filteredEntries.forEach((entry) => {
      (entry.items || []).forEach((item) => {
        if (item.debit > 0 && matcher(item.debit)) {
          rows.push({ entry, item, side: "DB", amount: item.debit });
        }
        if (item.credit > 0 && matcher(item.credit)) {
          rows.push({ entry, item, side: "CR", amount: item.credit });
        }
      });
    });

    rows.sort((a, b) => {
      if (a.entry.entryDate !== b.entry.entryDate) return a.entry.entryDate < b.entry.entryDate ? -1 : 1;
      return (a.entry.consecutive || 0) - (b.entry.consecutive || 0);
    });

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, operator, value, rangeMode, valueA, valueB, centerValue, marginValue, includeAnnulled, documentTypes]);

  const hasSearched = entries !== null;
  const hasData = Array.isArray(results) && results.length > 0;
  const totalAmount = (results || []).reduce((s, r) => s + r.amount, 0);

  const reportPeriodLabel = () => `${startDate} — ${endDate}`;
  const exportFileStem = () => `${t.exportTitle.replace(/\s+/g, "_")}_${startDate}_${endDate}`;

  const handleEdit = (journalEntryId) => {
    setEditingEntryId(journalEntryId);
    onEditEntry?.(journalEntryId);
  };

  const handleExportExcel = () => {
    if (!hasData) return;
    setExporting(true);
    try {
      const headerInfo = {
        companyName: activeTenantId,
        reportTitle: t.exportTitle,
        period: reportPeriodLabel(),
        generatedAtLabel: t.generatedAt,
        generatedAt: nowLocalIso(),
      };

      const rows = [
        ...buildExcelHeaderRows(headerInfo),
        [t.date, t.document, t.documentTypeCol, t.account, t.thirdParty, t.costCenter, t.detail, t.amount],
        ...results.map((r) => [
          r.entry.entryDate,
          r.entry.annulled ? `${r.entry.documentNumber} (${t.annulled.toUpperCase()})` : r.entry.documentNumber,
          documentTypeLabel(r.entry),
          `${r.item.accountCode} - ${r.item.accountName}`,
          r.item.thirdPartyName || "",
          r.item.costCenterName || "",
          r.item.description || "",
          r.side === "DB" ? r.amount : -r.amount,
        ]),
        [],
        [t.totalRecords, results.length],
        [t.totalAmount, totalAmount],
      ];

      const sheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, t.exportTitle.slice(0, 31));
      XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = () => {
    if (!hasData) return;
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      const bottomMargin = 15;

      const headerInfo = {
        companyName: activeTenantId,
        reportTitle: t.exportTitle,
        period: reportPeriodLabel(),
        generatedAtLabel: t.generatedAt,
        generatedAt: nowLocalIso(),
      };

      const cursorY = addPdfReportHeader(doc, headerInfo);

      const body = results.map((r) => [
        r.entry.entryDate,
        r.entry.annulled ? `${r.entry.documentNumber} (${t.annulled.toUpperCase()})` : r.entry.documentNumber,
        documentTypeLabel(r.entry),
        `${r.item.accountCode} - ${r.item.accountName}`,
        r.item.thirdPartyName || "—",
        r.item.costCenterName || "—",
        r.item.description || "—",
        `${money(r.amount)} (${r.side})`,
      ]);

      const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

      autoTable(doc, {
        startY: cursorY,
        head: [[t.date, t.document, t.documentTypeCol, t.account, t.thirdParty, t.costCenter, t.detail, t.amount]],
        body,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: { 6: { cellWidth: 40 }, 7: { halign: "right" } },
        margin: { top: 20, bottom: bottomMargin },
        didDrawPage: (data) => {
          if (data.pageNumber > pageBeforeTable) {
            addPdfRunningHeader(doc, headerInfo);
          }
        },
      });

      doc.save(`${exportFileStem()}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      <AppHeader title={t.title} subtitle={t.subtitle} tenantId={activeTenantId} />

      <form
        onSubmit={handleGenerate}
        className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.startDate}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.endDate}
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex min-w-[220px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.documentType}
          </label>
          <select
            value={documentTypeId}
            onChange={(e) => setDocumentTypeId(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allDocumentTypes}</option>
            {documentTypes.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.code} - {dt.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-[200px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.operator}
          </label>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="EQ">{t.operatorEq}</option>
            <option value="LT">{t.operatorLt}</option>
            <option value="GT">{t.operatorGt}</option>
            <option value="RANGE">{t.operatorRange}</option>
          </select>
        </div>

        {operator !== "RANGE" && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {t.value}
            </label>
            <input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        )}

        {operator === "RANGE" && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t.rangeMode}
              </label>
              <select
                value={rangeMode}
                onChange={(e) => setRangeMode(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="BETWEEN">{t.rangeModeBetween}</option>
                <option value="MARGIN">{t.rangeModeMargin}</option>
              </select>
            </div>

            {rangeMode === "BETWEEN" ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {t.valueA}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={valueA}
                    onChange={(e) => setValueA(e.target.value)}
                    className="w-36 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {t.valueB}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={valueB}
                    onChange={(e) => setValueB(e.target.value)}
                    className="w-36 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {t.centerValue}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={centerValue}
                    onChange={(e) => setCenterValue(e.target.value)}
                    className="w-36 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {t.margin}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={marginValue}
                    onChange={(e) => setMarginValue(e.target.value)}
                    className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                {marginPreview && (
                  <span className="pb-2 text-[11px] text-slate-400">
                    {t.marginHint(marginPreview.min, marginPreview.max)}
                  </span>
                )}
              </>
            )}
          </>
        )}

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeAnnulled}
            onChange={(e) => setIncludeAnnulled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {t.includeAnnulled}
        </label>

        <Button type="submit" variant="primary" loading={loading}>
          {loading ? t.generating : t.generate}
        </Button>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {hasSearched && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              {activeTenantId && <strong className="text-slate-500">{activeTenantId}</strong>}
              {activeTenantId && " — "}
              {reportPeriodLabel()}
            </p>

            {hasData && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleExportExcel} disabled={exporting}>
                  {exporting ? t.exporting : t.exportExcel}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportPdf} disabled={exporting}>
                  {exporting ? t.exporting : t.exportPdf}
                </Button>
              </div>
            )}
          </div>

          {!hasData && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {hasData && (
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.date}</th>
                      <th className="px-4 py-3">{t.document}</th>
                      <th className="px-4 py-3">{t.documentTypeCol}</th>
                      <th className="px-4 py-3">{t.account}</th>
                      <th className="px-4 py-3">{t.thirdParty}</th>
                      <th className="px-4 py-3">{t.costCenter}</th>
                      <th className="px-4 py-3">{t.detail}</th>
                      <th className="px-4 py-3 text-right">{t.amount}</th>
                      <th className="px-4 py-3 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {results.map((r, idx) => (
                      <tr key={idx} className={`hover:bg-slate-50/60 ${r.entry.annulled ? "bg-red-50/40" : ""}`}>
                        <td className="px-4 py-2.5 text-slate-600">{r.entry.entryDate}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          <div className="flex items-center gap-2">
                            <span>{r.entry.documentNumber}</span>
                            {r.entry.annulled && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase text-red-700">
                                {t.annulled}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{documentTypeLabel(r.entry)}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {r.item.accountCode} — {r.item.accountName}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{r.item.thirdPartyName || "—"}</td>
                        <td className="px-4 py-2.5 text-slate-500">{r.item.costCenterName || "—"}</td>
                        <td className="px-4 py-2.5 text-slate-500">{r.item.description || "—"}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {money(r.amount)}{" "}
                          <span className="text-[10px] font-normal text-slate-400">({r.side})</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={editingEntryId === r.entry.id}
                            onClick={() => handleEdit(r.entry.id)}
                          >
                            {t.edit}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={7}>
                        {t.totalRecords}: {results.length}
                      </td>
                      <td className="px-4 py-3 text-right">{money(totalAmount)}</td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ValueSearchPage;
