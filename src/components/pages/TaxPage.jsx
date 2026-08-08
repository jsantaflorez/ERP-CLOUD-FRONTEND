import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api"; // Centralized Axios instance with multi-tenancy context
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

const initialForm = {
  code: "",
  name: "",
  type: "",
  rate: "0",
  requiresBase: true,
  minimumBase: "0",
  sign: "D",
  accountId: "",
  active: true,
};

function TaxPage({ language = "es" }) {
  const [rows, setRows]                   = useState([]);
  const [accounts, setAccounts]           = useState([]);
  const [form, setForm]                   = useState(initialForm);
  const [errors, setErrors]               = useState({});
  const [open, setOpen]                   = useState(false);
  const [editingId, setEditingId]         = useState(null);
  const [searchTerm, setSearchTerm]       = useState("");
  const [loading, setLoading]             = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [toast, setToast]                 = useState(null);

  // Reference pointer to guarantee consistent identity states during transactional operations
  const editingIdRef = useRef(null);

  // Resolve active multi-tenant identifier from AuthContext (reactive —
  // updates automatically if switchCompany() runs), instead of reading
  // localStorage directly, which wouldn't trigger a re-render.
  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Impuestos",
      subtitle: "Definición y Configuración de Reglas Fiscales",
      new: "Nuevo",
      edit: "Editar",
      save: "Guardar",
      update: "Actualizar",
      cancel: "Cancelar",
      search: "Buscar por código, nombre o tipo...",
      code: "Código",
      name: "Nombre",
      type: "Tipo",
      rate: "Tarifa",
      requiresBase: "Requiere Base",
      noRequiresBase: "Sin Base",
      minimumBase: "Base Mínima",
      sign: "Signo",
      debit: "Débito",
      credit: "Crédito",
      account: "Cuenta Contable",
      active: "Activo",
      inactive: "Inactivo",
      actions: "Acciones",
      required: "Campo obligatorio",
      invalidNumber: "Valor inválido",
      deactivate: "Desactivar",
      activate: "Activar",
      noResults: "Sin registros",
      loading: "Cargando registros...",
      selectAccount: "Seleccione una cuenta...",
      confirmDeactivate: "¿Desactivar este impuesto?",
      confirmActivate: "¿Activar este impuesto?",
      successCreate: "¡Impuesto creado!",
      successUpdate: "¡Actualizado correctamente!",
      successDeactivate: "Impuesto desactivado.",
      successActivate: "Impuesto activado.",
      errorConn: "Error de conexión con el servidor.",
      accountLoadError: "No fue posible cargar las cuentas contables.",
      loadingAccounts: "Cargando cuentas...",
    },
    en: {
      title: "Taxes",
      subtitle: "Tax Configuration and Fiscal Rules",
      new: "New",
      edit: "Edit",
      save: "Save",
      update: "Update",
      cancel: "Cancel",
      search: "Search by code, name or type...",
      code: "Code",
      name: "Name",
      type: "Type",
      rate: "Rate",
      requiresBase: "Requires Base",
      noRequiresBase: "No Base",
      minimumBase: "Minimum Base",
      sign: "Sign",
      debit: "Debit",
      credit: "Credit",
      account: "Account",
      active: "Active",
      inactive: "Inactive",
      actions: "Actions",
      required: "Required field",
      invalidNumber: "Invalid value",
      deactivate: "Deactivate",
      activate: "Activate",
      noResults: "No records",
      loading: "Loading records...",
      selectAccount: "Select an account...",
      confirmDeactivate: "Deactivate this tax?",
      confirmActivate: "Activate this tax?",
      successCreate: "Tax created!",
      successUpdate: "Updated successfully!",
      successDeactivate: "Tax deactivated.",
      successActivate: "Tax activated.",
      errorConn: "Server connection error.",
      accountLoadError: "Could not load chart of accounts.",
      loadingAccounts: "Loading accounts...",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  /**
   * Fetches full collection of operational tax configurations from the system ledger.
   */
  const loadTaxes = async () => {
    setLoading(true);
    try {
      const response = await api.get("/v1/taxes");
      if (response.data && response.data.success) {
        setRows(Array.isArray(response.data.data) ? response.data.data : []);
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Fetches ledger accounts to map relations between tax rules and financial structures.
   */
  const loadAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const response = await api.get("/v1/chart-of-accounts");
      if (response.data && response.data.success) {
        const payloadData = response.data.data;
        // Normalizes both flat arrays and standard Spring PageImpl structures
        const accountsList = Array.isArray(payloadData)
          ? payloadData
          : (Array.isArray(payloadData?.content) ? payloadData.content : []);
        setAccounts(accountsList);
      } else {
        showToast(response.data?.message || t.accountLoadError, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.accountLoadError), "error");
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    loadTaxes();
    loadAccounts();
  }, []);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.code?.toLowerCase().includes(term) ||
        r.name?.toLowerCase().includes(term) ||
        r.type?.toLowerCase().includes(term) ||
        r.accountCode?.toLowerCase().includes(term) ||
        r.accountName?.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  const resetForm = () => {
    setForm(initialForm);
    setErrors({});
    setEditingId(null);
    editingIdRef.current = null;
  };

  const openCreatePanel = () => {
    resetForm();
    setOpen(true);
  };

  const openEditPanel = (item) => {
    setForm({
      code:         item.code || "",
      name:         item.name || "",
      type:         item.type || "",
      // FIX: rate/minimumBase are kept as strings in form state (see
      // handleChange below) so the user can type decimals like "0.966"
      // without React normalizing the trailing "." away on every
      // keystroke. Coerce whatever the backend sends into a string here.
      rate:         item.rate != null ? String(item.rate) : "0",
      requiresBase: item.requiresBase ?? true,
      minimumBase:  item.minimumBase != null ? String(item.minimumBase) : "0",
      sign:         item.sign || "D",
      accountId:    item.accountId != null ? String(item.accountId) : "",
      active:       item.active ?? true,
    });
    setErrors({});
    setEditingId(item.id);
    editingIdRef.current = item.id;
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
    resetForm();
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;

    if (name === "code") val = value.toUpperCase().slice(0, 10);
    if (name === "name") val = value.slice(0, 100);
    if (name === "type") val = value.toUpperCase().slice(0, 20);

    // FIX: previously these coerced to Number() and clamped with Math.max
    // on every keystroke. That meant typing a trailing decimal point
    // (e.g. "19." while aiming for "19.5") got silently stripped back to
    // "19" on the next render, since Number("19.") === 19 — making it
    // effectively impossible to type a fractional rate like Colombia's
    // ICA (often ~0.966%). Now we keep the raw string while typing and
    // only parse/clamp to a real number at validate()/submit time.
    // (rate/minimumBase intentionally NOT special-cased here anymore —
    // native <input type="number"> already restricts to numeric input.)

    setForm((prev) => ({ ...prev, [name]: val }));
  };

  const validate = () => {
    const errs = {};
    if (!form.code?.trim()) errs.code = t.required;
    if (!form.name?.trim()) errs.name = t.required;
    if (!form.type?.trim()) errs.type = t.required;

    // FIX: added explicit isNaN checks. Once rate/minimumBase stopped being
    // eagerly clamped in handleChange, a non-numeric or empty string would
    // make Number(form.rate) evaluate to NaN, and `NaN < 0` is false — so
    // invalid values used to slip through validation silently.
    const rateNum = Number(form.rate);
    if (form.rate === "" || isNaN(rateNum) || rateNum < 0) errs.rate = t.invalidNumber;

    const minBaseNum = Number(form.minimumBase);
    if (form.minimumBase === "" || isNaN(minBaseNum) || minBaseNum < 0) errs.minimumBase = t.invalidNumber;

    if (!form.sign?.trim()) errs.sign = t.required;
    if (!form.accountId?.toString().trim()) errs.accountId = t.required;

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /**
   * Submits database persistence requests for structural Tax nodes.
   */
  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const payload = {
      code:         form.code.trim(),
      name:         form.name.trim(),
      type:         form.type.trim(),
      rate:         Number(form.rate) || 0,
      requiresBase: Boolean(form.requiresBase),
      minimumBase:  Number(form.minimumBase) || 0,
      sign:         form.sign,
      accountId:    Number(form.accountId),
      active:       Boolean(form.active),
    };

    const currentId = editingIdRef.current;
    try {
      let response;
      if (currentId) {
        response = await api.put(`/v1/taxes/${currentId}`, payload);
      } else {
        response = await api.post("/v1/taxes", payload);
      }

      if (response.data && response.data.success) {
        showToast(currentId ? t.successUpdate : t.successCreate);
        closePanel();
        loadTaxes();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * Alters status definitions inside the ledger database through standard PATCH verbs.
   */
  const handleDeactivate = async (id) => {
    if (!window.confirm(t.confirmDeactivate)) return;
    try {
      const response = await api.patch(`/v1/taxes/${id}/deactivate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successDeactivate);
        loadTaxes();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * Reinstate operational capabilities for specified components.
   */
  const handleActivate = async (id) => {
    if (!window.confirm(t.confirmActivate)) return;
    try {
      const response = await api.patch(`/v1/taxes/${id}/activate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successActivate);
        loadTaxes();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  return (
    <div className="space-y-6 p-4">
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl transition-all ${
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
          <Button variant="primary" onClick={openCreatePanel}>
            + {t.new}
          </Button>
        }
      />

      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={t.search}
        className="w-full md:max-w-md rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none shadow-sm focus:border-blue-500 transition-all"
      />

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            {t.loading}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {[t.code, t.name, t.type, t.rate, t.minimumBase, t.sign, t.account, t.active, t.requiresBase, t.actions].map((h) => (
                  <th key={h} className="px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400">
                    {t.noResults}
                  </td>
                </tr>
              ) : (
                filteredRows.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-4 font-bold text-slate-700">{item.code}</td>
                    <td className="px-5 py-4 text-slate-600">{item.name}</td>
                    <td className="px-5 py-4 text-slate-500">{item.type}</td>
                    <td className="px-5 py-4 font-mono text-blue-600">{item.rate}</td>
                    <td className="px-5 py-4 font-mono text-slate-500">{item.minimumBase}</td>
                    <td className="px-5 py-4">
                      <Badge
                        active={item.sign === "D"}
                        labelOn={t.debit}
                        labelOff={t.credit}
                        colorOn="blue"
                      />
                    </td>
                    <td className="px-5 py-4 text-slate-500">
                      {item.accountCode?.trim()
                        ? `${item.accountCode} - ${item.accountName || ""}`
                        : item.accountId ?? "—"}
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        active={item.active}
                        labelOn={t.active}
                        labelOff={t.inactive}
                        colorOn="green"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        active={item.requiresBase}
                        labelOn={t.requiresBase}
                        labelOff={t.noRequiresBase}
                        colorOn="blue"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="ghost" size="sm" onClick={() => openEditPanel(item)}>
                          {t.edit}
                        </Button>

                        {item.active ? (
                          <Button variant="danger" size="sm" onClick={() => handleDeactivate(item.id)}>
                            {t.deactivate}
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => handleActivate(item.id)}>
                            {t.activate}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closePanel} />
          <div className="relative h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto flex flex-col">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">
                {editingIdRef.current ? t.edit : t.new} — {t.title}
              </h2>
              <button
                onClick={closePanel}
                className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 px-8 py-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label={t.code} error={errors.code}>
                <input
                  name="code"
                  value={form.code}
                  onChange={handleChange}
                  maxLength={10}
                  placeholder="Ej: IVA19"
                  className={inputCls(errors.code)}
                />
              </Field>

              <Field label={t.name} error={errors.name}>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  maxLength={100}
                  placeholder="Ej: IVA Ventas 19%"
                  className={inputCls(errors.name)}
                />
              </Field>

              {/* TODO(tax-types): "type" is currently free text. Tax types
                  (IVA, RETEFUENTE, ICA, etc.) can be created at any time by
                  external authorities (DIAN, municipalities) without any
                  coordination with our release cycle — modeling this as a
                  hardcoded enum (like TaxRegime) would mean a backend +
                  frontend deploy every time a new tax type shows up.
                  Plan: replace this <input> with a <select> backed by a
                  real catalog/table (e.g. GET /v1/tax-types), the same
                  pattern already used for `accountId` below and for
                  cities/cost centers elsewhere in the app. That also
                  opens the door to a small admin CRUD screen (like
                  CostCenterPage) so a new tax type can be added without
                  touching code. Left as free text for now to keep moving,
                  but this is a real data-integrity risk — a typo here
                  (e.g. "RETEFUENTE" vs "RETENCION_FUENTE") could silently
                  break downstream tax calculations. */}
              <Field label={t.type} error={errors.type}>
                <input
                  name="type"
                  value={form.type}
                  onChange={handleChange}
                  maxLength={20}
                  placeholder="Ej: IVA, RETEFUENTE, ICA"
                  className={inputCls(errors.type)}
                />
              </Field>

              <Field label={t.sign} error={errors.sign}>
                <select
                  name="sign"
                  value={form.sign}
                  onChange={handleChange}
                  className={inputCls(errors.sign)}
                >
                  <option value="D">D - {t.debit}</option>
                  <option value="C">C - {t.credit}</option>
                </select>
              </Field>

              <Field label={t.rate} error={errors.rate}>
                <input
                  type="number"
                  name="rate"
                  value={form.rate}
                  onChange={handleChange}
                  step="0.0001"
                  min="0"
                  placeholder="Ej: 19 o 0.966"
                  className={`${inputCls(errors.rate)} font-mono`}
                />
              </Field>

              <Field label={t.minimumBase} error={errors.minimumBase}>
                <input
                  type="number"
                  name="minimumBase"
                  value={form.minimumBase}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  placeholder="Ej: 0"
                  className={`${inputCls(errors.minimumBase)} font-mono`}
                />
              </Field>

              <div className="md:col-span-2">
                <Field label={t.account} error={errors.accountId}>
                  <select
                    name="accountId"
                    value={form.accountId}
                    onChange={handleChange}
                    className={inputCls(errors.accountId)}
                    disabled={loadingAccounts}
                  >
                    <option value="">
                      {loadingAccounts ? t.loadingAccounts : t.selectAccount}
                    </option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} - {acc.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="md:col-span-2 flex gap-6">
                <Toggle
                  name="active"
                  checked={form.active}
                  onChange={handleChange}
                  label={t.active}
                  color="emerald"
                />
                <Toggle
                  name="requiresBase"
                  checked={form.requiresBase}
                  onChange={handleChange}
                  label={t.requiresBase}
                  color="blue"
                />
              </div>

              <div className="md:col-span-2 flex gap-3 pt-4">
                <Button type="submit" variant="primary" size="lg" fullWidth>
                  {editingIdRef.current ? t.update : t.save}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closePanel}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-3 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent`;

function Field({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
        {label}
      </label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

function Toggle({ name, checked, onChange, label, color = "blue" }) {
  const colors = { blue: "bg-blue-600", emerald: "bg-emerald-500" };
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div className="relative">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={onChange}
          className="sr-only"
        />
        <div className={`w-11 h-6 rounded-full transition-colors ${checked ? colors[color] : "bg-slate-200"}`} />
        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </div>
      <span className="text-sm font-medium text-slate-600">{label}</span>
    </label>
  );
}

function Badge({ active, labelOn, labelOff, colorOn }) {
  const colors = {
    green: "bg-green-100 text-green-700",
    blue: "bg-blue-100 text-blue-700",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
        active ? colors[colorOn] : "bg-gray-100 text-gray-500"
      }`}
    >
      {active ? labelOn : labelOff}
    </span>
  );
}

export default TaxPage;
