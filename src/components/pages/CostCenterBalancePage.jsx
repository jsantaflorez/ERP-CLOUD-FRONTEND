import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import { formatGeneratedAt } from "../../utils/reportExport";

// NEW (2026-09-21): third report screen, after Libro Auxiliar and Balance
// de Comprobación. First built as a simple period-totals report (no
// opening/closing balance), then upgraded the same day after the user
// showed a real report from their previous system: a cost center
// attached to a balance-sheet account (e.g. inventory, cartera) DOES
// carry a genuine accumulated balance, the same way the account itself
// does -- so this needed the same shape as the Auxiliary Ledger
// (Saldo Inicial + movements + Nuevo Saldo), just grouped by cost center
// instead of account. One real difference from the account-grouped
// ledger: a single cost center's transactions can come from several
// different accounts, so each row shows its own account code/name
// (the account-grouped ledger doesn't need that column, since there the
// account is already the group's header).
// Export to Excel/PDF deliberately left out of this first version, same
// as the original period-totals cut -- can be added later the same way
// TrialBalancePage/AuxiliaryLedgerPage already do it.
function CostCenterBalancePage({ language = "es" }) {
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [filters, setFilters] = useState({
    startDate: firstOfMonth,
    endDate: today,
    accountId: "", // "" = todas las cuentas
    costCenterId: "", // "" = todos los centros de costo
  });

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Auxiliar por Centro de Costo",
      subtitle: "Saldo inicial, movimientos y saldo corriente por centro de costo",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      account: "Cuenta",
      allAccounts: "— Todas las cuentas —",
      costCenter: "Centro de Costo",
      allCostCenters: "— Todos los centros de costo —",
      generate: "Generar",
      generating: "Generando...",
      loadingCatalogs: "Cargando...",
      dateRequired: "Selecciona ambas fechas para generar el reporte.",
      endBeforeStart: "La fecha final no puede ser anterior a la fecha inicial.",
      noResults: "Sin movimientos para los filtros seleccionados.",
      openingBalance: "Saldo Inicial",
      date: "Fecha",
      document: "Documento",
      detail: "Detalle",
      accountCol: "Cuenta",
      thirdParty: "Tercero",
      debit: "Débito",
      credit: "Crédito",
      balance: "Nuevo Saldo",
      totalDebits: "Total Débitos",
      totalCredits: "Total Créditos",
      closingBalance: "Saldo Final",
      totalRecords: "Movimientos",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      grandTotals: "Totales Generales",
    },
    en: {
      title: "Auxiliary Ledger by Cost Center",
      subtitle: "Opening balance, movements and running balance per cost center",
      startDate: "Start Date",
      endDate: "End Date",
      account: "Account",
      allAccounts: "— All accounts —",
      costCenter: "Cost Center",
      allCostCenters: "— All cost centers —",
      generate: "Generate",
      generating: "Generating...",
      loadingCatalogs: "Loading...",
      dateRequired: "Select both dates to generate the report.",
      endBeforeStart: "End date can't be before start date.",
      noResults: "No movements for the selected filters.",
      openingBalance: "Opening Balance",
      date: "Date",
      document: "Document",
      detail: "Detail",
      accountCol: "Account",
      thirdParty: "Third Party",
      debit: "Debit",
      credit: "Credit",
      balance: "New Balance",
      totalDebits: "Total Debits",
      totalCredits: "Total Credits",
      closingBalance: "Closing Balance",
      totalRecords: "Movements",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      grandTotals: "Grand Totals",
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

  const loadCatalogs = async () => {
    setLoadingCatalogs(true);
    try {
      const [accRes, ccRes] = await Promise.allSettled([
        api.get("/v1/chart-of-accounts", { params: { size: 500, sort: "code" } }),
        api.get("/v1/cost-centers"),
      ]);

      if (accRes.status === "fulfilled" && accRes.value.data?.success) {
        const payloadData = accRes.value.data.data;
        const list = Array.isArray(payloadData)
          ? payloadData
          : Array.isArray(payloadData?.content)
            ? payloadData.content
            : [];
        setAccounts(list.filter((a) => a.postingAccount));
      }

      if (ccRes.status === "fulfilled" && ccRes.value.data?.success) {
        const payloadData = ccRes.value.data.data;
        const list = Array.isArray(payloadData)
          ? payloadData
          : Array.isArray(payloadData?.content)
            ? payloadData.content
            : [];
        // Only cost centers that can actually receive movements show up
        // in journal entries -- same reasoning as filtering accounts to
        // postingAccount above (a header/grouping-only cost center would
        // just come back empty every time).
        setCostCenters(list.filter((cc) => cc.allowsMovement));
      }
    } catch (error) {
      console.error("Failed to load filters for cost center ledger", error);
    } finally {
      setLoadingCatalogs(false);
    }
  };

  useEffect(() => {
    loadCatalogs();
  }, []);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!filters.startDate || !filters.endDate) {
      setError(t.dateRequired);
      return;
    }
    if (filters.endDate < filters.startDate) {
      setError(t.endBeforeStart);
      return;
    }

    const selectedAccount = filters.accountId
      ? accounts.find((a) => String(a.id) === String(filters.accountId))
      : null;
    const selectedCostCenter = filters.costCenterId
      ? costCenters.find((cc) => String(cc.id) === String(filters.costCenterId))
      : null;

    const params = {
      startDate: filters.startDate,
      endDate: filters.endDate,
    };
    if (selectedAccount) {
      params.startCode = selectedAccount.code;
      params.endCode = selectedAccount.code;
    }
    if (selectedCostCenter) {
      params.costCenterCode = selectedCostCenter.code;
    }

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/cost-center-balance", { params });
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

  const grandTotals = useMemo(() => {
    if (!report?.costCenterGroups?.length || report.costCenterGroups.length < 2) return null;
    return report.costCenterGroups.reduce(
      (acc, g) => ({
        totalDebits: acc.totalDebits + Number(g.totalDebits || 0),
        totalCredits: acc.totalCredits + Number(g.totalCredits || 0),
        totalRecords: acc.totalRecords + Number(g.totalRecords || 0),
      }),
      { totalDebits: 0, totalCredits: 0, totalRecords: 0 }
    );
  }, [report]);

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
            name="startDate"
            value={filters.startDate}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.endDate}
          </label>
          <input
            type="date"
            name="endDate"
            value={filters.endDate}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex min-w-[220px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.costCenter}
          </label>
          <select
            name="costCenterId"
            value={filters.costCenterId}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allCostCenters}</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.code} — {cc.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-[260px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.account}
          </label>
          <select
            name="accountId"
            value={filters.accountId}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="primary" loading={loading} disabled={loadingCatalogs}>
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
          {(report.generatedAt || report.companyName) && (
            <p className="text-xs text-slate-400">
              {report.companyName && <strong className="text-slate-500">{report.companyName}</strong>}
              {report.companyName && report.generatedAt && " — "}
              {report.generatedAt && `${t.generatedAt}: ${formatGeneratedAt(report.generatedAt)}`}
            </p>
          )}

          {(!report.costCenterGroups || report.costCenterGroups.length === 0) && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {report.costCenterGroups?.map((group) => (
            <div
              key={group.costCenterCode}
              className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-slate-50 px-5 py-4">
                <div>
                  <span className="font-bold text-slate-700">{group.costCenterCode}</span>{" "}
                  <span className="text-slate-600">{group.costCenterName}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {t.openingBalance}:{" "}
                  <strong className="text-slate-700">
                    {formatAmount(group.openingBalance) || "0.00"}
                  </strong>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.date}</th>
                      <th className="px-4 py-3">{t.document}</th>
                      <th className="px-4 py-3">{t.detail}</th>
                      <th className="px-4 py-3">{t.accountCol}</th>
                      <th className="px-4 py-3">{t.thirdParty}</th>
                      <th className="px-4 py-3 text-right">{t.debit}</th>
                      <th className="px-4 py-3 text-right">{t.credit}</th>
                      <th className="px-4 py-3 text-right">{t.balance}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(group.transactions || []).map((tx, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-600">{tx.transactionDate}</td>
                        <td className="px-4 py-2.5 text-slate-600">{tx.documentNumber}</td>
                        <td className="px-4 py-2.5 text-slate-600">{tx.detail}</td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {tx.accountCode ? `${tx.accountCode} — ${tx.accountName || ""}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{tx.thirdPartyName || "—"}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {formatAmount(tx.debit)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {formatAmount(tx.credit)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatAmount(tx.newBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={5}>
                        {t.totalRecords}: {group.totalRecords ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right">{formatAmount(group.totalDebits)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(group.totalCredits)}</td>
                      <td className="px-4 py-3 text-right">{formatAmount(group.closingBalance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          {grandTotals && (
            <div className="flex flex-wrap items-center justify-end gap-6 rounded-xl border border-gray-100 bg-white px-5 py-4 text-sm shadow-sm">
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                {t.grandTotals}
              </span>
              <span className="text-slate-600">
                {t.totalRecords}: <strong>{grandTotals.totalRecords}</strong>
              </span>
              <span className="text-slate-600">
                {t.totalDebits}: <strong>{formatAmount(grandTotals.totalDebits)}</strong>
              </span>
              <span className="text-slate-600">
                {t.totalCredits}: <strong>{formatAmount(grandTotals.totalCredits)}</strong>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CostCenterBalancePage;
