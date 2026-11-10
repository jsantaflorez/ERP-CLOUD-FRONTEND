import { useState } from "react";
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

  return (
    <LogoutRequestContext.Provider value={handleLogout}>
    <div className="flex min-h-screen bg-slate-50">
      {/* SIDEBAR NAVIGATION */}
      {/* UI 2026-11-04: el menú queda fijo a la altura de la ventana (sticky +
          h-screen). Solo la lista de opciones se desplaza, así "Cerrar sesión"
          siempre está visible abajo, sin importar el largo de la página ni
          cuántos submenús de Reportes estén abiertos. */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-slate-900 p-5 text-white">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-4 flex justify-center">
            <img src={logo} alt="ERP Logo" className="h-16" />
          </div>

          <h2 className="text-center text-xl font-bold">{t.systemName}</h2>
          <p className="mb-6 text-center text-sm text-slate-400">
            {t.systemSubtitle}
          </p>

          {/* LOCALIZATION TOGGLES */}
          <div className="mb-6 flex justify-center gap-3">
            <button
              onClick={() => onLanguageChange("es")}
              className={`rounded-md p-1 ${language === "es" ? "ring-2 ring-blue-500" : ""}`}
            >
              <img src={spain} alt="Español" className="h-5 w-7 rounded-sm" />
            </button>

            <button
              onClick={() => onLanguageChange("en")}
              className={`rounded-md p-1 ${language === "en" ? "ring-2 ring-blue-500" : ""}`}
            >
              <img src={uk} alt="English" className="h-5 w-7 rounded-sm" />
            </button>
          </div>

          {/* NAVIGATION LINKS */}
          <nav className="-mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
            <button
              onClick={() => changeView("dashboard")}
              className={`rounded-xl px-4 py-3 text-left transition-colors ${
                activeView === "dashboard" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
              }`}
            >
              {t.navDashboard}
            </button>

            {isAuthorizedOperational && (
              <>
                <button
                  onClick={() => changeView("journalEntry")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "journalEntry" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navJournalEntry}
                </button>

                <button
                  onClick={() => changeView("documentType")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "documentType" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navDocumentType}
                </button>

                <button
                  onClick={() => changeView("costCenter")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "costCenter" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navCostCenter}
                </button>

                <button
                  onClick={() => changeView("chartOfAccount")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "chartOfAccount" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navChartOfAccount}
                </button>

                <button
                  onClick={() => changeView("tax")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "tax" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navTax}
                </button>

                <button
                  onClick={() => changeView("thirdParties")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "thirdParties" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navThirdParties}
                </button>

                {/* REPORTS SUBMENU -- groups every report view (currently
                    just Libro Auxiliar) under one collapsible entry instead
                    of each report being its own flat top-level button. */}
                <div>
                  <button
                    onClick={() => setReportsMenuOpen((open) => !open)}
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors ${
                      isReportView ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                    }`}
                  >
                    <span>{t.navReports}</span>
                    <span
                      className={`text-xs transition-transform ${reportsMenuExpanded ? "rotate-180" : ""}`}
                    >
                      ▾
                    </span>
                  </button>

                  {reportsMenuExpanded && (
                    <div className="mt-1 flex flex-col gap-1 pl-3">
                      {REPORT_GROUPS.map((group) => {
                        const groupHasActiveView = group.views.some((v) => v.view === activeView);
                        const groupExpanded = openReportGroupKeys[group.key] || groupHasActiveView;
                        return (
                          <div key={group.key}>
                            <button
                              onClick={() => toggleReportGroup(group.key)}
                              className={`flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-left text-sm transition-colors ${
                                groupHasActiveView ? "bg-blue-600/80" : "bg-slate-800/60 hover:bg-slate-700"
                              }`}
                            >
                              <span>{t[group.labelKey]}</span>
                              <span
                                className={`text-[10px] transition-transform ${groupExpanded ? "rotate-180" : ""}`}
                              >
                                ▾
                              </span>
                            </button>

                            {groupExpanded && (
                              <div className="mt-1 flex flex-col gap-1 pl-3">
                                {group.views.map((item) => (
                                  <button
                                    key={item.view}
                                    onClick={() => changeView(item.view)}
                                    className={`rounded-xl px-4 py-2 text-left text-xs transition-colors ${
                                      activeView === item.view ? "bg-blue-600" : "bg-slate-800/40 hover:bg-slate-700"
                                    }`}
                                  >
                                    {t[item.labelKey]}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {isAuthorizedManagement && (
              <>
                <button
                  onClick={() => changeView("accountingPeriod")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "accountingPeriod" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navAccountingPeriod}
                </button>

                <button
                  onClick={() => changeView("legalTemplates")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "legalTemplates" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navLegalTemplates}
                </button>

                <button
                  onClick={() => changeView("companySettings")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "companySettings" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navCompanySettings}
                </button>

                <button
                  onClick={() => changeView("users")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "users" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navUsers}
                </button>
              </>
            )}
          </nav>
        </div>

        {/* SESSION LOGOUT -- anclado al pie del menú, siempre visible. */}
        <div className="mt-4 shrink-0 border-t border-slate-700 pt-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 font-medium transition-colors hover:bg-red-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .41.34.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M19 10a.75.75 0 00-.22-.53l-3-3a.75.75 0 10-1.06 1.06l1.72 1.72H7.75a.75.75 0 000 1.5h8.69l-1.72 1.72a.75.75 0 101.06 1.06l3-3A.75.75 0 0019 10z" clipRule="evenodd" />
            </svg>
            {t.logout}
          </button>
        </div>
      </aside>

      {/* CORE WORKSPACE CONTENT VIEWPORT */}
      <main className="flex-1 p-6">
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
    </div>
    </LogoutRequestContext.Provider>
  );
}

export default Dashboard;
