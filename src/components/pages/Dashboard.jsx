import { useEffect, useState } from "react";
import ShortcutsHelp from "../ui/ShortcutsHelp";
import { currentKeyboardContext } from "../ui/keyboard";
import logo from "../../logo/logo.png";
import spain from "../../logo/spain.png";
import uk from "../../logo/uk.png";
import translations from "../../translations";

import UserManagementPage from "./UserManagementPage";
import AppHeader from "../common/AppHeader";
import { LogoutRequestContext } from "../../context/logoutRequest";
import { roleLabel, sortRoles } from "../../utils/roleLevel";
import DocumentTypePage from "./DocumentTypePage";
import CostCenterPage from "./CostCenterPage";
import ChartOfAccountPage from "./ChartOfAccountPage";
import TaxPage from "./TaxPage";
import ThirdPartyPage from "./ThirdPartyPage";
import JournalEntryPage from "./JournalEntryPage";
import AuxiliaryLedgerPage from "./AuxiliaryLedgerPage";
import TrialBalancePage from "./TrialBalancePage";
import CostCenterBalancePage from "./CostCenterBalancePage";
import ThirdPartyBalancePage from "./ThirdPartyBalancePage";
import JournalBookPage from "./JournalBookPage";
import VoucherTypeSummaryPage from "./VoucherTypeSummaryPage";
import BalanceSheetPage from "./BalanceSheetPage";
import TrialBalanceDetailedPage from "./TrialBalanceDetailedPage";
import IncomeStatementPage from "./IncomeStatementPage";
import AccountingPeriodPage from "./AccountingPeriodPage";
import TaxDetailPage from "./TaxDetailPage";
import IncompleteMovementsPage from "./IncompleteMovementsPage";
import ValueSearchPage from "./ValueSearchPage";
// Certificados de Retencion (2026-11-07) -- see
// claude/propuesta-certificados-retencion-2026-11-07.md.
import WithholdingCertificatePage from "./WithholdingCertificatePage";
import LegalDocumentTemplatesPage from "./LegalDocumentTemplatesPage";
import CompanySettingsPage from "./CompanySettingsPage";

// UX IMPROVEMENT (2026-10-17, user request): with 9 reports in one flat
// list, the "Reportes" submenu had gotten long enough that finding one
// meant scanning past the rest. Grouped into 4 collapsible sub-sections
// (same auto-expand-when-active idea as the outer submenu, just one level
// deeper) instead of a single flat list. Add a new report view to the
// group it belongs in -- REPORT_VIEWS (used to auto-expand the outer
// "Reportes" submenu) is derived from this, so it never needs editing by
// hand.
const REPORT_GROUPS = [
  {
    key: "financial",
    labelKey: "navReportsFinancial",
    views: [
      { view: "balanceSheet", labelKey: "navBalanceSheet" },
      { view: "incomeStatement", labelKey: "navIncomeStatement" },
    ],
  },
  {
    key: "legalBooks",
    labelKey: "navReportsLegalBooks",
    views: [
      { view: "journalBook", labelKey: "navJournalBook" },
      { view: "auxiliaryLedger", labelKey: "navAuxiliaryLedger" },
      { view: "voucherTypeSummary", labelKey: "navVoucherTypeSummary" },
      { view: "trialBalance", labelKey: "navTrialBalance" },
      { view: "trialBalanceDetailed", labelKey: "navTrialBalanceDetailed" },
    ],
  },
  {
    key: "management",
    labelKey: "navReportsManagement",
    views: [
      { view: "thirdPartyBalance", labelKey: "navThirdPartyBalance" },
      { view: "costCenterBalance", labelKey: "navCostCenterBalance" },
      { view: "incompleteMovements", labelKey: "navIncompleteMovements" },
      { view: "valueSearch", labelKey: "navValueSearch" },
    ],
  },
  {
    key: "fiscal",
    labelKey: "navReportsFiscal",
    views: [
      { view: "taxDetail", labelKey: "navTaxDetail" },
      { view: "withholdingCertificate", labelKey: "navWithholdingCertificate" },
    ],
  },
];
const REPORT_VIEWS = REPORT_GROUPS.flatMap((group) => group.views.map((v) => v.view));

