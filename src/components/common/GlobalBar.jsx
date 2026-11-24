// src/components/common/GlobalBar.jsx
//
// UI 2026-11-21 (análisis de usabilidad del encabezado): la sesión -- empresa
// activa, usuario, rol, cerrar sesión y atajos -- antes se repetía DENTRO del
// encabezado de cada una de las 27 pantallas (AppHeader), en tres tarjetas
// con etiquetas en mayúsculas, compitiendo con el título y con la acción
// principal. Ahora vive aquí, UNA vez, en una barra delgada fija arriba del
// área de trabajo (Dashboard la monta). AppHeader queda solo con el título de
// la pantalla y sus acciones.
//
// Se conserva todo lo que ya estaba probado en AppHeader:
//  - Empresa activa siempre visible (punto verde + nombre + NIT), porque es
//    lo primero que hay que confirmar antes de digitar.
//  - El cambio de empresa NUNCA es inmediato: abre la confirmación que nombra
//    la empresa actual y la nueva (2026-10-29), y recarga la página al final.
//  - Cerrar sesión pasa por requestLogout (avisa si hay un documento sin
//    guardar).
import { useEffect, useRef, useState } from "react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import Button from "../ui/Button";
import { roleLabel, sortRoles } from "../../utils/roleLevel";
import { useLogoutRequest } from "../../context/logoutRequest";

const LABELS = {
  es: {
    activeCompany: "Empresa activa",
    switching: "Cambiando de empresa...",
    switchError: "No se pudo cambiar de empresa.",
    confirmTitle: "Confirmar cambio de empresa",
    confirmWarning:
      "Verifica bien: todo lo que registres DESPUÉS del cambio se guardará en la empresa nueva, no en la actual.",
    confirmFrom: "De",
    confirmTo: "A",
    confirmButton: "Sí, cambiar de empresa",
    cancelButton: "Cancelar",
    shortcutsTitle: "Atajos de teclado (F1)",
    userMenu: "Menú del usuario",
    roleInCompany: "Rol en esta empresa",
    noRole: "Sin rol",
    logout: "Cerrar sesión",
  },
  en: {
    activeCompany: "Active company",
    switching: "Switching company...",
    switchError: "Could not switch company.",
    confirmTitle: "Confirm company switch",
    confirmWarning:
      "Double-check: anything you enter AFTER switching will be saved under the new company, not the current one.",
    confirmFrom: "From",
    confirmTo: "To",
    confirmButton: "Yes, switch company",
    cancelButton: "Cancel",
    shortcutsTitle: "Keyboard shortcuts (F1)",
    userMenu: "User menu",
    roleInCompany: "Role in this company",
    noRole: "No role",
    logout: "Log out",
  },
};

function companyName(c) {
  return c.tradeName || c.legalName;
}

