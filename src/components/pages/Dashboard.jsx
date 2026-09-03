import { useState } from "react";
import logo from "../../logo/logo.png";
import spain from "../../logo/spain.png";
import uk from "../../logo/uk.png";
import translations from "../../translations";

import UserManagementPage from "./UserManagementPage";
import AppHeader from "../common/AppHeader";
import DocumentTypePage from "./DocumentTypePage";
import CostCenterPage from "./CostCenterPage";
import ChartOfAccountPage from "./ChartOfAccountPage";
import TaxPage from "./TaxPage";
import ThirdPartyPage from "./ThirdPartyPage";
import JournalEntryPage from "./JournalEntryPage";

function Dashboard({ user, onLogout, language, onLanguageChange }) {
  const [activeView, setActiveView] = useState("dashboard");
  const t = translations[language] || translations.es;

  // Resolve role hierarchy dynamically supporting both legacy integers and enterprise string tokens
  const userLevel = user?.level;
  const isAuthorizedOperational = userLevel === "Administrator" || userLevel === "ADMIN" || (Number(userLevel) <= 3);
  const isAuthorizedManagement  = userLevel === "Administrator" || userLevel === "ADMIN" || (Number(userLevel) <= 2);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* SIDEBAR NAVIGATION */}
      <aside className="flex w-64 flex-col justify-between bg-slate-900 p-5 text-white">
        <div>
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
          <nav className="flex flex-col gap-3">
            <button
              onClick={() => setActiveView("dashboard")}
              className={`rounded-xl px-4 py-3 text-left transition-colors ${
                activeView === "dashboard" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
              }`}
            >
              {t.navDashboard}
            </button>

            {isAuthorizedOperational && (
              <>
                <button
                  onClick={() => setActiveView("journalEntry")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "journalEntry" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navJournalEntry}
                </button>

                <button
                  onClick={() => setActiveView("documentType")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "documentType" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navDocumentType}
                </button>

                <button
                  onClick={() => setActiveView("costCenter")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "costCenter" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navCostCenter}
                </button>

                <button
                  onClick={() => setActiveView("chartOfAccount")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "chartOfAccount" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navChartOfAccount}
                </button>

                <button
                  onClick={() => setActiveView("tax")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "tax" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navTax}
                </button>

                <button
                  onClick={() => setActiveView("thirdParties")}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    activeView === "thirdParties" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {t.navThirdParties}
                </button>
              </>
            )}

            {isAuthorizedManagement && (
              <button
                onClick={() => setActiveView("users")}
                className={`rounded-xl px-4 py-3 text-left transition-colors ${
                  activeView === "users" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"
                }`}
              >
                {t.navUsers}
              </button>
            )}
          </nav>
        </div>

        {/* SESSION LOGOUT */}
        <button
          onClick={onLogout}
          className="rounded-xl bg-red-600 px-4 py-3 font-medium transition-colors hover:bg-red-700"
        >
          {t.logout}
        </button>
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
                <b>{language === "es" ? "Nivel" : "Level"}:</b> {user.level}
              </p>
            </div>
          </>
        )}

        {activeView === "journalEntry" && (
          <JournalEntryPage language={language} />
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

        {activeView === "users" && (
          <UserManagementPage language={language} currentUser={user} />
        )}
      </main>
    </div>
  );
}

export default Dashboard;
