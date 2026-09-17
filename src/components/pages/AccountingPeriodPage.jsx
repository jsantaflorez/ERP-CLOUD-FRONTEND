import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api"; // Centralized Axios instance configured for multi-tenancy
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

const now = new Date();

function AccountingPeriodPage({ language = "es" }) {
  const [periods, setPeriods]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [toast, setToast]         = useState(null);

  // "Cerrar Mes" panel
  const [closeMonthOpen, setCloseMonthOpen]     = useState(false);
  const [closeMonthForm, setCloseMonthForm]     = useState(defaultMonthForm());
  const [closeMonthErrors, setCloseMonthErrors] = useState({});
  const [savingCloseMonth, setSavingCloseMonth] = useState(false);

  // "Cerrar Año Fiscal" panel
  const [closeYearOpen, setCloseYearOpen]     = useState(false);
  const [closeYearForm, setCloseYearForm]     = useState(defaultYearForm());
  const [closeYearErrors, setCloseYearErrors] = useState({});
  const [savingCloseYear, setSavingCloseYear] = useState(false);

  // "Reabrir" panel — shared between reopening a single month and
  // unsealing a full fiscal year, since both only ever need one field
  // (the mandatory audit note) beyond the target itself.
  const [reopenTarget, setReopenTarget] = useState(null); // { kind: "month" | "year", year, month, periodCode }
  const [reopenNotes, setReopenNotes]   = useState("");
  const [reopenError, setReopenError]   = useState("");
  const [savingReopen, setSavingReopen] = useState(false);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Períodos Contables",
      subtitle: "Cierre y apertura de meses y años fiscales por compañía",
      closeMonth: "Cerrar Mes",
      closeYear: "Cerrar Año Fiscal",
      reopenMonth: "Reabrir Mes",
      reopenYear: "Reabrir Año",
      period: "Período", status: "Estado", yearSeal: "Cierre Anual",
      closedBy: "Cerrado por", closedAt: "Cerrado el", closingNotes: "Notas de Cierre",
      reopenedBy: "Reabierto por", reopenedAt: "Reabierto el", reopeningNotes: "Notas de Reapertura",
      actions: "Acciones",
      open: "Abierto", closed: "Cerrado", yes: "Sí", no: "No",
      noResults: "No hay períodos cerrados todavía.",
      loading: "Cargando períodos...",
      hint: "Solo aparecen aquí los meses que ya fueron cerrados explícitamente. Un mes sin registro está abierto por defecto.",
      year: "Año", month: "Mes", notes: "Notas",
      notesPlaceholder: "Motivo del cierre (obligatorio para el registro de auditoría)",
      reopenNotesPlaceholder: "Motivo de la reapertura (obligatorio)",
      required: "Campo obligatorio",
      yearInvalid: "Año inválido",
      save: "Cerrar", cancel: "Cancelar", confirm: "Confirmar",
      closeMonthTitle: "Cerrar un Mes",
      closeYearTitle: "Cerrar Año Fiscal",
      closeYearHint: "Requiere que los meses de enero a noviembre de ese año ya estén cerrados individualmente.",
      reopenMonthTitle: "Reabrir Período",
      reopenYearTitle: "Reabrir Año Fiscal",
      reopenYearHint: "Quita el sello anual. Los meses cerrados individualmente permanecen cerrados.",
      confirmCloseMonth: "¿Cerrar este período? No se podrán contabilizar asientos en esa fecha hasta que se reabra.",
      confirmCloseYear: "¿Cerrar el año fiscal completo? No se podrá contabilizar en ningún mes de ese año hasta que se reabra.",
      confirmReopenMonth: "¿Reabrir este período?",
      confirmReopenYear: "¿Reabrir el año fiscal completo?",
      successCloseMonth: "Período cerrado.",
      successCloseYear: "Año fiscal cerrado.",
      successReopenMonth: "Período reabierto.",
      successReopenYear: "Año fiscal reabierto.",
      errorConn: "Error de conexión con el servidor.",
      monthNames: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
    },
    en: {
      title: "Accounting Periods",
      subtitle: "Close and reopen fiscal months and years per company",
      closeMonth: "Close Month",
      closeYear: "Close Fiscal Year",
      reopenMonth: "Reopen Month",
      reopenYear: "Reopen Year",
      period: "Period", status: "Status", yearSeal: "Year Seal",
      closedBy: "Closed By", closedAt: "Closed At", closingNotes: "Closing Notes",
      reopenedBy: "Reopened By", reopenedAt: "Reopened At", reopeningNotes: "Reopening Notes",
      actions: "Actions",
      open: "Open", closed: "Closed", yes: "Yes", no: "No",
      noResults: "No periods have been closed yet.",
      loading: "Loading periods...",
      hint: "Only months that were explicitly closed show up here. A month with no record is open by default.",
      year: "Year", month: "Month", notes: "Notes",
      notesPlaceholder: "Reason for closing (required for the audit trail)",
      reopenNotesPlaceholder: "Reason for reopening (required)",
      required: "Required field",
      yearInvalid: "Invalid year",
      save: "Close", cancel: "Cancel", confirm: "Confirm",
      closeMonthTitle: "Close a Month",
      closeYearTitle: "Close Fiscal Year",
      closeYearHint: "Requires January through November of that year to already be individually closed.",
      reopenMonthTitle: "Reopen Period",
      reopenYearTitle: "Reopen Fiscal Year",
      reopenYearHint: "Removes the annual seal. Individually closed months remain closed.",
      confirmCloseMonth: "Close this period? No entries can be posted to that date until it's reopened.",
      confirmCloseYear: "Close the entire fiscal year? No month in that year can receive postings until it's reopened.",
      confirmReopenMonth: "Reopen this period?",
      confirmReopenYear: "Reopen the entire fiscal year?",
      successCloseMonth: "Period closed.",
      successCloseYear: "Fiscal year closed.",
      successReopenMonth: "Period reopened.",
      successReopenYear: "Fiscal year reopened.",
      errorConn: "Server connection error.",
      monthNames: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadPeriods = async () => {
    setLoading(true);
    try {
      const response = await api.get("/v1/accounting-periods");
      if (response.data && response.data.success) {
        setPeriods([...response.data.data]);
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDateTime = (value) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString(language === "es" ? "es-CO" : "en-US");
    } catch {
      return value;
    }
  };

  // ── Cerrar Mes ──────────────────────────────────────────────────────
  const openCloseMonthPanel = () => {
    setCloseMonthForm(defaultMonthForm());
    setCloseMonthErrors({});
    setCloseMonthOpen(true);
  };
  const closeCloseMonthPanel = () => setCloseMonthOpen(false);

  const handleCloseMonthChange = (e) => {
    const { name, value } = e.target;
    setCloseMonthForm((prev) => ({ ...prev, [name]: value }));
  };

  const validateCloseMonthForm = () => {
    const errs = {};
    const year = Number(closeMonthForm.year);
    if (!closeMonthForm.year || isNaN(year) || year < 1900 || year > 2100) errs.year = t.yearInvalid;
    if (!closeMonthForm.month) errs.month = t.required;
    if (!closeMonthForm.notes?.trim()) errs.notes = t.required;
    setCloseMonthErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitCloseMonth = async (e) => {
    e.preventDefault();
    if (!validateCloseMonthForm()) return;
    if (!window.confirm(t.confirmCloseMonth)) return;

    setSavingCloseMonth(true);
    try {
      const response = await api.post(
        `/v1/accounting-periods/${closeMonthForm.year}/${closeMonthForm.month}/close`,
        { notes: closeMonthForm.notes.trim() }
      );
      if (response.data && response.data.success) {
        showToast(t.successCloseMonth);
        closeCloseMonthPanel();
        loadPeriods();
      } else {
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setSavingCloseMonth(false);
    }
  };

  // ── Cerrar Año Fiscal ───────────────────────────────────────────────
  const openCloseYearPanel = () => {
    setCloseYearForm(defaultYearForm());
    setCloseYearErrors({});
    setCloseYearOpen(true);
  };
  const closeCloseYearPanel = () => setCloseYearOpen(false);

  const handleCloseYearChange = (e) => {
    const { name, value } = e.target;
    setCloseYearForm((prev) => ({ ...prev, [name]: value }));
  };

  const validateCloseYearForm = () => {
    const errs = {};
    const year = Number(closeYearForm.year);
    if (!closeYearForm.year || isNaN(year) || year < 1900 || year > 2100) errs.year = t.yearInvalid;
    if (!closeYearForm.notes?.trim()) errs.notes = t.required;
    setCloseYearErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitCloseYear = async (e) => {
    e.preventDefault();
    if (!validateCloseYearForm()) return;
    if (!window.confirm(t.confirmCloseYear)) return;

    setSavingCloseYear(true);
    try {
      const response = await api.post(
        `/v1/accounting-periods/${closeYearForm.year}/close-year`,
        { notes: closeYearForm.notes.trim() }
      );
      if (response.data && response.data.success) {
        showToast(t.successCloseYear);
        closeCloseYearPanel();
        loadPeriods();
      } else {
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setSavingCloseYear(false);
    }
  };

  // ── Reabrir (mes o año) ─────────────────────────────────────────────
  const openReopenMonth = (period) => {
    setReopenTarget({ kind: "month", year: period.year, month: period.month, periodCode: period.periodCode });
    setReopenNotes("");
    setReopenError("");
  };
  const openReopenYear = (period) => {
    setReopenTarget({ kind: "year", year: period.year, month: period.month, periodCode: period.periodCode });
    setReopenNotes("");
    setReopenError("");
  };
  const closeReopenPanel = () => setReopenTarget(null);

  const submitReopen = async (e) => {
    e.preventDefault();
    if (!reopenTarget) return;
    if (!reopenNotes.trim()) {
      setReopenError(t.required);
      return;
    }
    const confirmMsg = reopenTarget.kind === "year" ? t.confirmReopenYear : t.confirmReopenMonth;
    if (!window.confirm(confirmMsg)) return;

    setSavingReopen(true);
    try {
      let response;
      if (reopenTarget.kind === "month") {
        response = await api.post(
          `/v1/accounting-periods/${reopenTarget.year}/${reopenTarget.month}/reopen`,
          { year: reopenTarget.year, month: reopenTarget.month, notes: reopenNotes.trim() }
        );
      } else {
        response = await api.post(
          `/v1/accounting-periods/${reopenTarget.year}/reopen-year`,
          { notes: reopenNotes.trim() }
        );
      }

      if (response.data && response.data.success) {
        showToast(reopenTarget.kind === "year" ? t.successReopenYear : t.successReopenMonth);
        closeReopenPanel();
        loadPeriods();
      } else {
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setSavingReopen(false);
    }
  };

  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => (b.year - a.year) || (b.month - a.month)),
    [periods]
  );

  return (
    <div className="space-y-6 p-4">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl transition-all ${
          toast.type === "error" ? "bg-red-500" : "bg-emerald-500"
        }`}>
          {toast.msg}
        </div>
      )}

      <AppHeader
        title={t.title}
        subtitle={t.subtitle}
        tenantId={activeTenantId}
        actions={
          <>
            <Button variant="secondary" onClick={openCloseYearPanel}>
              {t.closeYear}
            </Button>
            <Button variant="primary" onClick={openCloseMonthPanel}>
              + {t.closeMonth}
            </Button>
          </>
        }
      />

      <p className="text-xs text-slate-400">{t.hint}</p>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            {t.loading}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {[t.period, t.status, t.yearSeal, t.closedBy, t.closedAt, t.closingNotes, t.reopenedBy, t.reopenedAt, t.reopeningNotes, t.actions].map((h) => (
                  <th key={h} className="px-5 py-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedPeriods.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400">{t.noResults}</td>
                </tr>
              ) : (
                sortedPeriods.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-4 font-mono font-bold text-slate-700 whitespace-nowrap">
                      {p.periodCode || `${p.year}-${String(p.month).padStart(2, "0")}`}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge isOpen={p.isOpen ?? p.open} labelOpen={t.open} labelClosed={t.closed} />
                    </td>
                    <td className="px-5 py-4">
                      {/* FIX: Jackson serializes a boolean getter isYearClose()
                          as JSON key "yearClose" (strips the "is" prefix),
                          same quirk already worked around in DocumentTypePage
                          for isAccounting/accounting -- read both so this
                          doesn't silently show "No" regardless of the real
                          value. */}
                      <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${(p.isYearClose ?? p.yearClose) ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500"}`}>
                        {(p.isYearClose ?? p.yearClose) ? t.yes : t.no}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600 whitespace-nowrap">{p.closedBy || "—"}</td>
                    <td className="px-5 py-4 text-slate-400 whitespace-nowrap">{formatDateTime(p.closedAt)}</td>
                    <td className="px-5 py-4 text-xs text-slate-400 max-w-[160px] truncate" title={p.closingNotes || ""}>
                      {p.closingNotes?.trim() ? p.closingNotes : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4 text-slate-600 whitespace-nowrap">{p.reopenedBy || "—"}</td>
                    <td className="px-5 py-4 text-slate-400 whitespace-nowrap">{formatDateTime(p.reopenedAt)}</td>
                    <td className="px-5 py-4 text-xs text-slate-400 max-w-[160px] truncate" title={p.reopeningNotes || ""}>
                      {p.reopeningNotes?.trim() ? p.reopeningNotes : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2 flex-wrap">
                        {(p.isYearClose ?? p.yearClose) ? (
                          <Button variant="ghost" size="sm" onClick={() => openReopenYear(p)}>
                            {t.reopenYear}
                          </Button>
                        ) : !(p.isOpen ?? p.open) ? (
                          <Button variant="ghost" size="sm" onClick={() => openReopenMonth(p)}>
                            {t.reopenMonth}
                          </Button>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Cerrar Mes ── */}
      {closeMonthOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeCloseMonthPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800">{t.closeMonthTitle}</h2>
              <button onClick={closeCloseMonthPanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={submitCloseMonth} className="px-6 py-5 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label={t.year} error={closeMonthErrors.year}>
                  <input type="number" name="year" value={closeMonthForm.year} onChange={handleCloseMonthChange}
                    min="1900" max="2100" className={inputCls(closeMonthErrors.year)} />
                </Field>
                <Field label={t.month} error={closeMonthErrors.month}>
                  <select name="month" value={closeMonthForm.month} onChange={handleCloseMonthChange}
                    className={inputCls(closeMonthErrors.month)}>
                    {t.monthNames.map((name, idx) => (
                      <option key={idx} value={idx + 1}>{name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label={t.notes} error={closeMonthErrors.notes}>
                <textarea name="notes" value={closeMonthForm.notes} onChange={handleCloseMonthChange}
                  maxLength={500} rows={3} placeholder={t.notesPlaceholder}
                  className={inputCls(closeMonthErrors.notes)} />
              </Field>

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" size="lg" fullWidth loading={savingCloseMonth}>
                  {t.save}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closeCloseMonthPanel} disabled={savingCloseMonth}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Cerrar Año Fiscal ── */}
      {closeYearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeCloseYearPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800">{t.closeYearTitle}</h2>
              <button onClick={closeCloseYearPanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={submitCloseYear} className="px-6 py-5 flex flex-col gap-4">
              <p className="text-xs text-amber-600">{t.closeYearHint}</p>

              <Field label={t.year} error={closeYearErrors.year}>
                <input type="number" name="year" value={closeYearForm.year} onChange={handleCloseYearChange}
                  min="1900" max="2100" className={inputCls(closeYearErrors.year)} />
              </Field>

              <Field label={t.notes} error={closeYearErrors.notes}>
                <textarea name="notes" value={closeYearForm.notes} onChange={handleCloseYearChange}
                  maxLength={500} rows={3} placeholder={t.notesPlaceholder}
                  className={inputCls(closeYearErrors.notes)} />
              </Field>

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" size="lg" fullWidth loading={savingCloseYear}>
                  {t.save}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closeCloseYearPanel} disabled={savingCloseYear}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Reabrir (mes o año) ── */}
      {reopenTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeReopenPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800">
                {reopenTarget.kind === "year" ? t.reopenYearTitle : t.reopenMonthTitle}
              </h2>
              <button onClick={closeReopenPanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={submitReopen} className="px-6 py-5 flex flex-col gap-4">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  {t.period}
                </div>
                <div className="text-sm font-mono font-bold text-slate-800">
                  {reopenTarget.periodCode || `${reopenTarget.year}-${String(reopenTarget.month).padStart(2, "0")}`}
                </div>
              </div>

              {reopenTarget.kind === "year" && (
                <p className="text-xs text-amber-600">{t.reopenYearHint}</p>
              )}

              <Field label={t.notes} error={reopenError}>
                <textarea value={reopenNotes}
                  onChange={(e) => { setReopenNotes(e.target.value); setReopenError(""); }}
                  maxLength={500} rows={3} placeholder={t.reopenNotesPlaceholder}
                  className={inputCls(reopenError)} autoFocus />
              </Field>

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" size="lg" fullWidth loading={savingReopen}>
                  {t.confirm}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closeReopenPanel} disabled={savingReopen}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Local helpers ────────────────────────────────────────────────────
function defaultMonthForm() {
  return { year: String(now.getFullYear()), month: String(now.getMonth() + 1), notes: "" };
}
function defaultYearForm() {
  return { year: String(now.getFullYear()), notes: "" };
}

const inputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-3 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent`;

function Field({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

function StatusBadge({ isOpen, labelOpen, labelClosed }) {
  return (
    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
      isOpen ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
    }`}>
      {isOpen ? labelOpen : labelClosed}
    </span>
  );
}

export default AccountingPeriodPage;
