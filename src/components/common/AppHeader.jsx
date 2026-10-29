 // src/components/common/AppHeader.jsx
import { useEffect, useState } from "react";
import logo from "../../logo/logo.png";  // sube 2 niveles: common -> components -> src -> logo
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import Button from "../ui/Button";

// NEW (2026-10-28, Multiempresa Fase 2): the static tenant badge below
// became a live company switcher. Deliberately self-contained -- it
// reads the session and fetches its own company list via useAuth()/api,
// instead of asking every one of the ~20 pages that already render
// <AppHeader tenantId={...} /> to also pass a company list. Those call
// sites keep working unchanged: when the user has 1 (or 0, e.g. not
// logged in yet) companies, this still just renders the old plain
// badge from the `tenantId` prop. The dropdown only appears once there
// is something real to switch between.
//
// UPDATED (2026-10-29, user request): two safety upgrades after real
// multi-company testing --
//   1. The active-company indicator was a small, easy-to-miss pill --
//      bumped into a solid, high-contrast banner (bold label + bold
//      company name) so it's unmistakable which company you're in
//      before typing financial data.
//   2. Picking a different company in the dropdown no longer switches
//      immediately -- it opens a confirmation modal naming BOTH the
//      current and the target company, so a misclick can't silently
//      move you into the wrong tenant mid-entry.
//
// `language` is optional (defaults to "es") precisely so none of the
// existing call sites have to change -- most of this app's pages don't
// thread `language` into AppHeader today.
const LABELS = {
  es: {
    switching: "Cambiando de empresa...",
    switchError: "No se pudo cambiar de empresa.",
    activeCompany: "Empresa Activa",
    confirmTitle: "Confirmar cambio de empresa",
    confirmWarning:
      "Verifica bien: todo lo que registres DESPUÉS del cambio se guardará en la empresa nueva, no en la actual.",
    confirmFrom: "De",
    confirmTo: "A",
    confirmButton: "Sí, cambiar de empresa",
    cancelButton: "Cancelar",
  },
  en: {
    switching: "Switching company...",
    switchError: "Could not switch company.",
    activeCompany: "Active Company",
    confirmTitle: "Confirm company switch",
    confirmWarning:
      "Double-check: anything you enter AFTER switching will be saved under the new company, not the current one.",
    confirmFrom: "From",
    confirmTo: "To",
    confirmButton: "Yes, switch company",
    cancelButton: "Cancel",
  },
};

function companyLabel(c) {
  return `${c.tradeName || c.legalName}${c.taxId ? ` -- NIT ${c.taxId}` : ""}`;
}

