import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import { formatGeneratedAt } from "../../utils/reportExport";

// NEW (2026-09-24): "Estado de Cuenta por Tercero", built right after
// CostCenterBalancePage using the exact same Auxiliar-style shape (Saldo
// Inicial + movimientos + Nuevo Saldo), grouped by third party instead
// of cost center, plus an optional cost center filter (per the same
// reference report the user showed for the Cost Center version). A
// third party's transactions can span several accounts AND several cost
// centers, so each row shows its own account and cost center instead of
// the group carrying a single fixed one.
// Export to Excel/PDF deliberately left out, same as Cost Center Balance.
function ThirdPartyBalancePage({ language = "es" }) {
  const [accounts, setAccounts] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [filters, setFilters] = useState({
    startDate: firstOfMonth,
    endDate: today,
    accountId: "", // "" = todas las cuentas
    thirdPartyId: "", // "" = todos los terceros
    costCenterId: "", // "" = todos los centros de costo
  });

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hideEmptyGroups, setHideEmptyGroups] = useState(false);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Estado de Cuenta por Tercero",
      subtitle: "Saldo inicial, movimientos y saldo corriente por tercero",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      account: "Cuenta",
      allAccounts: "— Todas las cuentas —",
      thirdParty: "Tercero",
      allThirdParties: "— Todos los terceros —",
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
      costCenterCol: "Centro de Costo",
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
      hideEmpty: "Ocultar terceros sin movimiento (S.I., movimientos y saldo final en cero)",
      allHidden: "Todos los terceros tienen saldo inicial, movimientos y saldo final en cero (ocultos por el filtro).",
    },
    en: {
      title: "Third Party Statement",
      subtitle: "Opening balance, movements and running balance per third party",
      startDate: "Start Date",
      endDate: "End Date",
      account: "Account",
      allAccounts: "— All accounts —",
      thirdParty: "Third Party",
      allThirdParties: "— All third parties —",
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
      costCenterCol: "Cost Center",
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
      hideEmpty: "Hide third parties with no activity (opening, movements and closing balance all zero)",
      allHidden: "Every third party has zero opening balance, movements and closing balance (hidden by the filter).",
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
      const [accRes, tpRes, ccRes] = await Promise.allSettled([
        api.get("/v1/chart-of-accounts", { params: { size: 500, sort: "code" } }),
        api.get("/v1/third-parties?page=0&size=1000"),
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

      if (tpRes.status === "fulfilled") {
        // ThirdPartyController#list returns the Spring Page<> directly,
        // not wrapped in the usual ApiResponse envelope -- same fallback
        // chain JournalEntryPage.jsx already uses for this endpoint.
        const raw = tpRes.value.data;
        const list = Array.isArray(raw?.content)
          ? raw.content
          : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw)
          ? raw
          : [];
        setThirdParties(list.filter((tp) => tp.active));
      }

      if (ccRes.status === "fulfilled" && ccRes.value.data?.success) {
        const payloadData = ccRes.value.data.data;
        const list = Array.isArray(payloadData)
          ? payloadData
          : Array.isArray(payloadData?.content)
            ? payloadData.content
            : [];
        // Only cost centers that can actually receive movements show up
        // in journal entries -- same reasoning as CostCenterBalancePage.
        setCostCenters(list.filter((cc) => cc.allowsMovement));
      }
    } catch (error) {
      console.error("Failed to load filters for third party statement", error);
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
    const selectedThirdParty = filters.thirdPartyId
      ? thirdParties.find((tp) => String(tp.id) === String(filters.thirdPartyId))
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
    if (selectedThirdParty) {
      params.thirdPartyDocument = selectedThirdParty.documentNumber;
    }
    if (selectedCostCenter) {
      params.costCenterCode = selectedCostCenter.code;
    }

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/third-party-balance", { params });
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

  // Groups where opening balance, movements and closing balance are all
  // zero are real (e.g. a third party that only had activity outside
  // this date range), but usually not worth showing in a report that
  // already covers "todos los terceros" -- this lets the user opt into
  // hiding them instead of always doing it server-side.
  const visibleGroups = useMemo(() => {
    const groups = report?.thirdPartyGroups || [];
    if (!hideEmptyGroups) return groups;
    return groups.filter((g) => {
      const si = Number(g.openingBalance) || 0;
      const td = Number(g.totalDebits) || 0;
      const tc = Number(g.totalCredits) || 0;
      const ns = Number(g.closingBalance) || 0;
      return !(si === 0 && td === 0 && tc === 0 && ns === 0);
    });
  }, [report, hideEmptyGroups]);

  const grandTotals = useMemo(() => {
    if (visibleGroups.length < 2) return null;
    return visibleGroups.reduce(
      (acc, g) => ({
        totalDebits: acc.totalDebits + Number(g.totalDebits || 0),
        totalCredits: acc.totalCredits + Number(g.totalCredits || 0),
        totalRecords: acc.totalRecords + Number(g.totalRecords || 0),
      }),
      { totalDebits: 0, totalCredits: 0, totalRecords: 0 }
    );
  }, [visibleGroups]);

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

        <div className="flex min-w-[260px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.thirdParty}
          </label>
          <select
            name="thirdPartyId"
            value={filters.thirdPartyId}
            onChange={handleFilterChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allThirdParties}</option>
            {thirdParties.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.documentNumber} — {tp.legalDisplayName}
              </option>
            ))}
          </select>
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

        <label className="flex items-center gap-2 pb-2 text-xs font-medium text-slate-500">
          <input
            type="checkbox"
            checked={hideEmptyGroups}
            onChange={(e) => setHideEmptyGroups(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          {t.hideEmpty}
        </label>

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

          {(!report.thirdPartyGroups || report.thirdPartyGroups.length === 0) && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {report.thirdPartyGroups?.length > 0 && visibleGroups.length === 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.allHidden}
            </div>
          )}

          {visibleGroups.map((group) => (
            <div
              key={group.thirdPartyDocument}
              className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-slate-50 px-5 py-4">
                <div>
                  <span className="font-bold text-slate-700">{group.thirdPartyDocument}</span>{" "}
                  <span className="text-slate-600">{group.thirdPartyName}</span>
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
                      <th className="px-4 py-3">{t.costCenterCol}</th>
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
                        <td className="px-4 py-2.5 text-slate-500">{tx.costCenterCode || "—"}</td>
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

export default ThirdPartyBalancePage;