// UI 2026-11-10 (revisión sidebar): un solo componente para todos los
// ítems del menú, en lugar de ~20 botones con las mismas clases copiadas.
//  - Inactivo: texto gris claro directo sobre el fondo (sin "píldora");
//    fondo blanco al 5% solo al pasar el cursor.
//  - Activo: azul translúcido + texto blanco + barra indicadora de 3px. La
//    barra hace que la selección no dependa solo del color (WCAG 1.4.1).
//    El azul sólido queda reservado para la acción primaria de cada vista.
//  - aria-current="page" sincroniza el estado visual con el accesible.
//  - expanded !== undefined -> se comporta como encabezado plegable
//    (aria-expanded + chevron); hasActiveChild lo resalta en blanco.
const NAV_SIZES = {
  md: "py-2 text-sm",
  sm: "py-1.5 text-[13px]",
  xs: "py-1.5 text-xs",
};

function NavItem({ active = false, onClick, children, size = "md", expanded, hasActiveChild = false, title, shortcut }) {
  const isToggle = expanded !== undefined;
  const state = active
    ? "bg-blue-500/15 font-semibold text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-blue-500"
    : hasActiveChild
      ? "font-medium text-white hover:bg-white/5"
      : "text-slate-300 hover:bg-white/5 hover:text-white";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-expanded={isToggle ? expanded : undefined}
      aria-keyshortcuts={shortcut}
      title={title}
      className={`relative flex w-full items-center justify-between gap-2 rounded-lg px-3 text-left transition-colors ${NAV_SIZES[size]} ${state}`}
    >
      <span className="min-w-0">{children}</span>
      {shortcut && !isToggle && (
        <kbd className="shrink-0 rounded border border-slate-600 px-1 font-sans text-[10px] font-medium text-slate-400" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
      {isToggle && (
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  );
}

// Encabezado de sección del menú: agrupa sin volver a las cajas.
// slate-400 sobre slate-900 = 6.9:1 (AA para texto pequeño).
function NavSectionLabel({ children }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </p>
  );
}

function Dashboard({ user, onLogout, language, onLanguageChange }) {
  const [activeView, setActiveView] = useState("dashboard");
  // UX FIX (2026-09-08): reports used to sit as flat, top-level nav
  // buttons alongside Plan de Cuentas, Terceros, etc. -- with only one
  // report (Libro Auxiliar) that was tolerable, but the user flagged it
  // wouldn't scale once Balance de Comprobación / Balance General / etc.
  // join it. Grouped under a collapsible "Reportes" submenu instead.
  const [reportsMenuOpen, setReportsMenuOpen] = useState(false);
  const isReportView = REPORT_VIEWS.includes(activeView);
  const reportsMenuExpanded = reportsMenuOpen || isReportView;
  // One level deeper (2026-10-17): each of the 4 report sub-groups
  // (Estados Financieros/Libros Legales/Gestión y Terceros/Fiscales)
  // toggles independently, same open-OR-active rule as reportsMenuOpen/
  // isReportView above but keyed by group instead of a single boolean.
  const [openReportGroupKeys, setOpenReportGroupKeys] = useState({});
  const toggleReportGroup = (key) =>
    setOpenReportGroupKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  const t = translations[language] || translations.es;

  // UI 2026-11-10: ventana de atajos. F1 en cualquier parte (también dentro
  // de un campo), "?" fuera de un campo de texto, o el botón "Atajos" del
  // encabezado (evento "kbd:help"). El contexto se calcula al abrir para
  // mostrar primero los atajos de lo que el usuario está haciendo.
  const [shortcutsHelp, setShortcutsHelp] = useState(null); // null | { context }
  const [kbdHintSeen, setKbdHintSeen] = useState(() => {
    try { return localStorage.getItem("erp_kbd_help_seen") === "1"; } catch { return true; }
  });
  const markKbdHintSeen = () => {
    setKbdHintSeen(true);
    try { localStorage.setItem("erp_kbd_help_seen", "1"); } catch { /* sin almacenamiento */ }
  };
  useEffect(() => {
    const open = () => {
      setShortcutsHelp((cur) => cur || { context: currentKeyboardContext() });
      markKbdHintSeen();
    };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === "F1") {
        e.preventDefault(); // evita la ayuda propia del navegador
        setShortcutsHelp((cur) => (cur ? null : { context: currentKeyboardContext() }));
        markKbdHintSeen();
        return;
      }
      if (e.key === "?") {
        const el = document.activeElement;
        const typing = el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) ||
          (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(el.type)));
        if (typing) return;
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("kbd:help", open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("kbd:help", open);
    };
  }, []);

  // NEW (2026-10-01): "unsaved changes" safety net (see pendientes.md).
  // JournalEntryPage reports its own dirty state up here via onDirtyChange
  // -- Dashboard doesn't know WHAT changed, only that navigating away from
  // "journalEntry" right now would lose it. Every sidebar nav button (and
  // logout) goes through the guards below instead of calling
  // setActiveView/onLogout directly. Scoped to journalEntry only for now --
  // no other screen reports a dirty state (see pendientes.md on why this
  // was not extended to the simpler CRUD screens, which don't share
  // JournalEntryPage's "lose a half-typed multi-line form" risk profile).
  const [journalEntryDirty, setJournalEntryDirty] = useState(false);

  // NEW (2026-10-20): cross-navigation from the Informe de Movimientos
  // Incompletos report into Asientos Contables -- the report's "Editar"
  // button needs to land directly on one specific comprobante, already
  // open for edit, rather than just switching to a blank journalEntry
  // view. pendingEditEntryId carries the id across that view switch;
  // JournalEntryPage consumes it (fetches, opens the entry for edit) and
  // calls back to clear it so a later plain visit to Asientos Contables
  // doesn't reopen the same entry.
  const [pendingEditEntryId, setPendingEditEntryId] = useState(null);

  // UI 2026-11-10: F8 = nuevo comprobante desde cualquier pantalla.
  // Salvaguardas para no dañar el trabajo en otras pantallas:
  //  - Con un panel o modal abierto (cualquier [aria-modal]: edición de un
  //    tercero, una cuenta, creación rápida, la ayuda F1...) NO navega: el
  //    contenido de ese panel se perdería al cambiar de pantalla. Avisa.
  //  - Ya en Documentos Contables con un comprobante abierto: no lo
  //    reemplaza (lo decide JournalEntryPage, que avisa).
  //  - Solo para roles con acceso a Documentos Contables.
  //  - Cambia de pantalla por changeView(), el mismo camino del menú, así
  //    que respeta su aviso de cambios sin guardar.
  //  - Ignora la tecla sostenida (e.repeat).
  const [newEntryRequest, setNewEntryRequest] = useState(0);
  const [kbdNotice, setKbdNotice] = useState(null);
  const handleEditEntryFromReport = (entryId) => {
    setPendingEditEntryId(entryId);
    setActiveView("journalEntry");
  };

  const changeView = (view) => {
    if (journalEntryDirty && activeView === "journalEntry" && view !== "journalEntry") {
      if (!window.confirm(t.unsavedChangesWarning)) return;
    }
    setActiveView(view);
  };

  const handleLogout = () => {
    if (journalEntryDirty && activeView === "journalEntry") {
      if (!window.confirm(t.unsavedChangesWarning)) return;
    }
    onLogout();
  };

  // Resolve role hierarchy dynamically supporting both legacy integers and enterprise string tokens
  const userLevel = user?.level;
  // "Accountant" (2026-11-04): ACCOUNTANT role -> operational menus only
  // (entries, catalogs, reports); not periods or users. See utils/roleLevel.js.
  const isAuthorizedOperational = userLevel === "Administrator" || userLevel === "ADMIN" || userLevel === "Accountant" || (Number(userLevel) <= 3);
  const isAuthorizedManagement  = userLevel === "Administrator" || userLevel === "ADMIN" || (Number(userLevel) <= 2);

  // F8 (ver comentario junto a newEntryRequest). Se registra aparte del
  // listener de F1 porque depende de la vista activa y del rol.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "F8" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (e.repeat || !isAuthorizedOperational) return;
      if (document.querySelector('[aria-modal="true"]')) {
        setKbdNotice(language === "en"
          ? "Close the open form first (Esc), then press F8 again."
          : "Primero cierre el formulario abierto (Esc) y vuelva a presionar F8.");
        return;
      }
      if (activeView !== "journalEntry") changeView("journalEntry");
      setNewEntryRequest((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!kbdNotice) return undefined;
    const id = setTimeout(() => setKbdNotice(null), 4000);
    return () => clearTimeout(id);
  }, [kbdNotice]);

  return (
    <LogoutRequestContext.Provider value={handleLogout}>
    <div className="flex min-h-screen bg-slate-100">
      {/* SIDEBAR NAVIGATION */}
      {/* UI 2026-11-04: el menú queda fijo a la altura de la ventana (sticky +
          h-screen). Solo la lista de opciones se desplaza, así "Cerrar sesión"
          siempre está visible abajo, sin importar el largo de la página ni
          cuántos submenús de Reportes estén abiertos. */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-slate-900 px-3 py-4 text-white">
        {/* UI 2026-11-10: marca compacta en una fila (antes logo de 64px
            centrado + idiomas arriba). Libera ~90px de alto para el menú. */}
        <div className="mb-4 flex items-center gap-3 px-2">
          <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-white">{t.systemName}</p>
            <p className="truncate text-xs text-slate-400">{t.systemSubtitle}</p>
          </div>
        </div>

        {/* NAVIGATION LINKS -- UI 2026-11-10: ítems sin "píldora" de fondo;
            el activo usa azul translúcido + barra lateral (ver NavItem). */}
        <nav aria-label={t.navMainMenu} className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
          <NavItem active={activeView === "dashboard"} onClick={() => changeView("dashboard")}>
            {t.navDashboard}
          </NavItem>

          {isAuthorizedOperational && (
            <>
              <NavSectionLabel>{t.navSectionOperations}</NavSectionLabel>
              <NavItem
                active={activeView === "journalEntry"}
                onClick={() => changeView("journalEntry")}
                shortcut="F8"
                title={language === "en" ? "F8: new entry from any screen" : "F8: nuevo comprobante desde cualquier pantalla"}
              >
                {t.navJournalEntry}
              </NavItem>

              {/* REPORTS SUBMENU -- grupos plegables (2026-10-17). El padre no
                  se pinta como "activo" cuando un informe hijo lo está: solo
                  el hijo lleva el indicador, el padre queda en texto blanco. */}
              <NavItem
                onClick={() => setReportsMenuOpen((o) => !o)}
                expanded={reportsMenuExpanded}
                hasActiveChild={isReportView}
              >
                {t.navReports}
              </NavItem>

              {reportsMenuExpanded && (
                <div className="ml-3 flex flex-col gap-0.5 border-l border-slate-700/70 pl-2">
                  {REPORT_GROUPS.map((group) => {
                    const groupHasActiveView = group.views.some((v) => v.view === activeView);
                    const groupExpanded = openReportGroupKeys[group.key] || groupHasActiveView;
                    return (
                      <div key={group.key} className="flex flex-col gap-0.5">
                        <NavItem
                          size="sm"
                          onClick={() => toggleReportGroup(group.key)}
                          expanded={groupExpanded}
                          hasActiveChild={groupHasActiveView}
                        >
                          {t[group.labelKey]}
                        </NavItem>

                        {groupExpanded && (
                          <div className="ml-3 flex flex-col gap-0.5 border-l border-slate-700/70 pl-2">
                            {group.views.map((item) => (
                              <NavItem
                                key={item.view}
                                size="xs"
                                active={activeView === item.view}
                                onClick={() => changeView(item.view)}
                              >
                                {t[item.labelKey]}
                              </NavItem>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <NavSectionLabel>{t.navSectionCatalogs}</NavSectionLabel>
              <NavItem active={activeView === "chartOfAccount"} onClick={() => changeView("chartOfAccount")}>
                {t.navChartOfAccount}
              </NavItem>
              <NavItem active={activeView === "thirdParties"} onClick={() => changeView("thirdParties")}>
                {t.navThirdParties}
              </NavItem>
              <NavItem active={activeView === "documentType"} onClick={() => changeView("documentType")}>
                {t.navDocumentType}
              </NavItem>
              <NavItem active={activeView === "costCenter"} onClick={() => changeView("costCenter")}>
                {t.navCostCenter}
              </NavItem>
              <NavItem active={activeView === "tax"} onClick={() => changeView("tax")}>
                {t.navTax}
              </NavItem>
            </>
          )}

          {isAuthorizedManagement && (
            <>
              <NavSectionLabel>{t.navSectionAdmin}</NavSectionLabel>
              <NavItem active={activeView === "accountingPeriod"} onClick={() => changeView("accountingPeriod")}>
                {t.navAccountingPeriod}
              </NavItem>
              <NavItem active={activeView === "legalTemplates"} onClick={() => changeView("legalTemplates")}>
                {t.navLegalTemplates}
              </NavItem>
              <NavItem active={activeView === "companySettings"} onClick={() => changeView("companySettings")}>
                {t.navCompanySettings}
              </NavItem>
              <NavItem active={activeView === "users"} onClick={() => changeView("users")}>
                {t.navUsers}
              </NavItem>
            </>
          )}
        </nav>

        {/* PIE: idioma + cerrar sesión, siempre visibles (2026-11-04).
            UI 2026-11-10: "Cerrar sesión" pasa de bloque rojo sólido a acción
            discreta; el rojo aparece solo al pasar el cursor. */}
        <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={handleLogout}
            className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .41.34.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M19 10a.75.75 0 00-.22-.53l-3-3a.75.75 0 10-1.06 1.06l1.72 1.72H7.75a.75.75 0 000 1.5h8.69l-1.72 1.72a.75.75 0 101.06 1.06l3-3A.75.75 0 0019 10z" clipRule="evenodd" />
            </svg>
            {t.logout}
          </button>

          {/* LOCALIZATION TOGGLES */}
          <div className="flex gap-1" role="group" aria-label="Idioma / Language">
            <button
              type="button"
              onClick={() => onLanguageChange("es")}
              aria-pressed={language === "es"}
              title="Español"
              className={`rounded-md p-1 transition-opacity ${language === "es" ? "ring-2 ring-blue-500" : "opacity-60 hover:opacity-100"}`}
            >
              <img src={spain} alt="Español" className="h-4 w-6 rounded-sm" />
            </button>
            <button
              type="button"
              onClick={() => onLanguageChange("en")}
              aria-pressed={language === "en"}
              title="English"
              className={`rounded-md p-1 transition-opacity ${language === "en" ? "ring-2 ring-blue-500" : "opacity-60 hover:opacity-100"}`}
            >
              <img src={uk} alt="English" className="h-4 w-6 rounded-sm" />
            </button>
          </div>
        </div>
      </aside>

      {/* CORE WORKSPACE CONTENT VIEWPORT */}
      <main className="min-w-0 flex-1 p-6">
        {activeView === "dashboard" && (
          <>
            <AppHeader title={t.dashboardTitle} subtitle={t.dashboardSubtitle} />

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <p className="text-slate-700">
                <b>{language === "es" ? "Usuario" : "User"}:</b>{" "}
                {user.username}
              </p>

              <p className="mt-2 text-slate-700">
                <b>{language === "es" ? "Rol" : "Role"}:</b>{" "}
                {sortRoles(user.roles).map((r) => roleLabel(r, language)).join(", ") || user.level}
              </p>
            </div>
          </>
        )}

        {activeView === "journalEntry" && (
          <JournalEntryPage
            language={language}
            onDirtyChange={setJournalEntryDirty}
            openEntryId={pendingEditEntryId}
            onOpenEntryIdHandled={() => setPendingEditEntryId(null)}
            newEntryRequest={newEntryRequest}
            onNewEntryRequestHandled={() => setNewEntryRequest(0)}
          />
        )}

        {activeView === "documentType" && (
          <DocumentTypePage language={language} />
        )}

        {activeView === "chartOfAccount" && (
          <ChartOfAccountPage language={language} />
        )}

        {activeView === "costCenter" && (
          <CostCenterPage language={language} />
        )}

        {activeView === "tax" && (
          <TaxPage language={language} />
        )}

        {activeView === "thirdParties" && (
          <ThirdPartyPage language={language} />
        )}

        {activeView === "auxiliaryLedger" && (
          <AuxiliaryLedgerPage language={language} />
        )}

        {activeView === "trialBalance" && (
          <TrialBalancePage language={language} />
        )}

        {activeView === "balanceSheet" && (
          <BalanceSheetPage language={language} />
        )}

        {activeView === "trialBalanceDetailed" && (
          <TrialBalanceDetailedPage language={language} />
        )}

        {activeView === "incomeStatement" && (
          <IncomeStatementPage language={language} />
        )}

        {activeView === "costCenterBalance" && (
          <CostCenterBalancePage language={language} />
        )}

        {activeView === "thirdPartyBalance" && (
          <ThirdPartyBalancePage language={language} />
        )}

        {activeView === "journalBook" && (
          <JournalBookPage language={language} />
        )}

        {activeView === "voucherTypeSummary" && (
          <VoucherTypeSummaryPage language={language} />
        )}

        {activeView === "taxDetail" && (
          <TaxDetailPage language={language} />
        )}

        {activeView === "withholdingCertificate" && (
          <WithholdingCertificatePage language={language} />
        )}

        {activeView === "incompleteMovements" && (
          <IncompleteMovementsPage language={language} onEditEntry={handleEditEntryFromReport} />
        )}

        {activeView === "valueSearch" && (
          <ValueSearchPage language={language} onEditEntry={handleEditEntryFromReport} />
        )}

        {activeView === "accountingPeriod" && (
          <AccountingPeriodPage language={language} />
        )}

        {activeView === "legalTemplates" && (
          <LegalDocumentTemplatesPage language={language} />
        )}

        {activeView === "companySettings" && (
          <CompanySettingsPage language={language} />
        )}

        {activeView === "users" && (
          <UserManagementPage language={language} currentUser={user} />
        )}
      </main>
      {shortcutsHelp && (
        <ShortcutsHelp
          language={language}
          context={shortcutsHelp.context}
          onClose={() => setShortcutsHelp(null)}
        />
      )}

      {kbdNotice && (
        <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-[95] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {kbdNotice}
        </div>
      )}

      {/* Aviso único para descubrir la ayuda; no vuelve a salir. */}
      {!kbdHintSeen && !shortcutsHelp && (
        <div role="status" className="fixed bottom-4 left-[17rem] z-40 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
          <span>
            {language === "en" ? "New: press" : "Nuevo: presiona"}{" "}
            <kbd className="rounded border border-slate-300 px-1.5 font-sans text-xs font-semibold">F1</kbd>{" "}
            {language === "en" ? "to see every keyboard shortcut." : "para ver todos los atajos de teclado."}
          </span>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("kbd:help"))} className="text-sm font-semibold text-blue-700 hover:underline">
            {language === "en" ? "Show" : "Ver atajos"}
          </button>
          <button type="button" onClick={markKbdHintSeen} aria-label={language === "en" ? "Dismiss" : "Descartar"} className="text-lg leading-none text-slate-500 hover:text-slate-800">
            ×
          </button>
        </div>
      )}
    </div>
    </LogoutRequestContext.Provider>
  );
}

export default Dashboard;
