import { useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import { formatGeneratedAt } from "../../utils/reportExport";

// NEW (2026-10-20, user request): "Informe de Movimientos Incompletos" --
// an audit tool, not a period report. Some accounts get configured
// loosely at first (no Tercero/Centro de Costo required), movements get
// posted, and only later does the accountant tighten the account to
// require one of those -- the movements posted BEFORE that change stay
// "orphaned": valid at the time, invalid against the account's CURRENT
// configuration, and silently wrong for exógena/DIAN reporting and any
// management report that groups by tercero or centro de costo. This
// screen finds every such line, regardless of how old, and lets the
// user jump straight into the comprobante to fix it.
//
// Both dates are OPTIONAL and left blank by default -- unlike every
// other report here, this one defaults to the company's WHOLE history
// (narrowing by date is a convenience, not the normal use), since the
// point is to find every orphan, not just this month's.
//
// `onEditEntry(journalEntryId)` is how this page hands off to Asientos
// Contables: Dashboard.jsx wires it to switch the active view there and
// tell JournalEntryPage which entry to open directly in edit mode (see
// Dashboard.jsx's own comment on pendingEditEntryId).
function IncompleteMovementsPage({ language = "es", onEditEntry }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Tracks which row's "Editar" button is mid-navigation, purely so the
  // button can show a brief loading state -- onEditEntry's own fetch
  // (GET /v1/journal-entries/{id}) happens inside JournalEntryPage after
  // the view switch, not here, so this never actually clears itself
  // (the page navigates away); it exists only to avoid a double-click
  // firing the switch twice.
  const [editingEntryId, setEditingEntryId] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Informe de Movimientos Incompletos",
      subtitle: "Movimientos cuya cuenta hoy exige Tercero y/o Centro de Costo, pero el movimiento no lo tiene -- típicamente porque la cuenta se ajustó después de digitarlos",
      startDate: "Fecha Inicial (opcional)",
      endDate: "Fecha Final (opcional)",
      dateRangeHint: "Déjalas en blanco para revisar todo el historial.",
      generate: "Generar",
      generating: "Generando...",
      endBeforeStart: "La fecha final no puede ser anterior a la fecha inicial.",
      noResults: "No se encontraron movimientos incompletos para los filtros seleccionados.",
      noResultsAllTime: "No se encontraron movimientos incompletos en todo el historial. ¡Todo en orden!",
      date: "Fecha",
      document: "Comprobante",
      account: "Cuenta",
      inconsistency: "Inconsistencia",
      value: "Valor",
      actions: "Acción",
      edit: "Editar",
      missingThirdParty: "Falta Tercero",
      missingCostCenter: "Falta Centro de Costo",
      missingBoth: "Falta Tercero y Centro de Costo",
      totalRecords: "Registros",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
    },
    en: {
      title: "Incomplete Movements Report",
      subtitle: "Lines whose account now requires a Third Party and/or Cost Center it doesn't have -- typically because the account was tightened after the line was posted",
      startDate: "Start Date (optional)",
      endDate: "End Date (optional)",
      dateRangeHint: "Leave both blank to review the entire history.",
      generate: "Generate",
      generating: "Generating...",
      endBeforeStart: "End date can't be before start date.",
      noResults: "No incomplete movements found for the selected filters.",
      noResultsAllTime: "No incomplete movements found in the entire history. All clear!",
      date: "Date",
      document: "Voucher",
      account: "Account",
      inconsistency: "Inconsistency",
      value: "Value",
      actions: "Action",
      edit: "Edit",
      missingThirdParty: "Missing Third Party",
      missingCostCenter: "Missing Cost Center",
      missingBoth: "Missing Third Party and Cost Center",
      totalRecords: "Records",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
    },
  }[language];

  const formatAmount = (value) => {
    const num = Number(value);
    if (!value || Number.isNaN(num)) return "";
    return num.toLocaleString(language === "es" ? "es-CO" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const inconsistencyLabel = (line) => {
    if (line.missingThirdParty && line.missingCostCenter) return t.missingBoth;
    if (line.missingThirdParty) return t.missingThirdParty;
    if (line.missingCostCenter) return t.missingCostCenter;
    return "";
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (startDate && endDate && endDate < startDate) {
      setError(t.endBeforeStart);
      return;
    }

    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/incomplete-movements", { params });
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

  const handleEdit = (journalEntryId) => {
    setEditingEntryId(journalEntryId);
    onEditEntry?.(journalEntryId);
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

        <span className="text-[11px] text-slate-400">{t.dateRangeHint}</span>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-6">
          <p className="text-xs text-slate-400">
            {report.companyName && <strong className="text-slate-500">{report.companyName}</strong>}
            {report.companyName && report.generatedAt && " — "}
            {report.generatedAt && `${t.generatedAt}: ${formatGeneratedAt(report.generatedAt)}`}
          </p>

          {(!report.lines || report.lines.length === 0) && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {!startDate && !endDate ? t.noResultsAllTime : t.noResults}
            </div>
          )}

          {report.lines?.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.date}</th>
                      <th className="px-4 py-3">{t.document}</th>
                      <th className="px-4 py-3">{t.account}</th>
                      <th className="px-4 py-3">{t.inconsistency}</th>
                      <th className="px-4 py-3 text-right">{t.value}</th>
                      <th className="px-4 py-3 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.lines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-600">{line.entryDate}</td>
                        <td className="px-4 py-2.5 text-slate-600">{line.documentNumber}</td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {line.accountCode} — {line.accountName}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700 border border-amber-200">
                            {inconsistencyLabel(line)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatAmount(line.amount)}{" "}
                          <span className="text-[10px] font-normal text-slate-400">({line.side})</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={editingEntryId === line.journalEntryId}
                            onClick={() => handleEdit(line.journalEntryId)}
                          >
                            {t.edit}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={6}>
                        {t.totalRecords}: {report.totalRecords ?? 0}
                      </td>
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

export default IncompleteMovementsPage;
