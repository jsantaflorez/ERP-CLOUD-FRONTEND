import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

// A brand-new line starts with both amounts empty -- the user picks either
// a debit or a credit, never both (mirrors JournalEntryService's own rule).
const emptyItem = () => ({
  accountId: "",
  thirdPartyId: "",
  costCenterId: "",
  debit: "",
  credit: "",
  description: "",
});

const emptyForm = () => ({
  entryDate: new Date().toISOString().slice(0, 10),
  documentTypeId: "",
  description: "",
  items: [emptyItem(), emptyItem()],
});

// Parses a form amount field into a number for balance math -- blank or
// invalid input counts as 0 rather than NaN, so the running total stays
// usable while the user is still typing.
const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const money = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function JournalEntryPage({ language = "es" }) {
  const [view, setView] = useState("list"); // "list" | "form"

  // List/search state
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [viewingEntry, setViewingEntry] = useState(null);

  // Catalogs for the line-item pickers
  const [accounts, setAccounts] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);

  // Form state
  const [form, setForm] = useState(emptyForm());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Asientos Contables",
      subtitle: "Captura y Consulta de Movimientos Contables",
      newEntry: "+ Nuevo Asiento",
      backToList: "← Volver al listado",
      search: "Buscar por número de documento o descripción...",
      from: "Desde", to: "Hasta",
      searchButton: "Buscar",
      docNumber: "N° Documento", date: "Fecha", description: "Descripción",
      totalDebit: "Total Débito", totalCredit: "Total Crédito", status: "Estado",
      annulled: "Anulado", active: "Activo", view: "Ver",
      noResults: "No hay asientos registrados",
      loading: "Cargando asientos...",
      page: "Página", of: "de", prev: "Anterior", next: "Siguiente",
      entryDate: "Fecha del Asiento", documentType: "Tipo de Documento",
      selectDocumentType: "Seleccione un tipo de documento",
      generalDescription: "Descripción General",
      items: "Líneas del Asiento", addLine: "+ Agregar línea",
      removeLine: "Quitar",
      account: "Cuenta", selectAccount: "Seleccione una cuenta",
      thirdParty: "Tercero", selectThirdParty: "Seleccione un tercero",
      costCenter: "Centro de Costo", selectCostCenter: "Seleccione un centro de costo",
      debit: "Débito", credit: "Crédito", lineDescription: "Descripción (opcional)",
      totalDebitLabel: "Total Débitos:", totalCreditLabel: "Total Créditos:",
      difference: "Diferencia:", balanced: "Balanceado", unbalanced: "Descuadrado",
      save: "Guardar Asiento", cancel: "Cancelar", saving: "Guardando...",
      loadingCatalogs: "Cargando catálogos...",
      errorConn: "Error de conexión con el servidor.",
      successCreate: "¡Asiento contable creado!",
      required: "Obligatorio",
      itemRequiresThirdParty: "Esta cuenta requiere un tercero",
      itemRequiresCostCenter: "Esta cuenta requiere un centro de costo",
      itemNeedsOneAmount: "Cada línea debe tener débito O crédito, no ambos ni ninguno",
      needAtLeastOneAccount: "Seleccione una cuenta en cada línea",
      unbalancedError: "El asiento no está balanceado. Los débitos deben ser iguales a los créditos.",
      detailTitle: "Detalle del Asiento",
      close: "Cerrar",
      noThirdParty: "— Sin tercero —", noCostCenter: "— Sin centro de costo —",
      documentTypeHint: "Próximo número",
    },
    en: {
      title: "Journal Entries",
      subtitle: "Capture and Query Accounting Movements",
      newEntry: "+ New Entry",
      backToList: "← Back to list",
      search: "Search by document number or description...",
      from: "From", to: "To",
      searchButton: "Search",
      docNumber: "Doc. Number", date: "Date", description: "Description",
      totalDebit: "Total Debit", totalCredit: "Total Credit", status: "Status",
      annulled: "Annulled", active: "Active", view: "View",
      noResults: "No journal entries yet",
      loading: "Loading entries...",
      page: "Page", of: "of", prev: "Previous", next: "Next",
      entryDate: "Entry Date", documentType: "Document Type",
      selectDocumentType: "Select a document type",
      generalDescription: "General Description",
      items: "Entry Lines", addLine: "+ Add line",
      removeLine: "Remove",
      account: "Account", selectAccount: "Select an account",
      thirdParty: "Third Party", selectThirdParty: "Select a third party",
      costCenter: "Cost Center", selectCostCenter: "Select a cost center",
      debit: "Debit", credit: "Credit", lineDescription: "Description (optional)",
      totalDebitLabel: "Total Debits:", totalCreditLabel: "Total Credits:",
      difference: "Difference:", balanced: "Balanced", unbalanced: "Unbalanced",
      save: "Save Entry", cancel: "Cancel", saving: "Saving...",
      loadingCatalogs: "Loading catalogs...",
      errorConn: "Server connection error.",
      successCreate: "Journal entry created!",
      required: "Required",
      itemRequiresThirdParty: "This account requires a third party",
      itemRequiresCostCenter: "This account requires a cost center",
      itemNeedsOneAmount: "Each line must have a debit OR a credit, not both or neither",
      needAtLeastOneAccount: "Select an account on every line",
      unbalancedError: "The entry is unbalanced. Debits must equal credits.",
      detailTitle: "Entry Detail",
      close: "Close",
      noThirdParty: "— No third party —", noCostCenter: "— No cost center —",
      documentTypeHint: "Next number",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ============================================================
  // Data loading
  // ============================================================

  const loadEntries = async (page = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.set("searchTerm", searchTerm.trim());
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("page", String(page));
      params.set("size", "10");
      params.set("sort", "entryDate,desc");

      const response = await api.get(`/v1/journal-entries?${params.toString()}`);
      const pageData = response.data?.data;
      setEntries(Array.isArray(pageData?.content) ? pageData.content : []);
      setTotalPages(pageData?.totalPages ?? 1);
      setCurrentPage(pageData?.number ?? 0);
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoading(false);
    }
  };

  const loadCatalogs = async () => {
    setLoadingCatalogs(true);
    try {
      const [accRes, tpRes, ccRes, dtRes] = await Promise.allSettled([
        // /v1/chart-of-accounts is paginated (Spring PageImpl), same as
        // /v1/third-parties -- unlike /v1/cost-centers and
        // /v1/document-types, which return flat arrays. Mirrors the
        // Array.isArray(...) / .content fallback TaxPage and
        // ChartOfAccountPage already use for this same endpoint, with a
        // large page size so the picker sees the whole chart, not just
        // the default first page.
        api.get("/v1/chart-of-accounts", { params: { size: 1000, sort: "code" } }),
        api.get("/v1/third-parties?page=0&size=1000"),
        api.get("/v1/cost-centers"),
        api.get("/v1/document-types"),
      ]);

      if (accRes.status === "fulfilled") {
        const raw = accRes.value.data?.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.content) ? raw.content : [];
        setAccounts(list);
      }
      if (tpRes.status === "fulfilled") {
        // ThirdPartyController#list is the one endpoint that returns the
        // Spring Page<> directly, not wrapped in the usual ApiResponse
        // {success, message, data} envelope every other endpoint here
        // uses -- so response.data.content, not response.data.data.content.
        // Mirrors the same fallback chain ThirdPartyPage.jsx already uses.
        const raw = tpRes.value.data;
        const list = Array.isArray(raw?.content)
          ? raw.content
          : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw)
          ? raw
          : [];
        setThirdParties(list);
      }
      if (ccRes.status === "fulfilled") {
        const data = ccRes.value.data?.data ?? ccRes.value.data;
        setCostCenters(Array.isArray(data) ? data : []);
      }
      if (dtRes.status === "fulfilled") {
        const data = dtRes.value.data?.data ?? dtRes.value.data;
        setDocumentTypes(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoadingCatalogs(false);
    }
  };

  useEffect(() => {
    loadEntries(0);
    loadCatalogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only accounts eligible for posting are offered -- the backend rejects
  // inactive or non-posting (summary) accounts anyway, so filtering here
  // spares the user a doomed submit.
  const postableAccounts = useMemo(
    () => accounts.filter((a) => a.active && a.postingAccount),
    [accounts]
  );
  const activeThirdParties = useMemo(() => thirdParties.filter((tp) => tp.active), [thirdParties]);
  // Only leaf-level cost centers that allow movement can receive postings --
  // a parent center (allowsMovement=false, enforced by CostCenterService)
  // is a grouping node, not a valid target for a journal entry line.
  const activeCostCenters = useMemo(
    () => costCenters.filter((c) => c.active && c.allowsMovement),
    [costCenters]
  );
  const activeDocumentTypes = useMemo(() => documentTypes.filter((d) => d.active), [documentTypes]);

  const accountById = (id) => accounts.find((a) => String(a.id) === String(id));

  // ============================================================
  // Form handling
  // ============================================================

  const openNewEntry = () => {
    setForm(emptyForm());
    setErrors({});
    setView("form");
  };

  const backToList = () => {
    setView("list");
    setForm(emptyForm());
    setErrors({});
  };

  const handleHeaderChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    setForm((prev) => {
      const items = [...prev.items];
      const item = { ...items[index], [field]: value };

      // Debit and credit are mutually exclusive on a single line -- typing
      // in one clears the other, matching the backend's own rule instead
      // of letting the user discover the conflict only after submitting.
      if (field === "debit" && value !== "") item.credit = "";
      if (field === "credit" && value !== "") item.debit = "";

      // Changing the account resets third party/cost center -- the new
      // account may not require them, and a stale selection from the
      // previous account shouldn't silently ride along.
      if (field === "accountId") {
        item.thirdPartyId = "";
        item.costCenterId = "";
      }

      items[index] = item;
      return { ...prev, items };
    });
  };

  const addLine = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  };

  const removeLine = (index) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : prev.items,
    }));
  };

  const totals = useMemo(() => {
    const totalDebit = form.items.reduce((sum, i) => sum + toNumber(i.debit), 0);
    const totalCredit = form.items.reduce((sum, i) => sum + toNumber(i.credit), 0);
    const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
    return { totalDebit, totalCredit, difference, isBalanced: difference === 0 };
  }, [form.items]);

  const validate = () => {
    const errs = {};
    if (!form.entryDate) errs.entryDate = t.required;
    if (!form.documentTypeId) errs.documentTypeId = t.required;

    const itemErrors = form.items.map((item) => {
      const lineErrs = {};
      if (!item.accountId) {
        lineErrs.accountId = t.required;
      } else {
        const acc = accountById(item.accountId);
        const hasDebit = toNumber(item.debit) > 0;
        const hasCredit = toNumber(item.credit) > 0;
        if (hasDebit === hasCredit) lineErrs.amount = t.itemNeedsOneAmount;
        if (acc?.requiresThirdParty && !item.thirdPartyId) lineErrs.thirdPartyId = t.itemRequiresThirdParty;
        if (acc?.requiresCostCenter && !item.costCenterId) lineErrs.costCenterId = t.itemRequiresCostCenter;
      }
      return lineErrs;
    });
    if (itemErrors.some((e) => Object.keys(e).length > 0)) errs.items = itemErrors;

    if (!totals.isBalanced) errs.balance = t.unbalancedError;

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const payload = {
      entryDate: form.entryDate,
      documentTypeId: Number(form.documentTypeId),
      description: form.description.trim() || null,
      items: form.items.map((item) => ({
        accountId: Number(item.accountId),
        thirdPartyId: item.thirdPartyId ? Number(item.thirdPartyId) : null,
        costCenterId: item.costCenterId ? Number(item.costCenterId) : null,
        debit: toNumber(item.debit),
        credit: toNumber(item.credit),
        description: item.description?.trim() || null,
      })),
    };

    setSaving(true);
    try {
      const response = await api.post("/v1/journal-entries", payload);
      if (response.data?.success) {
        showToast(t.successCreate);
        backToList();
        loadEntries(0);
      } else {
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="space-y-6 p-4">
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${
            toast.type === "error" ? "bg-red-500" : "bg-emerald-500"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <AppHeader
        title={t.title}
        subtitle={t.subtitle}
        tenantId={activeTenantId}
        actions={
          view === "list" ? (
            <Button variant="primary" onClick={openNewEntry}>{t.newEntry}</Button>
          ) : (
            <Button variant="secondary" onClick={backToList}>{t.backToList}</Button>
          )
        }
      />

      {view === "list" ? (
        <JeListView
          t={t}
          entries={entries}
          loading={loading}
          searchTerm={searchTerm} setSearchTerm={setSearchTerm}
          startDate={startDate} setStartDate={setStartDate}
          endDate={endDate} setEndDate={setEndDate}
          onSearch={() => loadEntries(0)}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={(p) => loadEntries(p)}
          onViewEntry={setViewingEntry}
        />
      ) : (
        <JeFormView
          t={t}
          form={form}
          errors={errors}
          saving={saving}
          loadingCatalogs={loadingCatalogs}
          documentTypes={activeDocumentTypes}
          postableAccounts={postableAccounts}
          activeThirdParties={activeThirdParties}
          activeCostCenters={activeCostCenters}
          accountById={accountById}
          totals={totals}
          onHeaderChange={handleHeaderChange}
          onItemChange={handleItemChange}
          onAddLine={addLine}
          onRemoveLine={removeLine}
          onSubmit={handleSave}
          onCancel={backToList}
        />
      )}

      {viewingEntry && (
        <JeDetailModal t={t} entry={viewingEntry} onClose={() => setViewingEntry(null)} />
      )}
    </div>
  );
}

// ============================================================
// List / search view
// ============================================================

function JeListView({
  t, entries, loading,
  searchTerm, setSearchTerm, startDate, setStartDate, endDate, setEndDate, onSearch,
  currentPage, totalPages, onPageChange, onViewEntry,
}) {
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder={t.search}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none shadow-sm focus:border-blue-500 transition-all"
          />
        </div>
        <div className="flex gap-2">
          <label className="flex flex-col text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.from}
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="flex flex-col text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.to}
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </label>
          <Button variant="primary" onClick={onSearch} className="self-end">{t.searchButton}</Button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">{t.loading}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {[t.docNumber, t.date, t.description, t.totalDebit, t.totalCredit, t.status, ""].map((h) => (
                  <th key={h} className="px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-slate-400">{t.noResults}</td></tr>
              ) : (
                entries.map((entry) => {
                  const totalDebit = (entry.items || []).reduce((s, i) => s + (i.debit || 0), 0);
                  const totalCredit = (entry.items || []).reduce((s, i) => s + (i.credit || 0), 0);
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-4 font-bold text-slate-700">{entry.documentNumber}</td>
                      <td className="px-5 py-4 text-slate-600">{entry.entryDate}</td>
                      <td className="px-5 py-4 text-slate-600">{entry.description}</td>
                      <td className="px-5 py-4 text-right text-slate-600">{money(totalDebit)}</td>
                      <td className="px-5 py-4 text-right text-slate-600">{money(totalCredit)}</td>
                      <td className="px-5 py-4">
                        {entry.annulled ? (
                          <span className="rounded-full bg-red-100 px-3 py-1 text-[10px] font-bold uppercase text-red-700">
                            {t.annulled}
                          </span>
                        ) : (
                          <span className="rounded-full bg-green-100 px-3 py-1 text-[10px] font-bold uppercase text-green-700">
                            {t.active}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Button variant="ghost" size="sm" onClick={() => onViewEntry(entry)}>{t.view}</Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 text-sm text-slate-500">
          <Button variant="secondary" size="sm" disabled={currentPage <= 0}
            onClick={() => onPageChange(currentPage - 1)}>{t.prev}</Button>
          <span>{t.page} {currentPage + 1} {t.of} {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={currentPage >= totalPages - 1}
            onClick={() => onPageChange(currentPage + 1)}>{t.next}</Button>
        </div>
      )}
    </>
  );
}

// ============================================================
// Create form view
// ============================================================

function JeFormView({
  t, form, errors, saving, loadingCatalogs,
  documentTypes, postableAccounts, activeThirdParties, activeCostCenters, accountById,
  totals, onHeaderChange, onItemChange, onAddLine, onRemoveLine, onSubmit, onCancel,
}) {
  const selectedDocType = documentTypes.find((d) => String(d.id) === String(form.documentTypeId));

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <JeField label={t.entryDate} error={errors.entryDate}>
            <input type="date" name="entryDate" value={form.entryDate} onChange={onHeaderChange}
              className={jeInputCls(errors.entryDate)} />
          </JeField>

          <JeField label={t.documentType} error={errors.documentTypeId}>
            <select name="documentTypeId" value={form.documentTypeId} onChange={onHeaderChange}
              className={jeInputCls(errors.documentTypeId)} disabled={loadingCatalogs}>
              <option value="">{loadingCatalogs ? t.loadingCatalogs : t.selectDocumentType}</option>
              {documentTypes.map((d) => (
                <option key={d.id} value={d.id}>{d.code} - {d.name}</option>
              ))}
            </select>
            {selectedDocType && (
              <span className="text-[11px] text-slate-400">
                {t.documentTypeHint}: {selectedDocType.nextNumberPreview}
              </span>
            )}
          </JeField>

          <JeField label={t.generalDescription}>
            <input type="text" name="description" value={form.description} onChange={onHeaderChange}
              className={jeInputCls()} maxLength={255} />
          </JeField>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">{t.items}</h3>
          <Button type="button" variant="secondary" size="sm" onClick={onAddLine}>{t.addLine}</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2 min-w-[220px]">{t.account}</th>
                <th className="px-3 py-2 min-w-[180px]">{t.thirdParty}</th>
                <th className="px-3 py-2 min-w-[180px]">{t.costCenter}</th>
                <th className="px-3 py-2 w-32">{t.debit}</th>
                <th className="px-3 py-2 w-32">{t.credit}</th>
                <th className="px-3 py-2 min-w-[160px]">{t.lineDescription}</th>
                <th className="px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {form.items.map((item, index) => {
                const acc = accountById(item.accountId);
                const lineErr = errors.items?.[index] || {};
                return (
                  <tr key={index}>
                    <td className="px-3 py-2 align-top">
                      <select value={item.accountId}
                        onChange={(e) => onItemChange(index, "accountId", e.target.value)}
                        className={jeInputCls(lineErr.accountId)}>
                        <option value="">{t.selectAccount}</option>
                        {postableAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                        ))}
                      </select>
                      {lineErr.accountId && <p className="text-[10px] text-red-500 mt-1">{lineErr.accountId}</p>}
                      {lineErr.amount && <p className="text-[10px] text-red-500 mt-1">{lineErr.amount}</p>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {acc?.requiresThirdParty ? (
                        <>
                          <select value={item.thirdPartyId}
                            onChange={(e) => onItemChange(index, "thirdPartyId", e.target.value)}
                            className={jeInputCls(lineErr.thirdPartyId)}>
                            <option value="">{t.selectThirdParty}</option>
                            {activeThirdParties.map((tp) => (
                              <option key={tp.id} value={tp.id}>{tp.documentNumber} - {tp.legalDisplayName}</option>
                            ))}
                          </select>
                          {lineErr.thirdPartyId && <p className="text-[10px] text-red-500 mt-1">{lineErr.thirdPartyId}</p>}
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-300">{t.noThirdParty}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {acc?.requiresCostCenter ? (
                        <>
                          <select value={item.costCenterId}
                            onChange={(e) => onItemChange(index, "costCenterId", e.target.value)}
                            className={jeInputCls(lineErr.costCenterId)}>
                            <option value="">{t.selectCostCenter}</option>
                            {activeCostCenters.map((c) => (
                              <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                            ))}
                          </select>
                          {lineErr.costCenterId && <p className="text-[10px] text-red-500 mt-1">{lineErr.costCenterId}</p>}
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-300">{t.noCostCenter}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="number" min="0" step="0.01" value={item.debit}
                        onChange={(e) => onItemChange(index, "debit", e.target.value)}
                        disabled={toNumber(item.credit) > 0}
                        className={jeInputCls()} placeholder="0.00" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="number" min="0" step="0.01" value={item.credit}
                        onChange={(e) => onItemChange(index, "credit", e.target.value)}
                        disabled={toNumber(item.debit) > 0}
                        className={jeInputCls()} placeholder="0.00" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="text" value={item.description}
                        onChange={(e) => onItemChange(index, "description", e.target.value)}
                        className={jeInputCls()} maxLength={255} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <button type="button" onClick={() => onRemoveLine(index)}
                        className="text-slate-300 hover:text-red-500 text-lg leading-none"
                        disabled={form.items.length <= 1}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={`flex flex-wrap items-center justify-end gap-6 rounded-xl px-5 py-3 text-sm font-semibold ${
          totals.isBalanced ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        }`}>
          <span>{t.totalDebitLabel} {money(totals.totalDebit)}</span>
          <span>{t.totalCreditLabel} {money(totals.totalCredit)}</span>
          <span>{t.difference} {money(totals.difference)}</span>
          <span className="uppercase tracking-wider">{totals.isBalanced ? t.balanced : t.unbalanced}</span>
        </div>
        {errors.balance && <p className="text-xs text-red-500 text-right">{errors.balance}</p>}
      </div>

      <div className="flex gap-3">
        <Button type="submit" variant="primary" size="lg" loading={saving}>
          {saving ? t.saving : t.save}
        </Button>
        <Button type="button" variant="secondary" size="lg" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  );
}

// ============================================================
// Read-only detail modal
// ============================================================

function JeDetailModal({ t, entry, onClose }) {
  const totalDebit = (entry.items || []).reduce((s, i) => s + (i.debit || 0), 0);
  const totalCredit = (entry.items || []).reduce((s, i) => s + (i.credit || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-800">{t.detailTitle} — {entry.documentNumber}</h2>
            <p className="text-sm text-slate-500">{entry.entryDate} · {entry.description}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <div className="px-8 py-6">
          {entry.annulled && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <b>{t.annulled}</b>{entry.annulmentReason ? `: ${entry.annulmentReason}` : ""}
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2">{t.account}</th>
                <th className="px-3 py-2">{t.thirdParty}</th>
                <th className="px-3 py-2">{t.costCenter}</th>
                <th className="px-3 py-2 text-right">{t.debit}</th>
                <th className="px-3 py-2 text-right">{t.credit}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(entry.items || []).map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 text-slate-700">{item.accountCode} - {item.accountName}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{item.thirdPartyName || "—"}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{item.costCenterName || "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{money(item.debit)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{money(item.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-bold text-slate-700">
                <td className="px-3 py-2" colSpan={3}>Total</td>
                <td className="px-3 py-2 text-right">{money(totalDebit)}</td>
                <td className="px-3 py-2 text-right">{money(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="px-8 pb-6">
          <Button variant="secondary" onClick={onClose}>{t.close}</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Local helpers
// ============================================================

const jeInputCls = (err) =>
  `w-full rounded-lg border ${err ? "border-red-400" : "border-gray-200"} px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors bg-white`;

function JeField({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

export default JournalEntryPage;
