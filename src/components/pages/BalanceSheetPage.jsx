import { useState } from "react";
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
  addPdfSignatureLines,
  buildExcelHeaderRows,
  formatGeneratedAt,
} from "../../utils/reportExport";

// NEW (2026-09-08): third report screen, after Libro Auxiliar and Balance
// de Comprobación. Backend already returns each section's name in both
// languages (sectionName / sectionNameEs -- see AccountCategory), unlike
// the Trial Balance's class summary, which needed a backend fix first.
// Classic two-column layout: Assets on the left, Liabilities + Equity
// stacked on the right, each with its own running total so the two sides
// can be eyeballed against each other the way a printed balance sheet
// reads.
function BalanceSheetPage({ language = "es" }) {
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Balance General",
      subtitle: "Estado de situación financiera a una fecha de corte",
      asOfDate: "Fecha de Corte",
      generate: "Generar",
      generating: "Generando...",
      dateRequired: "Selecciona una fecha de corte para generar el reporte.",
      noResults: "No hay cuentas con saldo a esta fecha.",
      assets: "Activos",
      liabilities: "Pasivos",
      equity: "Patrimonio",
      totalAssets: "Total Activos",
      totalLiabilities: "Total Pasivos",
      totalEquity: "Total Patrimonio",
      totalLiabilitiesAndEquity: "Total Pasivo + Patrimonio",
      subtotal: "Subtotal",
      account: "Cuenta",
      balance: "Saldo",
      balanced: "Balanceado: Activos = Pasivo + Patrimonio",
      outOfBalance: "¡Fuera de Balance! Revise los asientos contables.",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      pdfReportTitle: "Balance General",
      pdfAsOfDate: "Al",
      managerSignature: "GERENTE",
      accountantSignature: "CONTADOR",
    },
    en: {
      title: "Balance Sheet",
      subtitle: "Statement of financial position as of a cut-off date",
      asOfDate: "As Of Date",
      generate: "Generate",
      generating: "Generating...",
      dateRequired: "Select a cut-off date to generate the report.",
      noResults: "No accounts with a balance for this date.",
      assets: "Assets",
      liabilities: "Liabilities",
      equity: "Equity",
      totalAssets: "Total Assets",
      totalLiabilities: "Total Liabilities",
      totalEquity: "Total Equity",
      totalLiabilitiesAndEquity: "Total Liabilities + Equity",
      subtotal: "Subtotal",
      account: "Account",
      balance: "Balance",
      balanced: "Balanced: Assets = Liabilities + Equity",
      outOfBalance: "Out of balance! Review journal entries.",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      pdfReportTitle: "Balance Sheet",
      pdfAsOfDate: "As of",
      managerSignature: "MANAGER",
      accountantSignature: "ACCOUNTANT",
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

  const sectionLabel = (section) =>
    (language === "es" ? section.sectionNameEs || section.sectionName : section.sectionName || section.sectionNameEs) ||
    "";

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
      const response = await api.get("/v1/reports/balance-sheet", { params: { asOfDate } });
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

  const hasData = (report) =>
    (report?.assetSections?.length || 0) > 0 ||
    (report?.liabilitySections?.length || 0) > 0 ||
    (report?.equitySections?.length || 0) > 0;

  const reportPeriodLabel = () => `${t.pdfAsOfDate} ${report?.asOfDate || asOfDate}`;

  const exportFileStem = () => {
    const date = report?.asOfDate || asOfDate;
    return `${t.pdfReportTitle.replace(/\s+/g, "_")}_${date}`;
  };

  // Shared shape for both export formats: one group (Assets, Liabilities,
  // or Equity) as [description, amount] rows -- a group header, each
  // section's name and account lines indented under it with a subtotal,
  // then the group's own grand total. amountFn lets Excel get raw numbers
  // and PDF get localized display strings from the same builder.
  const buildGroupRows = (sections, groupLabel, groupTotalLabel, groupTotalValue, amountFn) => {
    const rows = [[groupLabel, ""]];
    (sections || []).forEach((section) => {
      const label = sectionLabel(section);
      rows.push([label, ""]);
      (section.accountLines || []).forEach((line) => {
        rows.push([`  ${line.accountCode} - ${line.accountName}`, amountFn(line.balance)]);
      });
      rows.push([`  ${t.subtotal}: ${label}`, amountFn(section.sectionTotal)]);
    });
    rows.push([groupTotalLabel, amountFn(groupTotalValue)]);
    return rows;
  };

  const handleExportExcel = () => {
    if (!report || !hasData(report)) return;

    const headerInfo = {
      companyName: report.companyName,
      reportTitle: t.pdfReportTitle,
      period: reportPeriodLabel(),
      generatedAtLabel: t.generatedAt,
      generatedAt: report.generatedAt,
    };

    const rows = [
      ...buildExcelHeaderRows(headerInfo),
      [t.account, t.balance],
      ...buildGroupRows(report.assetSections, t.assets.toUpperCase(), t.totalAssets, report.totalAssets, rawAmount),
      [],
      ...buildGroupRows(
        report.liabilitySections,
        t.liabilities.toUpperCase(),
        t.totalLiabilities,
        report.totalLiabilities,
        rawAmount
      ),
      [],
      ...buildGroupRows(report.equitySections, t.equity.toUpperCase(), t.totalEquity, report.totalEquity, rawAmount),
      [],
      [t.totalLiabilitiesAndEquity, rawAmount(report.totalLiabilitiesAndEquity)],
    ];

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, t.pdfReportTitle.slice(0, 31));
    XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!report || !hasData(report)) return;

    const doc = new jsPDF({ orientation: "landscape" });

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

    const body = [
      ...buildGroupRows(report.assetSections, t.assets.toUpperCase(), t.totalAssets, report.totalAssets, formatAmount),
      ["", ""],
      ...buildGroupRows(
        report.liabilitySections,
        t.liabilities.toUpperCase(),
        t.totalLiabilities,
        report.totalLiabilities,
        formatAmount
      ),
      ["", ""],
      ...buildGroupRows(report.equitySections, t.equity.toUpperCase(), t.totalEquity, report.totalEquity, formatAmount),
      ["", ""],
      [t.totalLiabilitiesAndEquity, formatAmount(report.totalLiabilitiesAndEquity)],
    ];

    const bottomMargin = 15;
    const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

    autoTable(doc, {
      startY: cursorY,
      head: [[t.account, t.balance]],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: { 1: { halign: "right" } },
      margin: { top: 20, bottom: bottomMargin },
      didDrawPage: (data) => {
        if (data.pageNumber > pageBeforeTable) {
          addPdfRunningHeader(doc, headerInfo);
        }
      },
    });

    addPdfSignatureLines(
      doc,
      { leftLabel: t.managerSignature, rightLabel: t.accountantSignature },
      doc.lastAutoTable.finalY,
      headerInfo
    );

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
            max={today}
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

            {hasData(report) && (
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

          {!hasData(report) && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {hasData(report) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* ASSETS -- left column */}
              <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">{t.assets}</h3>
                {(report.assetSections || []).map((section, idx) => (
                  <div
                    key={`asset-${idx}`}
                    className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
                  >
                    <div className="border-b border-gray-100 bg-slate-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-400">
                      {sectionLabel(section)}
                    </div>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-50">
                        {(section.accountLines || []).map((line) => (
                          <tr key={line.accountCode} className="hover:bg-slate-50/60">
                            <td className="px-4 py-2 text-slate-600">
                              <span className="font-semibold text-slate-700">{line.accountCode}</span>{" "}
                              {line.accountName}
                            </td>
                            <td className="px-4 py-2 text-right text-slate-700">{formatAmount(line.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                          <td className="px-4 py-2">{t.subtotal}</td>
                          <td className="px-4 py-2 text-right">{formatAmount(section.sectionTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))}

                <div className="flex items-center justify-between rounded-xl bg-slate-800 px-4 py-3 text-sm font-bold text-white">
                  <span>{t.totalAssets}</span>
                  <span>{formatAmount(report.totalAssets)}</span>
                </div>
              </div>

              {/* LIABILITIES + EQUITY -- right column */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">{t.liabilities}</h3>
                  {(report.liabilitySections || []).map((section, idx) => (
                    <div
                      key={`liability-${idx}`}
                      className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
                    >
                      <div className="border-b border-gray-100 bg-slate-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-400">
                        {sectionLabel(section)}
                      </div>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-50">
                          {(section.accountLines || []).map((line) => (
                            <tr key={line.accountCode} className="hover:bg-slate-50/60">
                              <td className="px-4 py-2 text-slate-600">
                                <span className="font-semibold text-slate-700">{line.accountCode}</span>{" "}
                                {line.accountName}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-700">{formatAmount(line.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                            <td className="px-4 py-2">{t.subtotal}</td>
                            <td className="px-4 py-2 text-right">{formatAmount(section.sectionTotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ))}

                  <div className="flex items-center justify-between rounded-xl bg-slate-600 px-4 py-3 text-sm font-bold text-white">
                    <span>{t.totalLiabilities}</span>
                    <span>{formatAmount(report.totalLiabilities)}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">{t.equity}</h3>
                  {(report.equitySections || []).map((section, idx) => (
                    <div
                      key={`equity-${idx}`}
                      className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
                    >
                      <div className="border-b border-gray-100 bg-slate-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-400">
                        {sectionLabel(section)}
                      </div>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-50">
                          {(section.accountLines || []).map((line) => (
                            <tr key={line.accountCode} className="hover:bg-slate-50/60">
                              <td className="px-4 py-2 text-slate-600">
                                <span className="font-semibold text-slate-700">{line.accountCode}</span>{" "}
                                {line.accountName}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-700">{formatAmount(line.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                            <td className="px-4 py-2">{t.subtotal}</td>
                            <td className="px-4 py-2 text-right">{formatAmount(section.sectionTotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ))}

                  <div className="flex items-center justify-between rounded-xl bg-slate-600 px-4 py-3 text-sm font-bold text-white">
                    <span>{t.totalEquity}</span>
                    <span>{formatAmount(report.totalEquity)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-slate-800 px-4 py-3 text-sm font-bold text-white">
                  <span>{t.totalLiabilitiesAndEquity}</span>
                  <span>{formatAmount(report.totalLiabilitiesAndEquity)}</span>
                </div>
              </div>
            </div>
          )}

          {hasData(report) && (
            <div className="grid grid-cols-2 gap-10 px-6 pt-10 pb-2">
              <div className="flex flex-col items-center gap-2">
                <div className="w-full border-t border-slate-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  {t.managerSignature}
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-full border-t border-slate-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  {t.accountantSignature}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BalanceSheetPage;