function initials(name) {
  const parts = String(name || "").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function ChevronDown({ className = "h-3.5 w-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

// Avatar + nombre + rol principal; el menú muestra correo, todos los roles en
// la empresa activa y "Cerrar sesión". Enter/Espacio abre, Escape cierra.
function UserMenu({ session, t, language, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const name = session?.username || session?.email;
  if (!name) return null;
  const roles = sortRoles(session?.roles);
  const mainRole = roles.length ? roleLabel(roles[0], language) : t.noRole;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.userMenu}: ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-100"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-white">
          {initials(name)}
        </span>
        <span className="max-w-[12rem] truncate font-semibold">{name}</span>
        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">{mainRole}</span>
        <ChevronDown />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2.5 text-xs text-slate-500">
            {session?.email && <div className="truncate font-medium text-slate-700">{session.email}</div>}
            <div className="mt-1">
              {t.roleInCompany}: <span className="font-medium text-slate-700">{roles.map((r) => roleLabel(r, language)).join(", ") || t.noRole}</span>
            </div>
          </div>
          {onLogout && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-red-50 hover:text-red-700 focus:bg-red-50"
            >
              {t.logout}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GlobalBar({ language = "es" }) {
  const { session, switchCompany } = useAuth();
  const requestLogout = useLogoutRequest();
  const [companies, setCompanies] = useState([]);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const [pendingCompany, setPendingCompany] = useState(null);
  const t = LABELS[language] || LABELS.es;

  useEffect(() => {
    let cancelled = false;
    if (!session?.token) {
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

  const current = companies.find((c) => String(c.id) === String(session?.companyId));
  const currentName = current ? companyName(current) : (session?.companyName || session?.companyId || "");
  const currentTaxId = current?.taxId;
  const canSwitch = companies.length > 1;

  const handlePick = (e) => {
    const newId = e.target.value;
    if (!newId || String(session?.companyId) === newId) return;
    const chosen = companies.find((c) => String(c.id) === newId);
    if (!chosen) return;
    setSwitchError(null);
    setPendingCompany({
      id: newId,
      label: `${companyName(chosen)}${chosen.taxId ? ` -- NIT ${chosen.taxId}` : ""}`,
    });
  };

  const confirmSwitch = async () => {
    if (!pendingCompany) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchCompany(pendingCompany.id, pendingCompany.label);
      // Recarga completa a propósito: cada pantalla vuelve a cargar sus
      // datos contra la empresa nueva (ver la nota original en AppHeader).
      window.location.reload();
    } catch (err) {
      setSwitchError(getApiErrorMessage(err, language, t.switchError));
      setSwitching(false);
      setPendingCompany(null);
    }
  };

  return (
    <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-5 flex h-12 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur">
      {/* Empresa activa: siempre visible, con selector solo si hay más de una. */}
      <div className="flex min-w-0 items-center gap-2 text-sm" title={t.activeCompany}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" aria-hidden="true" />
        {canSwitch ? (
          <label className="relative flex min-w-0 items-center gap-1">
            <span className="sr-only">{t.activeCompany}</span>
            <select
              value={session?.companyId ? String(session.companyId) : ""}
              onChange={handlePick}
              disabled={switching}
              className="max-w-[22rem] cursor-pointer truncate rounded-md bg-transparent py-1 pr-1 font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {companyName(c)}{c.taxId ? ` -- NIT ${c.taxId}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <span className="truncate font-semibold text-slate-900">{currentName}</span>
            {currentTaxId && <span className="whitespace-nowrap text-slate-500">NIT {currentTaxId}</span>}
          </>
        )}
        {switchError && <span className="ml-2 text-xs text-red-700">{switchError}</span>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("kbd:help"))}
          title={t.shortcutsTitle}
          aria-label={t.shortcutsTitle}
          aria-keyshortcuts="F1"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M2 5.75A1.75 1.75 0 013.75 4h12.5c.97 0 1.75.78 1.75 1.75v8.5A1.75 1.75 0 0116.25 16H3.75A1.75 1.75 0 012 14.25v-8.5zM5 7.5a.75.75 0 000 1.5h.01a.75.75 0 000-1.5H5zm2.75.75A.75.75 0 018.5 7.5h.01a.75.75 0 010 1.5H8.5a.75.75 0 01-.75-.75zM12 7.5a.75.75 0 000 1.5h.01a.75.75 0 000-1.5H12zm2.75.75a.75.75 0 01.75-.75h.01a.75.75 0 010 1.5h-.01a.75.75 0 01-.75-.75zM5 10.5a.75.75 0 000 1.5h.01a.75.75 0 000-1.5H5zm9.5 0a.75.75 0 000 1.5h.01a.75.75 0 000-1.5h-.01zM7.75 13a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zm.75-2.5a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z" clipRule="evenodd" />
          </svg>
          <kbd className="font-sans">F1</kbd>
        </button>
        <UserMenu session={session} t={t} language={language} onLogout={requestLogout} />
      </div>

      {pendingCompany && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => !switching && setPendingCompany(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={t.confirmTitle}>
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-black text-slate-800">{t.confirmTitle}</h2>
            </div>
            <div className="flex flex-col gap-4 px-6 py-5">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-xs font-semibold text-slate-500">{t.confirmFrom}</span>
                  <span className="font-semibold text-slate-600">
                    {currentName}{currentTaxId ? ` -- NIT ${currentTaxId}` : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2">
                  <span className="text-xs font-semibold text-indigo-600">{t.confirmTo}</span>
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
                <Button type="button" variant="secondary" fullWidth disabled={switching} onClick={() => setPendingCompany(null)}>
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

export default GlobalBar;
