import { useMemo, useState } from "react";
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
  formatGeneratedAt,
  translateAccountClass,
  todayLocalIso,
} from "../../utils/reportExport";

// NEW (2026-09-08): fourth and last of the originally-planned report
// screens. Same shape as the plain Trial Balance, but for a date RANGE
// instead of a single cut-off: opening balance, period debit/credit,
// net movement and closing balance per account, plus the same
// per-class summary. Reuses translateAccountClass() -- the backend's
// getAccountClassDisplay() already returns bare codes for both Trial
// Balance reports, so no further backend change was needed here.
function TrialBalanceDetailedPage({ language = "es" }) {
  const today = todayLocalIso();
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Balance de Comprobación Detallado",
      subtitle: "Saldo de apertura, movimiento del periodo y cierre por cuenta",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      generate: "Generar",
      generating: "Generando...",
      dateRequired: "Selecciona ambas fechas para generar el reporte.",
      endBeforeStart: "La fecha final no puede ser anterior a la fecha inicial.",
      noResults: "No hay cuentas con movimiento en este periodo.",
      accountCode: "Código",
      accountName: "Cuenta",
      class: "Clase",
      openingBalance: "Apertura",
      periodDebit: "Débito Periodo",
      periodCredit: "Crédito Periodo",
      closingBalance: "Cierre",
      totalsRow: "Totales",
      balanced: "Balanceado: Débitos del Periodo = Créditos del Periodo",
      outOfBalance: "¡Fuera de Balance! Revise los asientos contables.",
      summaryByClass: "Resumen por Clase",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      pdfReportTitle: "Balance de Comprobación Detallado",
      pdfPeriod: "Periodo",
    },
    en: {
      title: "Detailed Trial Balance",
      subtitle: "Opening balance, period activity and closing balance per account",
      startDate: "Start Date",
      endDate: "End Date",
      generate: "Generate",
      generating: "Generating...",
      dateRequired: "Select both dates to generate the report.",
      endBeforeStart: "End date can't be before start date.",
      noResults: "No accounts with activity for this period.",
      accountCode: "Code",
      accountName: "Account",
      class: "Class",
      openingBalance: "Opening",
      periodDebit: "Period Debit",
      periodCredit: "Period Credit",
      closingBalance: "Closing",
      totalsRow: "Totals",
      balanced: "Balanced: Period Debits = Period Credits",
      outOfBalance: "Out of balance! Review journal entries.",
      summaryByClass: "Summary by Class",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      pdfReportTitle: "Detailed Trial Balance",
      pdfPeriod: "Period",
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

  // Raw numeric amount for spreadsheet cells -- Excel needs real numbers,
  // not localized display strings, or the column can't be summed.
  const rawAmount = (value) => {
    const num = Number(value);
    return !value || Number.isNaN(num) ? 0 : num;
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError(t.dateRequired);
      return;
    }
    if (endDate < startDate) {
      setError(t.endBeforeStart);
      return;
    }

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/trial-balance-detailed", {
        params: { startDate, endDate },
      });
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

  // Backend key is a bare class code ("1".."5", "6-7", "OTHER");
  // translateAccountClass() renders it, sorted so the summary always
  // reads in class-code order regardless of Map iteration order.
  const summaryEntries = useMemo(() => {
    if (!report?.summaryByClass) return [];
    return Object.entries(report.summaryByClass).sort(([a], [b]) => a.localeCompare(b));
  }, [report]);

  const reportPeriodLabel = () =>
    `${t.pdfPeriod}: ${report?.startDate || startDate} – ${report?.endDate || endDate}`;

  const exportFileStem = () => {
    const range = `${report?.startDate || startDate}_a_${report?.endDate || endDate}`;
    return `${t.pdfReportTitle.replace(/\s+/g, "_")}_${range}`;
  };

  const handleExportExcel = () => {
    if (!report?.lines?.length) return;

    const headerInfo = {
      companyName: report.companyName,
      reportTitle: t.pdfReportTitle,
      period: reportPeriodLabel(),
      generatedAtLabel: t.generatedAt,
      generatedAt: report.generatedAt,
    };

    const rows = [
      ...buildExcelHeaderRows(headerInfo),
      [
        t.accountCode,
        t.accountName,
        t.class,
        t.openingBalance,
        t.periodDebit,
        t.periodCredit,
        t.closingBalance,
      ],
      ...report.lines.map((line) => [
        line.accountCode,
        `${"  ".repeat(Math.max((line.level || 1) - 1, 0))}${line.accountName}`,
        translateAccountClass(line.accountClass, language),
        rawAmount(line.openingBalance),
        rawAmount(line.periodDebit),
        rawAmount(line.periodCredit),
        rawAmount(line.closingBalance),
      ]),
      [
        t.totalsRow,
        "",
        "",
        rawAmount(report.totalOpeningBalance),
        rawAmount(report.totalPeriodDebit),
        rawAmount(report.totalPeriodCredit),
        rawAmount(report.totalClosingBalance),
      ],
      [],
      [t.summaryByClass],
      ...summaryEntries.map(([classCode, balance]) => [
        translateAccountClass(classCode, language),
        "",
        "",
        "",
        "",
        "",
        rawAmount(balance),
      ]),
    ];

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, t.pdfReportTitle.slice(0, 31));
    XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!report?.lines?.length) return;

    const doc = new jsPDF({ orientation: "landscape" });
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 15;

    const headerInfo = {
      companyName: report.companyName,
      reportTitle: t.pdfReportTitle,
      period: reportPeriodLabel(),
      generatedAtLabel: t.generatedAt,
      generatedAt: report.generatedAt,
    };

    let cursorY = addPdfReportHeader(doc, headerInfo);

    doc.setFontSize(10);
    if (report.balanced) {
      doc.setTextColor(22, 130, 70);
    } else {
      doc.setTextColor(185, 28, 28);
    }
    doc.text(report.balanced ? t.balanced : t.outOfBalance, 14, cursorY);
    doc.setTextColor(0);
    cursorY += 6;

    // Header (non-posting) rows carry their descendants' rolled-up totals
    // as a group subtotal -- bold + shaded in the PDF via didParseCell
    // below, matched back to each body row by index
    // (isHeaderFlags[i] <-> body[i]).
    const isHeaderFlags = report.lines.map((line) => line.postingAccount === false);

    const body = report.lines.map((line) => [
      line.accountCode,
      `${"  ".repeat(Math.max((line.level || 1) - 1, 0))}${line.accountName}`,
      translateAccountClass(line.accountClass, language),
      formatAmount(line.openingBalance),
      formatAmount(line.periodDebit),
      formatAmount(line.periodCredit),
      formatAmount(line.closingBalance),
    ]);
    body.push([
      t.totalsRow,
      "",
      "",
      formatAmount(report.totalOpeningBalance),
      formatAmount(report.totalPeriodDebit),
      formatAmount(report.totalPeriodCredit),
      formatAmount(report.totalClosingBalance),
    ]);

    // If the account list itself overflows a page, autoTable adds pages
    // on its own -- give those continuation pages a running header too
    // instead of leaving them blank on top.
    const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

    autoTable(doc, {
      startY: cursorY,
      head: [
        [
          t.accountCode,
          t.accountName,
          t.class,
          t.openingBalance,
          t.periodDebit,
          t.periodCredit,
          t.closingBalance,
        ],
      ],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
      margin: { top: 20, bottom: bottomMargin },
      didParseCell: (data) => {
        if (data.section === "body" && isHeaderFlags[data.row.index]) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [241, 245, 249];
        }
      },
      didDrawPage: (data) => {
        if (data.pageNumber > pageBeforeTable) {
          addPdfRunningHeader(doc, headerInfo);
        }
      },
    });

    if (summaryEntries.length) {
      let y = doc.lastAutoTable.finalY + 10;
      // Same "does it fit" check as the main table: don't orphan the
      // summary title at the very bottom of the page.
      if (y + 30 > pageHeight - bottomMargin) {
        doc.addPage();
        y = addPdfRunningHeader(doc, headerInfo) + 6;
      }

      doc.setFontSize(11);
      doc.text(t.summaryByClass, 14, y);

      autoTable(doc, {
        startY: y + 4,
        head: [[t.class, t.closingBalance]],
        body: summaryEntries.map(([classCode, balance]) => [
          translateAccountClass(classCode, language),
          formatAmount(balance),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: { 1: { halign: "right" } },
        margin: { top: 20, bottom: bottomMargin },
      });
    }

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

        <Button type="submit" variant="primary" loading={loading}>
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

            {report.lines?.length > 0 && (
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

          <div
            className={`rounded-xl border px-4 py-3 text-sm font-medium ${
              report.balanced
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {report.balanced ? t.balanced : t.outOfBalance}
          </div>

          {(!report.lines || report.lines.length === 0) && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {report.lines?.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.accountCode}</th>
                      <th className="px-4 py-3">{t.accountName}</th>
                      <th className="px-4 py-3">{t.class}</th>
                      <th className="px-4 py-3 text-right">{t.openingBalance}</th>
                      <th className="px-4 py-3 text-right">{t.periodDebit}</th>
                      <th className="px-4 py-3 text-right">{t.periodCredit}</th>
                      <th className="px-4 py-3 text-right">{t.closingBalance}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.lines.map((line) => {
                      const isHeader = line.postingAccount === false;
                      return (
                        <tr
                          key={line.accountCode}
                          className={isHeader ? "bg-slate-50/80 hover:bg-slate-100" : "hover:bg-slate-50/60"}
                        >
                          <td
                            className={`px-4 py-2.5 ${
                              isHeader ? "font-bold text-slate-800" : "font-semibold text-slate-700"
                            }`}
                          >
                            <span style={{ paddingLeft: `${((line.level || 1) - 1) * 16}px` }}>
                              {line.accountCode}
                            </span>
                          </td>
                          <td className={`px-4 py-2.5 ${isHeader ? "font-bold text-slate-800" : "text-slate-600"}`}>
                            {line.accountName}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {translateAccountClass(line.accountClass, language)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right ${
                              isHeader ? "font-bold text-slate-800" : "text-slate-700"
                            }`}
                          >
                            {formatAmount(line.openingBalance)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right ${
                              isHeader ? "font-bold text-slate-800" : "text-slate-700"
                            }`}
                          >
                            {formatAmount(line.periodDebit)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right ${
                              isHeader ? "font-bold text-slate-800" : "text-slate-700"
                            }`}
                          >
                            {formatAmount(line.periodCredit)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-semibold ${
                              isHeader ? "text-slate-900" : "text-slate-800"
                            }`}
                          >
                            {formatAmount(line.closingBalance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={3}>
                        {t.totalsRow}
                      </td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalOpeningBalance)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalPeriodDebit)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalPeriodCredit)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalClosingBalance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {summaryEntries.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 bg-slate-50 px-5 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">
                {t.summaryByClass}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {summaryEntries.map(([classCode, balance]) => (
                      <tr key={classCode} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-600">
                          {translateAccountClass(classCode, language)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatAmount(balance)}
                        </td>
                      </tr>
                    ))}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TrialBalanceDetailedPage;
