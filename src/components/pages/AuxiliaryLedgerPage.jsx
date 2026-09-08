import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { addPdfReportHeader, addPdfRunningHeader, buildExcelHeaderRows, formatGeneratedAt } from "../../utils/reportExport";

// NEW (2026-09-08): first report screen wired into the frontend. The
// backend has had /v1/reports/auxiliary-ledger (and 3 other report
// endpoints) fully built for a while, but nothing in the Dashboard ever
// called them -- there was no way to see any report from the app itself,
// only by hitting the API directly. This is the user's own top pick
// ("libro auxiliar por cuenta en un rango de fechas") among the 4 existing
// report endpoints, built as the first of what should eventually be a
// full Reports section (Balance de Comprobación, Balance General, etc.
// still pending).
function AuxiliaryLedgerPage({ language = "es" }) {
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [filters, setFilters] = useState({
    startDate: firstOfMonth,
    endDate: today,
    accountId: "", // "" = todas las cuentas (usa el rango completo por defecto en el backend)
  });

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Libro Auxiliar",
      subtitle: "Historial de transacciones y saldo corriente por cuenta",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      account: "Cuenta",
      allAccounts: "— Todas las cuentas —",
      generate: "Generar",
      generating: "Generando...",
      loadingAccounts: "Cargando cuentas...",
      dateRequired: "Selecciona ambas fechas para generar el reporte.",
      endBeforeStart: "La fecha final no puede ser anterior a la fecha inicial.",
      noResults: "Sin movimientos para los filtros seleccionados.",
      openingBalance: "Saldo Anterior",
      date: "Fecha",
      document: "Documento",
      detail: "Detalle",
      thirdParty: "Tercero",
      costCenter: "C. Costo",
      debit: "Débito",
      credit: "Crédito",
      balance: "Saldo",
      totalDebits: "Total Débitos",
      totalCredits: "Total Créditos",
      closingBalance: "Saldo Final",
      totalRecords: "Movimientos",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      grandTotals: "Totales Generales",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      pdfReportTitle: "Libro Auxiliar",
      pdfPeriod: "Periodo",
      pdfAccount: "Cuenta",
    },
    en: {
      title: "Auxiliary Ledger",
      subtitle: "Transaction history and running balance per account",
      startDate: "Start Date",
      endDate: "End Date",
      account: "Account",
      allAccounts: "— All accounts —",
      generate: "Generate",
      generating: "Generating...",
      loadingAccounts: "Loading accounts...",
      dateRequired: "Select both dates to generate the report.",
      endBeforeStart: "End date can't be before start date.",
      noResults: "No movements for the selected filters.",
      openingBalance: "Opening Balance",
      date: "Date",
      document: "Document",
      detail: "Detail",
      thirdParty: "Third Party",
      costCenter: "Cost Center",
      debit: "Debit",
      credit: "Credit",
      balance: "Balance",
      totalDebits: "Total Debits",
      totalCredits: "Total Credits",
      closingBalance: "Closing Balance",
      totalRecords: "Movements",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      grandTotals: "Grand Totals",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      pdfReportTitle: "Auxiliary Ledger",
      pdfPeriod: "Period",
      pdfAccount: "Account",
    },
  }[language];

  const formatAmount = (value) => {
    const num = Number(value);
    if (!value || Number.isNaN(num) || num === 0) return "";
    return num.toLocaleString(language === "es" ? "es-CO" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const response = await api.get("/v1/chart-of-accounts", {
        params: { size: 500, sort: "code" },
      });
      if (response.data && response.data.success) {
        const payloadData = response.data.data;
        const list = Array.isArray(payloadData)
          ? payloadData
          : Array.isArray(payloadData?.content)
            ? payloadData.content
            : [];
        // Only posting (leaf) accounts actually receive movements — header
        // accounts never appear in journal entry items, so offering them
        // here would only ever return an empty ledger.
        setAccounts(list.filter((a) => a.postingAccount));
      }
    } catch (error) {
      // Non-fatal: the account picker just stays empty; "todas las
      // cuentas" (the default) still works without this list.
      console.error("Failed to load accounts for ledger filter", error);
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!filters.startDate || !filters.endDate) {
      setError(t.dateRequired);
      return;
    }
    if (filters.endDate < filters.startDate) {
      setError(t.endBeforeStart);
      return;
    }

    const selectedAccount = filters.accountId
      ? accounts.find((a) => String(a.id) === String(filters.accountId))
      : null;

    const params = {
      startDate: filters.startDate,
      endDate: filters.endDate,
    };
    // Drill into a single account by pinning both ends of the code range
    // to it (mirrors the backend's own documented example: "Single
    // account: startCode='110505', endCode='110505'"). Leaving both
    // unset lets the backend fall back to its full "1".."9999999999"
    // default range.
    if (selectedAccount) {
      params.startCode = selectedAccount.code;
      params.endCode = selectedAccount.code;
    }

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/auxiliary-ledger", { params });
      if (response.data && response.data.success) {
        setReport(response.data.data);
      } else {
        setError(response.data?.message || t.errorConn);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setLoading(false);
    }
  };

  const grandTotals = useMemo(() => {
    if (!report?.accountGroups?.length || report.accountGroups.length < 2) return null;
    return report.accountGroups.reduce(
      (acc, g) => ({
        totalDebits: acc.totalDebits + Number(g.totalDebits || 0),
        totalCredits: acc.totalCredits + Number(g.totalCredits || 0),
        totalRecords: acc.totalRecords + Number(g.totalRecords || 0),
      }),
      { totalDebits: 0, totalCredits: 0, totalRecords: 0 }
    );
  }, [report]);

  // Shared filename stem for both export formats, e.g.
  // "Libro_Auxiliar_2026-01-01_a_2026-01-31".
  const exportFileStem = () => {
    if (!report) return "Libro_Auxiliar";
    const range = `${report.startDate || filters.startDate}_a_${report.endDate || filters.endDate}`;
    return `${t.pdfReportTitle.replace(/\s+/g, "_")}_${range}`;
  };

  // Raw numeric amount for spreadsheet cells -- unlike formatAmount() (used
  // for on-screen display), Excel needs real numbers, not localized
  // strings with thousands separators, or the column can't be summed.
  const rawAmount = (value) => {
    const num = Number(value);
    return !value || Number.isNaN(num) ? 0 : num;
  };

  // Builds one worksheet's rows (as an array-of-arrays, the format
  // XLSX.utils.aoa_to_sheet expects) for a single account group: an
  // opening-balance line, the transaction table, then a totals line --
  // mirrors what's on screen so the exported file matches what the user
  // just reviewed.
  const reportPeriodLabel = () =>
    `${t.pdfPeriod}: ${report?.startDate || filters.startDate} – ${report?.endDate || filters.endDate}`;

  const buildSheetRows = (group, includeHeader) => {
    const columnHeader = [t.date, t.document, t.detail, t.thirdParty, t.costCenter, t.debit, t.credit, t.balance];
    const rows = [
      ...(includeHeader
        ? buildExcelHeaderRows({
            companyName: report.companyName,
            reportTitle: t.pdfReportTitle,
            period: reportPeriodLabel(),
            generatedAtLabel: t.generatedAt,
            generatedAt: report.generatedAt,
          })
        : []),
      [`${group.accountCode} — ${group.accountName}`],
      [t.openingBalance, "", "", "", "", "", "", rawAmount(group.openingBalance)],
      columnHeader,
      ...(group.transactions || []).map((tx) => [
        tx.transactionDate,
        tx.documentNumber,
        tx.detail,
        tx.thirdPartyName || "",
        tx.costCenterCode || "",
        rawAmount(tx.debit),
        rawAmount(tx.credit),
        rawAmount(tx.newBalance),
      ]),
      [
        `${t.totalRecords}: ${group.totalRecords ?? 0}`,
        "",
        "",
        "",
        "",
        rawAmount(group.totalDebits),
        rawAmount(group.totalCredits),
        rawAmount(group.closingBalance),
      ],
    ];
    return rows;
  };

  const handleExportExcel = () => {
    if (!report?.accountGroups?.length) return;

    const workbook = XLSX.utils.book_new();
    report.accountGroups.forEach((group, index) => {
      // Full company/report/generated-at header on every sheet, not just
      // the first -- each sheet can be opened, printed or forwarded on
      // its own, so it needs to identify itself without relying on
      // another tab in the same workbook.
      const sheet = XLSX.utils.aoa_to_sheet(buildSheetRows(group, true));
      // Sheet names are capped at 31 chars and can't contain \ / ? * [ ] :
      // -- account codes are always short plain digits, but sanitize
      // anyway so a future non-numeric code can't break the export.
      const sheetName = String(group.accountCode).replace(/[/?*[\]:]/g, "-").slice(0, 31);
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName || `Cuenta${index + 1}`);
    });

    XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!report?.accountGroups?.length) return;

    const doc = new jsPDF({ orientation: "landscape" });
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 15;
    // Minimum space (mm) a group needs on the current page before it's
    // worth starting here: title line + opening balance + table header +
    // a couple of rows. Below this, forcing a page break avoids orphaning
    // an account's title at the very bottom of the page.
    const minGroupSpace = 35;

    const headerInfo = {
      companyName: report.companyName,
      reportTitle: t.pdfReportTitle,
      period: reportPeriodLabel(),
      generatedAtLabel: t.generatedAt,
      generatedAt: report.generatedAt,
    };

    // The first page gets the full header (company + title + period +
    // generated-at). Every page after that -- a new account group, or a
    // continuation page autoTable adds on its own because one group's
    // transactions overflow a single page -- gets the compact running
    // header instead.
    let isFirstPage = true;
    const drawPageHeader = () => {
      if (isFirstPage) {
        isFirstPage = false;
        return addPdfReportHeader(doc, headerInfo);
      }
      return addPdfRunningHeader(doc, headerInfo);
    };

    let cursorY = drawPageHeader();

    report.accountGroups.forEach((group) => {
      // Only force a new page when there isn't enough room left for this
      // group's title, opening balance and a few rows -- accounts with
      // few movements now share a page instead of each one starting a
      // mostly-blank page of its own.
      if (cursorY + minGroupSpace > pageHeight - bottomMargin) {
        doc.addPage();
        cursorY = drawPageHeader();
      }

      doc.setFontSize(11);
      doc.text(`${t.pdfAccount}: ${group.accountCode} — ${group.accountName}`, 14, cursorY);
      doc.setFontSize(9);
      doc.text(
        `${t.openingBalance}: ${formatAmount(group.openingBalance) || "0.00"}`,
        14,
        cursorY + 6
      );

      const body = (group.transactions || []).map((tx) => [
        tx.transactionDate || "",
        tx.documentNumber || "",
        tx.detail || "",
        tx.thirdPartyName || "",
        tx.costCenterCode || "",
        formatAmount(tx.debit),
        formatAmount(tx.credit),
        formatAmount(tx.newBalance),
      ]);
      body.push([
        `${t.totalRecords}: ${group.totalRecords ?? 0}`,
        "",
        "",
        "",
        "",
        formatAmount(group.totalDebits),
        formatAmount(group.totalCredits),
        formatAmount(group.closingBalance),
      ]);

      // If this group's own table is long enough to overflow the page,
      // autoTable adds pages for it automatically -- give those
      // continuation pages a running header too instead of leaving them
      // blank on top.
      const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

      autoTable(doc, {
        startY: cursorY + 10,
        head: [[t.date, t.document, t.detail, t.thirdParty, t.costCenter, t.debit, t.credit, t.balance]],
        body,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: {
          5: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right" },
        },
        margin: { top: 20, bottom: bottomMargin },
        didDrawPage: (data) => {
          if (data.pageNumber > pageBeforeTable) {
            drawPageHeader();
          }
        },
      });

      cursorY = doc.lastAutoTable.finalY + 8;
    });

    doc.save(`${exportFileStem()}.pdf`);
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
            name="startDate"
            value={filters.startDate}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.endDate}
          </label>
          <input
            type="date"
            name="endDate"
            value={filters.endDate}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex min-w-[260px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.account}
          </label>
          <select
            name="accountId"
            value={filters.accountId}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="primary" loading={loading} disabled={loadingAccounts}>
          {loading ? t.generating : t.generate}
        </Button>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {report.generatedAt || report.companyName ? (
              <p className="text-xs text-slate-400">
                {report.companyName && <strong className="text-slate-500">{report.companyName}</strong>}
                {report.companyName && report.generatedAt && " — "}
                {report.generatedAt && `${t.generatedAt}: ${formatGeneratedAt(report.generatedAt)}`}
              </p>
            ) : (
              <span />
            )}

            {report.accountGroups?.length > 0 && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleExportExcel}>
                  {t.exportExcel}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportPdf}>
                  {t.exportPdf}
                </Button>
              </div>
            )}
          </div>

          {(!report.accountGroups || report.accountGroups.length === 0) && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {report.accountGroups?.map((group) => (
            <div
              key={group.accountCode}
              className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-slate-50 px-5 py-4">
                <div>
                  <span className="font-bold text-slate-700">{group.accountCode}</span>{" "}
                  <span className="text-slate-600">{group.accountName}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {t.openingBalance}:{" "}
                  <strong className="text-slate-700">
                    {formatAmount(group.openingBalance) || "0.00"}
                  </strong>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.date}</th>
                      <th className="px-4 py-3">{t.document}</th>
                      <th className="px-4 py-3">{t.detail}</th>
                      <th className="px-4 py-3">{t.thirdParty}</th>
                      <th className="px-4 py-3">{t.costCenter}</th>
                      <th className="px-4 py-3 text-right">{t.debit}</th>
                      <th className="px-4 py-3 text-right">{t.credit}</th>
                      <th className="px-4 py-3 text-right">{t.balance}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(group.transactions || []).map((tx, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-600">{tx.transactionDate}</td>
                        <td className="px-4 py-2.5 text-slate-600">{tx.documentNumber}</td>
                        <td className="px-4 py-2.5 text-slate-600">{tx.detail}</td>
                        <td className="px-4 py-2.5 text-slate-500">{tx.thirdPartyName || "—"}</td>
                        <td className="px-4 py-2.5 text-slate-500">{tx.costCenterCode || "—"}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {formatAmount(tx.debit)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {formatAmount(tx.credit)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatAmount(tx.newBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={5}>
                        {t.totalRecords}: {group.totalRecords ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right">{formatAmount(group.totalDebits)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(group.totalCredits)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(group.closingBalance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          {grandTotals && (
            <div className="flex flex-wrap items-center justify-end gap-6 rounded-xl border border-gray-100 bg-white px-5 py-4 text-sm shadow-sm">
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                {t.grandTotals}
              </span>
              <span className="text-slate-600">
                {t.totalRecords}: <strong>{grandTotals.totalRecords}</strong>
              </span>
              <span className="text-slate-600">
                {t.totalDebits}: <strong>{formatAmount(grandTotals.totalDebits)}</strong>
              </span>
              <span className="text-slate-600">
                {t.totalCredits}: <strong>{formatAmount(grandTotals.totalCredits)}</strong>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AuxiliaryLedgerPage;
