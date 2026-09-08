import { useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { addPdfReportHeader, addPdfRunningHeader, buildExcelHeaderRows, formatGeneratedAt, translateAccountClass } from "../../utils/reportExport";

// NEW (2026-09-08): second report screen, after Libro Auxiliar. Simpler
// shape than the ledger -- one cut-off date, one flat list of every
// account's debit/credit totals and net balance, plus a quick summary
// grouped by account class (Assets, Liabilities, ...). Reuses the same
// reportExport.js header helpers so the exported PDF/Excel match every
// other report in this section (company name + generation date/time).
function TrialBalancePage({ language = "es" }) {
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Balance de Comprobación",
      subtitle: "Saldos de todas las cuentas a una fecha de corte",
      asOfDate: "Fecha de Corte",
      generate: "Generar",
      generating: "Generando...",
      dateRequired: "Selecciona una fecha de corte para generar el reporte.",
      noResults: "No hay cuentas con actividad para esta fecha.",
      accountCode: "Código",
      accountName: "Cuenta",
      totalDebit: "Total Débito",
      totalCredit: "Total Crédito",
      netBalance: "Saldo Neto",
      totalsRow: "Totales",
      balanced: "Balanceado: Débitos = Créditos",
      outOfBalance: "¡Fuera de Balance! Revise los asientos contables.",
      summaryByClass: "Resumen por Clase",
      class: "Clase",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      pdfReportTitle: "Balance de Comprobación",
      pdfAsOfDate: "Al",
    },
    en: {
      title: "Trial Balance",
      subtitle: "Balances for all accounts as of a cut-off date",
      asOfDate: "As Of Date",
      generate: "Generate",
      generating: "Generating...",
      dateRequired: "Select a cut-off date to generate the report.",
      noResults: "No accounts with activity for this date.",
      accountCode: "Code",
      accountName: "Account",
      totalDebit: "Total Debit",
      totalCredit: "Total Credit",
      netBalance: "Net Balance",
      totalsRow: "Totals",
      balanced: "Balanced: Debits = Credits",
      outOfBalance: "Out of balance! Review journal entries.",
      summaryByClass: "Summary by Class",
      class: "Class",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      pdfReportTitle: "Trial Balance",
      pdfAsOfDate: "As of",
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

    if (!asOfDate) {
      setError(t.dateRequired);
      return;
    }

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/trial-balance", { params: { asOfDate } });
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

  // Backend key is the account class display name (e.g. "1 - Assets");
  // sorted so the summary always reads in class-code order regardless of
  // Map iteration order.
  const summaryEntries = useMemo(() => {
    if (!report?.summary) return [];
    return Object.entries(report.summary).sort(([a], [b]) => a.localeCompare(b));
  }, [report]);

  const reportPeriodLabel = () => `${t.pdfAsOfDate} ${report?.asOfDate || asOfDate}`;

  const exportFileStem = () => {
    const date = report?.asOfDate || asOfDate;
    return `${t.pdfReportTitle.replace(/\s+/g, "_")}_${date}`;
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
      [t.accountCode, t.accountName, t.totalDebit, t.totalCredit, t.netBalance],
      ...report.lines.map((line) => [
        line.accountCode,
        line.accountName,
        rawAmount(line.totalDebit),
        rawAmount(line.totalCredit),
        rawAmount(line.netBalance),
      ]),
      [t.totalsRow, "", rawAmount(report.totalDebit), rawAmount(report.totalCredit), ""],
      [],
      [t.summaryByClass],
      ...summaryEntries.map(([classCode, balance]) => [translateAccountClass(classCode, language), "", "", "", rawAmount(balance)]),
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

    const body = report.lines.map((line) => [
      line.accountCode,
      line.accountName,
      formatAmount(line.totalDebit),
      formatAmount(line.totalCredit),
      formatAmount(line.netBalance),
    ]);
    body.push([t.totalsRow, "", formatAmount(report.totalDebit), formatAmount(report.totalCredit), ""]);

    // If the account list itself overflows a page, autoTable adds pages
    // on its own -- give those continuation pages a running header too
    // instead of leaving them blank on top.
    const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

    autoTable(doc, {
      startY: cursorY,
      head: [[t.accountCode, t.accountName, t.totalDebit, t.totalCredit, t.netBalance]],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
      },
      margin: { top: 20, bottom: bottomMargin },
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
        head: [[t.class, t.netBalance]],
        body: summaryEntries.map(([classCode, balance]) => [translateAccountClass(classCode, language), formatAmount(balance)]),
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
            {t.asOfDate}
          </label>
          <input
            type="date"
            name="asOfDate"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
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
                      <th className="px-4 py-3 text-right">{t.totalDebit}</th>
                      <th className="px-4 py-3 text-right">{t.totalCredit}</th>
                      <th className="px-4 py-3 text-right">{t.netBalance}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.lines.map((line) => (
                      <tr key={line.accountCode} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-semibold text-slate-700">{line.accountCode}</td>
                        <td className="px-4 py-2.5 text-slate-600">{line.accountName}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {formatAmount(line.totalDebit)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {formatAmount(line.totalCredit)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatAmount(line.netBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={2}>
                        {t.totalsRow}
                      </td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalDebit)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalCredit)}</td>
                      <td className="px-4 py-3" />
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
                        <td className="px-4 py-2.5 text-slate-600">{translateAccountClass(classCode, language)}</td>
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

export default TrialBalancePage;
