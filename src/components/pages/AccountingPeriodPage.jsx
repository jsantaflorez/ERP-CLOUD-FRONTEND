import { Fragment, useEffect, useMemo, useState } from "react";
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

  // Ganancia/Pérdida account picklist + company-level suggestion for the
  // year-end closing screen, loaded once on mount (GET
  // /v1/accounting-periods/closing-options) and reused by both the
  // "Cerrar Año Fiscal" panel (pre-fills from suggestedGain/LossAccountId)
  // and the "Cuentas de Cierre por Defecto" panel (same equityAccounts
  // picklist, different purpose: editing the company-level suggestion
  // itself, not closing a specific year).
  const [closingOptions, setClosingOptions] = useState({
    equityAccounts: [],
    suggestedGainAccountId: null,
    suggestedLossAccountId: null,
  });

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

  // "Cerrar Mes" from a specific row -- NEW (2026-10-12, user request):
  // same shape as reopenTarget above, but for closing one exact
  // year/month directly from its row action button, instead of going
  // through the top "+ Cerrar Mes" panel's year/month dropdowns (which
  // stays too, for closing a month that isn't on screen right now).
  const [closeRowTarget, setCloseRowTarget] = useState(null); // { year, month, periodCode }
  const [closeRowNotes, setCloseRowNotes]   = useState("");
  const [closeRowError, setCloseRowError]   = useState("");
  const [savingCloseRow, setSavingCloseRow] = useState(false);

  // Collapsible year groups -- NEW (2026-10-12, user request): the
  // periods table keeps growing as more fiscal years accumulate, so each
  // year group can be collapsed to just its header row. Starts fully
  // expanded (same convention as the Plan de Cuentas account tree) and
  // resets on every reload -- not persisted, this is plain UI state.
  const [collapsedYears, setCollapsedYears] = useState(() => new Set());
  const toggleYearCollapsed = (year) => {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  // "Cuentas de Cierre por Defecto" panel (company-level suggestion,
  // PATCH /v1/companies/me/closing-defaults) -- NEW (2026-10-05).
  const [closingDefaultsOpen, setClosingDefaultsOpen]     = useState(false);
  const [closingDefaultsForm, setClosingDefaultsForm]     = useState({ defaultGainAccountId: "", defaultLossAccountId: "" });
  const [closingDefaultsErrors, setClosingDefaultsErrors] = useState({});
  const [loadingClosingDefaults, setLoadingClosingDefaults] = useState(false);
  const [savingClosingDefaults, setSavingClosingDefaults]   = useState(false);

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
      closingDefaultsBtn: "Cuentas de Cierre",
      period: "Período", status: "Estado", yearSeal: "Cierre Anual",
      closedBy: "Cerrado por", closedAt: "Cerrado el", closingNotes: "Notas de Cierre",
      reopenedBy: "Reabierto por", reopenedAt: "Reabierto el", reopeningNotes: "Notas de Reapertura",
      closingVoucher: "Comprobante de Cierre",
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
      closeYearHint: "Solo exige cerrar individualmente los meses de enero a noviembre que tengan movimientos contables -- un mes sin asientos se salta solo. Diciembre NO necesita cerrarse antes: el cierre de año lo cierra automáticamente, así que conviene dejarlo abierto hasta terminar los ajustes de fin de año (inventario, provisiones, etc.).",
      reopenMonthTitle: "Reabrir Período",
      reopenYearTitle: "Reabrir Año Fiscal",
      reopenYearHint: "Quita el sello anual. Los meses cerrados individualmente permanecen cerrados.",
      confirmCloseMonth: "¿Cerrar este período? No se podrán contabilizar asientos en esa fecha hasta que se reabra.",
      confirmCloseYear: "¿Cerrar el año fiscal completo? El sistema generará automáticamente el comprobante de cierre. No se podrá contabilizar en ningún mes de ese año hasta que se reabra.",
      confirmReopenMonth: "¿Reabrir este período?",
      confirmReopenYear: "¿Reabrir el año fiscal completo? Esto anula el comprobante de cierre generado (no lo borra).",
      successCloseMonth: "Período cerrado.",
      successCloseYear: "Año fiscal cerrado.",
      successCloseYearWithVoucher: (doc) => `Año fiscal cerrado. Comprobante de cierre: ${doc}.`,
      // 2026-10-12: names the exact month(s) still needing an individual close, using monthNames below -- replaces the old fixed "enero a noviembre" text, which read as if all eleven months needed closing.
      monthsNotClosedDetail: (monthLabels) =>
        `No se puede cerrar el año fiscal: primero debes cerrar individualmente ${monthLabels.length > 1 ? "estos meses, que tienen movimientos" : "este mes, que tiene movimientos"}: ${monthLabels.join(", ")}.`,
      successReopenMonth: "Período reabierto.",
      successReopenYear: "Año fiscal reabierto.",
      errorConn: "Error de conexión con el servidor.",
      monthNames: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
      // Ganancia/Pérdida dropdowns (year-end closing) -- NEW (2026-10-05)
      gainAccount: "Cuenta de Ganancia",
      lossAccount: "Cuenta de Pérdida",
      selectAccount: "Selecciona una cuenta...",
      gainLossMustDiffer: "La cuenta de Ganancia y la de Pérdida deben ser diferentes.",
      noEquityAccounts: "No hay cuentas auxiliares de Patrimonio (clase 3) configuradas todavía. Crea al menos dos en Plan de Cuentas antes de cerrar el año.",
      closingDefaultsTitle: "Cuentas de Cierre por Defecto",
      closingDefaultsHint: "Sugerencia de cuenta de Ganancia/Pérdida que se precarga al cerrar cualquier año. Se puede confirmar o cambiar para cada año específico al momento de cerrarlo — esto solo guarda la sugerencia de la compañía.",
      noSuggestion: "Sin sugerencia",
      successClosingDefaults: "Cuentas de cierre por defecto actualizadas.",
      loadingClosingDefaults: "Cargando...",
    },
    en: {
      title: "Accounting Periods",
      subtitle: "Close and reopen fiscal months and years per company",
      closeMonth: "Close Month",
      closeYear: "Close Fiscal Year",
      reopenMonth: "Reopen Month",
      reopenYear: "Reopen Year",
      closingDefaultsBtn: "Closing Accounts",
      period: "Period", status: "Status", yearSeal: "Year Seal",
      closedBy: "Closed By", closedAt: "Closed At", closingNotes: "Closing Notes",
      reopenedBy: "Reopened By", reopenedAt: "Reopened At", reopeningNotes: "Reopening Notes",
      closingVoucher: "Closing Voucher",
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
      closeYearHint: "Only months from January to November that actually have journal entries need to be closed individually -- a month with no activity is skipped automatically. December does NOT need to be closed beforehand: closing the year closes it automatically, so it's best left open until every year-end adjustment (inventory, accruals, etc.) is posted.",
      reopenMonthTitle: "Reopen Period",
      reopenYearTitle: "Reopen Fiscal Year",
      reopenYearHint: "Removes the annual seal. Individually closed months remain closed.",
      confirmCloseMonth: "Close this period? No entries can be posted to that date until it's reopened.",
      confirmCloseYear: "Close the entire fiscal year? The system will automatically generate the closing voucher. No month in that year can receive postings until it's reopened.",
      confirmReopenMonth: "Reopen this period?",
      confirmReopenYear: "Reopen the entire fiscal year? This annuls the generated closing voucher (never deletes it).",
      successCloseMonth: "Period closed.",
      successCloseYear: "Fiscal year closed.",
      successCloseYearWithVoucher: (doc) => `Fiscal year closed. Closing voucher: ${doc}.`,
      monthsNotClosedDetail: (monthLabels) =>
        `Can't close the fiscal year: ${monthLabels.length > 1 ? "these months, which have activity" : "this month, which has activity"} must be closed individually first: ${monthLabels.join(", ")}.`,
      successReopenMonth: "Period reopened.",
      successReopenYear: "Fiscal year reopened.",
      errorConn: "Server connection error.",
      monthNames: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      gainAccount: "Gain Account",
      lossAccount: "Loss Account",
      selectAccount: "Select an account...",
      gainLossMustDiffer: "The Gain and Loss accounts must be different.",
      noEquityAccounts: "No posting Equity accounts (class 3) are configured yet. Create at least two in Chart of Accounts before closing the year.",
      closingDefaultsTitle: "Default Closing Accounts",
      closingDefaultsHint: "Suggested Gain/Loss account pre-filled whenever any year is closed. It can still be confirmed or changed for each specific year at closing time -- this only saves the company's suggestion.",
      noSuggestion: "No suggestion",
      successClosingDefaults: "Default closing accounts updated.",
      loadingClosingDefaults: "Loading...",
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

  // NEW (2026-10-05): Ganancia/Pérdida picklist + company suggestion for
  // the year-end closing screen. Loaded once on mount, independent of
  // whether the user ever opens the closing panel -- cheap, and it needs
  // to be ready the instant "Cerrar Año Fiscal" opens so the two dropdowns
  // aren't empty while a second request is still in flight.
  const loadClosingOptions = async () => {
    try {
      const response = await api.get("/v1/accounting-periods/closing-options");
      if (response.data && response.data.success) {
        setClosingOptions(response.data.data);
      }
    } catch {
      // Silent: the closing screen still works with empty dropdowns (the
      // user just has to pick manually), and the error would otherwise
      // fire on every page load for companies with no chart of accounts
      // configured yet.
    }
  };

  useEffect(() => {
    loadPeriods();
    loadClosingOptions();
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
  // Closed months are shown disabled in the dropdown (NEW 2026-10-10) --
  // the user noticed they could pick an already-closed month and
  // resubmit, silently overwriting its original closedAt/closedBy/
  // closingNotes (now also blocked server-side with PERIOD_ALREADY_CLOSED,
  // but this avoids the user ever landing on a disallowed option at all).
  const closedMonthsForYear = (year) => {
    const y = Number(year);
    const set = new Set();
    periods.forEach((p) => {
      if (Number(p.year) === y && !(p.isOpen ?? p.open)) set.add(Number(p.month));
    });
    return set;
  };
  const firstOpenMonth = (closedSet, preferred) => {
    if (!closedSet.has(Number(preferred))) return String(preferred);
    for (let m = 1; m <= 12; m++) {
      if (!closedSet.has(m)) return String(m);
    }
    return String(preferred); // all 12 closed -- nothing better to offer
  };

  const openCloseMonthPanel = () => {
    const base = defaultMonthForm();
    base.month = firstOpenMonth(closedMonthsForYear(base.year), base.month);
    setCloseMonthForm(base);
    setCloseMonthErrors({});
    setCloseMonthOpen(true);
  };
  const closeCloseMonthPanel = () => setCloseMonthOpen(false);

  const handleCloseMonthChange = (e) => {
    const { name, value } = e.target;
    setCloseMonthForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "year") {
        next.month = firstOpenMonth(closedMonthsForYear(value), next.month);
      }
      return next;
    });
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
    // Pre-fill from the company's suggested accounts (if configured) --
    // the user still confirms or changes them before submitting, nothing
    // here is force-selected or hidden from them.
    setCloseYearForm({
      ...defaultYearForm(),
      gainAccountId: closingOptions.suggestedGainAccountId ? String(closingOptions.suggestedGainAccountId) : "",
      lossAccountId: closingOptions.suggestedLossAccountId ? String(closingOptions.suggestedLossAccountId) : "",
    });
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
    if (!closeYearForm.gainAccountId) errs.gainAccountId = t.required;
    if (!closeYearForm.lossAccountId) errs.lossAccountId = t.required;
    if (
      closeYearForm.gainAccountId &&
      closeYearForm.lossAccountId &&
      closeYearForm.gainAccountId === closeYearForm.lossAccountId
    ) {
      errs.lossAccountId = t.gainLossMustDiffer;
    }
    setCloseYearErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // 2026-10-12: MONTHS_NOT_CLOSED_BEFORE_YEAR_END now rides the exact
  // missing months in the response's `data` field (see
  // AccountingPeriodService.validateAllMonthsClosedBeforeYearEnd() /
  // BusinessException.getDetails()) -- naming them here instead of the
  // old fixed "enero a noviembre" text, which read as if all eleven
  // months needed an individual close instead of just the ones with
  // real activity.
  const getCloseYearErrorMessage = (errorLike) => {
    const body = errorLike?.response?.data;
    if (body?.message === "MONTHS_NOT_CLOSED_BEFORE_YEAR_END" && Array.isArray(body?.data) && body.data.length > 0) {
      const monthLabels = body.data
        .map((monthNumber) => t.monthNames[monthNumber - 1])
        .filter(Boolean);
      if (monthLabels.length > 0) {
        return t.monthsNotClosedDetail(monthLabels);
      }
    }
    return getApiErrorMessage(errorLike, language, t.errorConn);
  };

  const submitCloseYear = async (e) => {
    e.preventDefault();
    if (!validateCloseYearForm()) return;
    if (!window.confirm(t.confirmCloseYear)) return;

    setSavingCloseYear(true);
    try {
      const response = await api.post(
        `/v1/accounting-periods/${closeYearForm.year}/close-year`,
        {
          notes: closeYearForm.notes.trim(),
          gainAccountId: Number(closeYearForm.gainAccountId),
          lossAccountId: Number(closeYearForm.lossAccountId),
        }
      );
      if (response.data && response.data.success) {
        const doc = response.data.data?.closingEntryDocumentNumber;
        showToast(doc ? t.successCloseYearWithVoucher(doc) : t.successCloseYear);
        closeCloseYearPanel();
        loadPeriods();
      } else {
        showToast(getCloseYearErrorMessage({ response }), "error");
      }
    } catch (error) {
      showToast(getCloseYearErrorMessage(error), "error");
    } finally {
      setSavingCloseYear(false);
    }
  };

  // ── Reabrir (mes o año) ─────────────────────────────────────────────
  const openCloseRowTarget = (period) => {
    setCloseRowTarget({ year: period.year, month: period.month, periodCode: period.periodCode });
    setCloseRowNotes("");
    setCloseRowError("");
  };
  const closeCloseRowPanel = () => setCloseRowTarget(null);

  const submitCloseRow = async (e) => {
    e.preventDefault();
    if (!closeRowTarget) return;
    if (!closeRowNotes.trim()) {
      setCloseRowError(t.required);
      return;
    }
    if (!window.confirm(t.confirmCloseMonth)) return;

    setSavingCloseRow(true);
    try {
      const response = await api.post(
        `/v1/accounting-periods/${closeRowTarget.year}/${closeRowTarget.month}/close`,
        { notes: closeRowNotes.trim() }
      );
      if (response.data && response.data.success) {
        showToast(t.successCloseMonth);
        closeCloseRowPanel();
        loadPeriods();
      } else {
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setSavingCloseRow(false);
    }
  };

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

  // ── Cuentas de Cierre por Defecto (compañía) ────────────────────────
  // NEW (2026-10-05): PATCH /v1/companies/me/closing-defaults. Lazily
  // loads the company's current defaults only when this panel is opened
  // (unlike closingOptions, which loads on mount because the close-year
  // panel needs it ready immediately).
  const openClosingDefaultsPanel = async () => {
    setClosingDefaultsOpen(true);
    setClosingDefaultsErrors({});
    setLoadingClosingDefaults(true);
    try {
      const response = await api.get("/v1/companies/me");
      const company = response.data?.data;
      setClosingDefaultsForm({
        defaultGainAccountId: company?.defaultGainAccountId ? String(company.defaultGainAccountId) : "",
        defaultLossAccountId: company?.defaultLossAccountId ? String(company.defaultLossAccountId) : "",
      });
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoadingClosingDefaults(false);
    }
  };
  const closeClosingDefaultsPanel = () => setClosingDefaultsOpen(false);

  const handleClosingDefaultsChange = (e) => {
    const { name, value } = e.target;
    setClosingDefaultsForm((prev) => ({ ...prev, [name]: value }));
  };

  const validateClosingDefaultsForm = () => {
    const errs = {};
    // Both fields are optional (empty = "no suggestion yet") -- the rule
    // only applies once two concrete accounts are actually chosen, same
    // as the backend's check in CompanyService.updateClosingDefaults().
    if (
      closingDefaultsForm.defaultGainAccountId &&
      closingDefaultsForm.defaultLossAccountId &&
      closingDefaultsForm.defaultGainAccountId === closingDefaultsForm.defaultLossAccountId
    ) {
      errs.defaultLossAccountId = t.gainLossMustDiffer;
    }
    setClosingDefaultsErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitClosingDefaults = async (e) => {
    e.preventDefault();
    if (!validateClosingDefaultsForm()) return;
    setSavingClosingDefaults(true);
    try {
      const response = await api.patch("/v1/companies/me/closing-defaults", {
        defaultGainAccountId: closingDefaultsForm.defaultGainAccountId
          ? Number(closingDefaultsForm.defaultGainAccountId)
          : null,
        defaultLossAccountId: closingDefaultsForm.defaultLossAccountId
          ? Number(closingDefaultsForm.defaultLossAccountId)
          : null,
      });
      if (response.data && response.data.success) {
        showToast(t.successClosingDefaults);
        closeClosingDefaultsPanel();
        loadClosingOptions(); // refresh suggestions used by "Cerrar Año Fiscal"
      } else {
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setSavingClosingDefaults(false);
    }
  };

  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => (b.year - a.year) || (b.month - a.month)),
    [periods]
  );

  // Grouped by year for the collapsible headers below -- NEW
  // (2026-10-12). sortedPeriods is already year-desc/month-desc, so
  // walking it in order and starting a new group whenever the year
  // changes preserves that same order inside each group too.
  const periodsByYear = useMemo(() => {
    const groups = [];
    for (const p of sortedPeriods) {
      const last = groups[groups.length - 1];
      if (last && last.year === p.year) {
        last.rows.push(p);
      } else {
        groups.push({ year: p.year, rows: [p] });
      }
    }
    return groups;
  }, [sortedPeriods]);

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
            <Button variant="ghost" onClick={openClosingDefaultsPanel}>
              ⚙ {t.closingDefaultsBtn}
            </Button>
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
                {[t.period, t.status, t.yearSeal, t.closingVoucher, t.closedBy, t.closedAt, t.closingNotes, t.reopenedBy, t.reopenedAt, t.reopeningNotes, t.actions].map((h) => (
                  <th key={h} className="px-5 py-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedPeriods.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-slate-400">{t.noResults}</td>
                </tr>
              ) : (
                periodsByYear.map(({ year, rows }) => {
                  const isCollapsed = collapsedYears.has(year);
                  return (
                    <Fragment key={year}>
                      {/* NEW (2026-10-12, user request): the table keeps
                          growing as more fiscal years pile up, so each
                          year is a collapsible group -- the row itself is
                          the +/- toggle, not just the little button
                          inside it, so it's easy to click without aiming. */}
                      <tr
                        className="cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors"
                        onClick={() => toggleYearCollapsed(year)}
                      >
                        <td colSpan={11} className="px-5 py-3">
                          <div className="flex items-center gap-2 font-black text-slate-700">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-200 text-sm leading-none text-slate-600">
                              {isCollapsed ? "+" : "−"}
                            </span>
                            {t.year} {year}
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed && rows.map((p) => (
                  <tr key={p.id ?? p.periodCode ?? `${p.year}-${p.month}`} className="hover:bg-slate-50/60 transition-colors">
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
                    <td className="px-5 py-4 text-slate-600 whitespace-nowrap">
                      {p.closingEntryDocumentNumber ? (
                        <span
                          className="font-mono text-xs font-bold text-purple-700"
                          title={`${t.gainAccount}: ${p.gainAccountCode || "—"} ${p.gainAccountName || ""} · ${t.lossAccount}: ${p.lossAccountCode || "—"} ${p.lossAccountName || ""}`}
                        >
                          {p.closingEntryDocumentNumber}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
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
                          // NEW (2026-10-12, user request): an open month
                          // used to show nothing here ("—") -- now it
                          // offers "Cerrar Mes" directly from its own
                          // row, same action slot that shows "Reabrir
                          // Mes" once it's closed, so it behaves like one
                          // toggle control instead of two separate paths.
                          <Button variant="ghost" size="sm" onClick={() => openCloseRowTarget(p)}>
                            {t.closeMonth}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                      ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Cerrar Mes ── */}
      {closeMonthOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/20" onClick={closeCloseMonthPanel} />
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
                    {t.monthNames.map((name, idx) => {
                      const monthNum = idx + 1;
                      const isClosed = closedMonthsForYear(closeMonthForm.year).has(monthNum);
                      return (
                        <option key={idx} value={monthNum} disabled={isClosed}>
                          {name}{isClosed ? ` (${t.closed})` : ""}
                        </option>
                      );
                    })}
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
          <div className="absolute inset-0 bg-slate-900/20" onClick={closeCloseYearPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
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

              {closingOptions.equityAccounts.length === 0 && (
                <p className="text-xs text-red-500">{t.noEquityAccounts}</p>
              )}

              <Field label={t.gainAccount} error={closeYearErrors.gainAccountId}>
                <select name="gainAccountId" value={closeYearForm.gainAccountId} onChange={handleCloseYearChange}
                  className={inputCls(closeYearErrors.gainAccountId)}>
                  <option value="">{t.selectAccount}</option>
                  {closingOptions.equityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </Field>

              <Field label={t.lossAccount} error={closeYearErrors.lossAccountId}>
                <select name="lossAccountId" value={closeYearForm.lossAccountId} onChange={handleCloseYearChange}
                  className={inputCls(closeYearErrors.lossAccountId)}>
                  <option value="">{t.selectAccount}</option>
                  {closingOptions.equityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
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
          <div className="absolute inset-0 bg-slate-900/20" onClick={closeReopenPanel} />
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

      {/* NEW (2026-10-12, user request): "Cerrar Mes" from a specific
          row, same shape as the reopen modal above but posting to the
          close endpoint for that one fixed year/month. */}
      {closeRowTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/20" onClick={closeCloseRowPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800">{t.closeMonthTitle}</h2>
              <button onClick={closeCloseRowPanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={submitCloseRow} className="px-6 py-5 flex flex-col gap-4">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  {t.period}
                </div>
                <div className="text-sm font-mono font-bold text-slate-800">
                  {closeRowTarget.periodCode || `${closeRowTarget.year}-${String(closeRowTarget.month).padStart(2, "0")}`}
                </div>
              </div>

              <Field label={t.notes} error={closeRowError}>
                <textarea value={closeRowNotes}
                  onChange={(e) => { setCloseRowNotes(e.target.value); setCloseRowError(""); }}
                  maxLength={500} rows={3} placeholder={t.notesPlaceholder}
                  className={inputCls(closeRowError)} autoFocus />
              </Field>

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" size="lg" fullWidth loading={savingCloseRow}>
                  {t.confirm}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closeCloseRowPanel} disabled={savingCloseRow}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Cuentas de Cierre por Defecto (compañía) ── */}
      {closingDefaultsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/20" onClick={closeClosingDefaultsPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800">{t.closingDefaultsTitle}</h2>
              <button onClick={closeClosingDefaultsPanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            {loadingClosingDefaults ? (
              <div className="px-6 py-10 text-center text-sm text-slate-400">{t.loadingClosingDefaults}</div>
            ) : (
              <form onSubmit={submitClosingDefaults} className="px-6 py-5 flex flex-col gap-4">
                <p className="text-xs text-slate-400">{t.closingDefaultsHint}</p>

                <Field label={t.gainAccount} error={closingDefaultsErrors.defaultGainAccountId}>
                  <select name="defaultGainAccountId" value={closingDefaultsForm.defaultGainAccountId}
                    onChange={handleClosingDefaultsChange} className={inputCls(closingDefaultsErrors.defaultGainAccountId)}>
                    <option value="">{t.noSuggestion}</option>
                    {closingOptions.equityAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label={t.lossAccount} error={closingDefaultsErrors.defaultLossAccountId}>
                  <select name="defaultLossAccountId" value={closingDefaultsForm.defaultLossAccountId}
                    onChange={handleClosingDefaultsChange} className={inputCls(closingDefaultsErrors.defaultLossAccountId)}>
                    <option value="">{t.noSuggestion}</option>
                    {closingOptions.equityAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                    ))}
                  </select>
                </Field>

                <div className="flex gap-3 pt-2">
                  <Button type="submit" variant="primary" size="lg" fullWidth loading={savingClosingDefaults}>
                    {t.save === "Cerrar" ? "Guardar" : "Save"}
                  </Button>
                  <Button type="button" variant="secondary" size="lg" fullWidth onClick={closeClosingDefaultsPanel} disabled={savingClosingDefaults}>
                    {t.cancel}
                  </Button>
                </div>
              </form>
            )}
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
  return { year: String(now.getFullYear()), notes: "", gainAccountId: "", lossAccountId: "" };
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