function AppHeader({ title, subtitle, actions, tenantId, language = "es" }) {
  const { session, switchCompany } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  // NEW: the company the user picked in the dropdown, held here UNTIL
  // confirmed in the modal below -- the actual switchCompany() call (and
  // the page reload after it) only happens from the modal's confirm
  // button, never directly from the <select>'s onChange.
  const [pendingCompany, setPendingCompany] = useState(null);

  const t = LABELS[language] || LABELS.es;

  // Loads the companies THIS authenticated user can switch into. Scoped
  // to session.token so it only runs once there's actually a session
  // (never on the Login screen, which has no AppHeader anyway), and
  // re-runs after a switch (token changes) so the list + current
  // selection both stay correct.
  useEffect(() => {
    let cancelled = false;

    if (!session?.token) {
      // Clearing the stale company list when the session disappears
      // (e.g. logout without unmount) IS the synchronization this effect
      // does -- intentional, not a derived-state anti-pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompanies([]);
      return undefined;
    }

    api
      .get("/v1/session/companies")
      .then((res) => {
        if (!cancelled) setCompanies(Array.isArray(res.data?.data) ? res.data.data : []);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.token]);

  // Only STAGES the switch -- opens the confirmation modal instead of
  // calling the backend directly. The <select> stays a controlled
  // component bound to session.companyId, so once this re-renders
  // without changing that value, it snaps back to showing the current
  // company underneath the modal (nothing to manually "undo" if the
  // user cancels).
  const handlePick = (e) => {
    const newId = e.target.value;
    if (!newId || String(session?.companyId) === newId) return;

    const chosen = companies.find((c) => String(c.id) === newId);
    if (!chosen) return;

    setSwitchError(null);
    setPendingCompany({ id: newId, label: companyLabel(chosen) });
  };

  const confirmSwitch = async () => {
    if (!pendingCompany) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchCompany(pendingCompany.id, pendingCompany.label);
      // A full reload is deliberate: every report/page in this app
      // fetches its own data on mount against whatever company is
      // active at that moment (no shared cache to invalidate). Reloading
      // is the simplest way to guarantee every screen re-fetches scoped
      // to the NEW company, instead of auditing every page's effects.
      window.location.reload();
    } catch (err) {
      setSwitchError(getApiErrorMessage(err, language, t.switchError));
      setSwitching(false);
      setPendingCompany(null);
    }
  };

  // Only worth showing as an interactive control once there is an actual
  // choice -- a single-company user (the common pilot case today) just
  // sees the same plain banner as before, without a dropdown.
  const canSwitch = companies.length > 1;

  // Resolves the CURRENT company's own label for the confirmation modal
  // (falls back to the tenantId prop/raw id if the company list hasn't
  // loaded for some reason -- still informative, just less pretty).
  const currentCompany = companies.find((c) => String(c.id) === String(session?.companyId));
  const currentLabel = currentCompany ? companyLabel(currentCompany) : (tenantId || session?.companyId);

  return (
    <div className="relative mb-6 flex items-center justify-between rounded-2xl bg-white px-6 py-4 shadow-sm ring-1 ring-slate-200">

      {/* -- Bloque izquierdo: Logo + Textos -- */}
      <div className="flex items-center gap-4">
        <img
          src={logo}
          alt="IntEgraERP Logo"
          className="h-12 w-auto object-contain"
        />
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          )}
        </div>
      </div>

      {/* -- Bloque derecho: Banner de Compania (llamativo a proposito) + Acciones -- */}
      <div className="flex items-center gap-3">

        {canSwitch ? (
          <div className="flex items-center gap-2 rounded-xl border-2 border-indigo-800 bg-indigo-700 px-4 py-2 shadow-md">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
            <div className="flex flex-col leading-tight">
              <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-200">
                {t.activeCompany}
              </span>
              <select
                value={session?.companyId ? String(session.companyId) : ""}
                onChange={handlePick}
                disabled={switching}
                title={switching ? t.switching : undefined}
                className="cursor-pointer bg-transparent text-sm font-black text-white outline-none disabled:opacity-60 [&>option]:text-slate-800"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {companyLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          tenantId && (
            <div className="flex items-center gap-2 rounded-xl border-2 border-indigo-800 bg-indigo-700 px-4 py-2 shadow-md">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
              <div className="flex flex-col leading-tight">
                <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-200">
                  {t.activeCompany}
                </span>
                <span className="text-sm font-black text-white">{tenantId}</span>
              </div>
            </div>
          )
        )}

        {/* Slot de acciones: cada modulo inyecta sus propios botones */}
        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>

      {switchError && (
        <p className="absolute -bottom-5 right-6 text-xs text-red-500">{switchError}</p>
      )}

      {/* NEW: confirmation modal -- gates every company switch behind an
          explicit "yes, I mean it" naming both companies by name, so a
          misclick on the dropdown can never silently move the active
          company underneath whatever the user is about to type. */}
      {pendingCompany && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !switching && setPendingCompany(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-black text-slate-800">{t.confirmTitle}</h2>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t.confirmFrom}
                  </span>
                  <span className="font-semibold text-slate-600">{currentLabel}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">
                    {t.confirmTo}
                  </span>
                  <span className="font-semibold text-indigo-800">{pendingCompany.label}</span>
                </div>
              </div>

              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700">
                {t.confirmWarning}
              </p>

              <div className="flex gap-3 pt-1">
                <Button type="button" variant="danger" fullWidth loading={switching} onClick={confirmSwitch}>
                  {switching ? t.switching : t.confirmButton}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  fullWidth
                  disabled={switching}
                  onClick={() => setPendingCompany(null)}
                >
                  {t.cancelButton}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default AppHeader;