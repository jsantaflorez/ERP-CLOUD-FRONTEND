 // src/components/common/AppHeader.jsx
import { useEffect, useState } from "react";
import logo from "../../logo/logo.png";  // sube 2 niveles: common -> components -> src -> logo
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import Button from "../ui/Button";
import { roleLabel, sortRoles } from "../../utils/roleLevel";
import { useLogoutRequest } from "../../context/logoutRequest";

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
    activeUser: "Usuario",
    logout: "Cerrar sesión",
    roleInCompany: "Rol en esta empresa",
    noRole: "Sin rol",
    shortcuts: "Atajos",
    shortcutsTitle: "Atajos de teclado (F1)",
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
    activeUser: "User",
    logout: "Log out",
    roleInCompany: "Role in this company",
    noRole: "No role",
    shortcuts: "Shortcuts",
    shortcutsTitle: "Keyboard shortcuts (F1)",
  },
};

function companyLabel(c) {
  return `${c.tradeName || c.legalName}${c.taxId ? ` -- NIT ${c.taxId}` : ""}`;
}

function initials(name) {
  const parts = String(name || "").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// NEW (2026-11-04): session context block -- WHO is working (name/email)
// and WITH WHICH ROLE in the active company. Reads AuthContext's session,
// which Login fills and switchCompany() refreshes with the new company's
// roles (persisted by tenantSession, so it also survives the reload that
// follows a switch). Purely informative: the backend enforces permissions.
function SessionUserBlock({ session, t, language, onLogout }) {
  const name = session?.username || session?.email;
  if (!name) return null;
  const roles = sortRoles(session?.roles);
  const mainRole = roles.length ? roleLabel(roles[0], language) : t.noRole;
  const allRoles = roles.map((r) => roleLabel(r, language)).join(", ");
  const tooltip = [session?.email, allRoles && `${t.roleInCompany}: ${allRoles}`].filter(Boolean).join("\n");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-3" title={tooltip}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
        {initials(name)}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{t.activeUser}</span>
        <span className="max-w-[14rem] truncate text-sm font-bold text-slate-800">{name}</span>
        <span className="mt-0.5 w-fit rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
          {mainRole}
          {roles.length > 1 && <span className="ml-1 font-semibold text-emerald-700">+{roles.length - 1}</span>}
        </span>
      </div>
      </div>

      {/* UI 2026-11-04: "Cerrar sesión" junto al usuario, donde se busca
          primero; usa el mismo handleLogout del menú (vía contexto), que
          avisa si hay un comprobante sin guardar. */}
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-1.5 self-stretch border-l border-slate-200 pl-3 text-xs font-semibold text-slate-600 transition-colors hover:text-red-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .41.34.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M19 10a.75.75 0 00-.22-.53l-3-3a.75.75 0 10-1.06 1.06l1.72 1.72H7.75a.75.75 0 000 1.5h8.69l-1.72 1.72a.75.75 0 101.06 1.06l3-3A.75.75 0 0019 10z" clipRule="evenodd" />
          </svg>
          {t.logout}
        </button>
      )}
    </div>
  );
}

function AppHeader({ title, subtitle, actions, tenantId, language = "es" }) {
  const { session, switchCompany } = useAuth();
  const requestLogout = useLogoutRequest();
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
  // Name shown when there is nothing to switch to (single-company users):
  // the real company name, never the bare numeric id when we can avoid it.
  const staticCompanyLabel = currentCompany
    ? companyLabel(currentCompany)
    : (session?.companyName || tenantId || session?.companyId);

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

      {/* -- Bloque derecho: Banner de Compania + Acciones --
          UI 2026-11-10: el banner pasa de índigo sólido a índigo claro. Sigue
          siendo inconfundible (tinte propio, punto verde, nombre en negrita,
          indigo-950 sobre indigo-50 ~ 16:1) pero ya no compite con "+ Nuevo",
          que debe ser el único bloque de color sólido del área de trabajo.
          La confirmación del cambio de empresa (2026-10-29) no cambia. */}
      <div className="flex flex-wrap items-center justify-end gap-3">

        {/* UI 2026-11-10: abre la ventana de atajos (la escucha Dashboard). */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("kbd:help"))}
          title={t.shortcutsTitle}
          aria-keyshortcuts="F1"
          className="flex items-center gap-1.5 self-stretch rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M2 5.75A1.75 1.75 0 013.75 4h12.5c.97 0 1.75.78 1.75 1.75v8.5A1.75 1.75 0 0116.25 16H3.75A1.75 1.75 0 012 14.25v-8.5zM5 7.5a.75.75 0 000 1.5h.01a.75.75 0 000-1.5H5zm2.75.75A.75.75 0 018.5 7.5h.01a.75.75 0 010 1.5H8.5a.75.75 0 01-.75-.75zM12 7.5a.75.75 0 000 1.5h.01a.75.75 0 000-1.5H12zm2.75.75a.75.75 0 01.75-.75h.01a.75.75 0 010 1.5h-.01a.75.75 0 01-.75-.75zM5 10.5a.75.75 0 000 1.5h.01a.75.75 0 000-1.5H5zm9.5 0a.75.75 0 000 1.5h.01a.75.75 0 000-1.5h-.01zM7.75 13a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zm.75-2.5a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z" clipRule="evenodd" />
          </svg>
          {t.shortcuts}
          <kbd className="rounded border border-slate-300 px-1 font-sans text-[10px] font-medium text-slate-500">F1</kbd>
        </button>

        <SessionUserBlock session={session} t={t} language={language} onLogout={requestLogout} />

        {canSwitch ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" aria-hidden="true" />
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
                {t.activeCompany}
              </span>
              <select
                value={session?.companyId ? String(session.companyId) : ""}
                onChange={handlePick}
                disabled={switching}
                title={switching ? t.switching : undefined}
                aria-label={t.activeCompany}
                className="cursor-pointer bg-transparent pr-1 text-sm font-bold text-indigo-950 disabled:opacity-60 [&>option]:text-slate-800"
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
          staticCompanyLabel && (
            <div className="flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" aria-hidden="true" />
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
                  {t.activeCompany}
                </span>
                <span className="text-sm font-bold text-indigo-950">{staticCompanyLabel}</span>
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
        <p className="absolute -bottom-5 right-6 text-xs text-red-700">{switchError}</p>
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
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
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