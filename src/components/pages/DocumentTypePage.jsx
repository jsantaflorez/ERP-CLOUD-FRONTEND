import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api"; // Centralized Axios instance configured for multi-tenancy
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

const initialForm = {
  code: "",
  name: "",
  prefix: "",
  currentConsecutive: "0",
  active: true,
  isAccounting: false,
  legalResolution: "",
};

function DocumentTypePage({ language = "es" }) {
  const [rows, setRows]             = useState([]);
  const [form, setForm]             = useState(initialForm);
  const [errors, setErrors]         = useState({});
  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading]       = useState(false);
  const [toast, setToast]           = useState(null);

  // NEW: dedicated "Ajustar Consecutivo" panel — separate from the main
  // edit form, since the backend's general update() never touches
  // currentConsecutive at all (confirmed against DocumentTypeService).
  // Adjusting it only happens through PATCH .../reset-consecutive, which
  // enforces newValue >= current (forward-only).
  const [adjustingItem, setAdjustingItem]           = useState(null); // row being adjusted, or null
  const [newConsecutiveValue, setNewConsecutiveValue] = useState("");
  const [consecutiveError, setConsecutiveError]     = useState("");
  const [isAdjustingConsecutive, setIsAdjustingConsecutive] = useState(false);

  // Snapshot of currentConsecutive at the moment editing started. Used as
  // a defense-in-depth guard in handleSave: even though the field is
  // rendered readOnly while editing, this ensures the payload can never
  // carry a different value than what was actually loaded, regardless of
  // any client-side tampering with the DOM/readOnly attribute.
  const originalConsecutiveRef = useRef(null);

  // Resolve active multi-tenant identifier from AuthContext (reactive —
  // updates automatically if switchCompany() runs), instead of reading
  // localStorage directly, which wouldn't trigger a re-render.
  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Tipos de Documento", subtitle: "Maestro de Configuración Transaccional",
      new: "Nuevo", edit: "Editar", save: "Guardar", update: "Actualizar",
      cancel: "Cancelar", search: "Buscar por código o nombre...",
      code: "Código", name: "Nombre", prefix: "Prefijo",
      consecutive: "Consecutivo", active: "Activo", inactive: "Inactivo",
      accounting: "Contable", noAccounting: "No Contable",
      resolution: "Resolución Legal", actions: "Acciones",
      required: "Campo obligatorio", deactivate: "Desactivar", activate: "Activar",
      noResults: "Sin registros", loading: "Cargando registros...",
      confirmDeactivate: "¿Desactivar este tipo de documento?",
      confirmActivate: "¿Activar este tipo de documento?",
      successCreate: "¡Tipo de documento creado!",
      successUpdate: "¡Actualizado correctamente!",
      successDeactivate: "Desactivado.",
      successActivate: "Activado.",
      errorConn: "Error de conexión con el servidor de bases de datos.",
      // RESOLVED: confirmed against the real DocumentTypeService —
      // mapRequestToEntity() (used by update()) never reads or sets
      // currentConsecutive at all, so PUT /v1/document-types/{id} can't
      // touch it regardless of what this form sends. There's a separate,
      // dedicated endpoint for adjusting it forward-only:
      // PATCH /v1/document-types/{id}/reset-consecutive?newValue=...
      // (DocumentTypeService.resetConsecutive, rejects newValue < current).
      // This field stays read-only in the main edit form (editing it here
      // would be a no-op anyway) — use the "Ajustar Consecutivo" action
      // instead, which calls that dedicated endpoint.
      // Note: this manual action is for deliberate corrections (e.g. fixing
      // a resolution transition). It's distinct from the "deleting the
      // last document should roll back by one" case discussed earlier —
      // that should still be automatic, triggered by the delete flow
      // itself, not a manual adjustment someone has to remember to make.
      consecutiveLockedHint: "No editable aquí. Usa \"Ajustar Consecutivo\" para cambiarlo.",
      adjustConsecutive: "Ajustar Consecutivo",
      adjustConsecutiveTitle: "Ajustar Consecutivo",
      currentConsecutiveLabel: "Consecutivo actual",
      newConsecutiveLabel: "Nuevo consecutivo",
      consecutiveTooLow: "El nuevo consecutivo no puede ser menor al actual.",
      consecutiveInvalid: "Ingresa un número válido.",
      successConsecutiveReset: "Consecutivo actualizado correctamente.",
    },
    en: {
      title: "Document Types", subtitle: "Transactional Configuration Master",
      new: "New", edit: "Edit", save: "Save", update: "Update",
      cancel: "Cancel", search: "Search by code or name...",
      code: "Code", name: "Name", prefix: "Prefix",
      consecutive: "Consecutive", active: "Active", inactive: "Inactive",
      accounting: "Accounting", noAccounting: "Non-Accounting",
      resolution: "Legal Resolution", actions: "Actions",
      required: "Required field", deactivate: "Deactivate", activate: "Activate",
      noResults: "No records", loading: "Loading records...",
      confirmDeactivate: "Deactivate this document type?",
      confirmActivate: "Activate this document type?",
      successCreate: "Document type created!",
      successUpdate: "Updated successfully!",
      successDeactivate: "Deactivated.",
      successActivate: "Activated.",
      errorConn: "Database server connection error.",
      consecutiveLockedHint: "Not editable here. Use \"Adjust Consecutive\" to change it.",
      adjustConsecutive: "Adjust Consecutive",
      adjustConsecutiveTitle: "Adjust Consecutive",
      currentConsecutiveLabel: "Current consecutive",
      newConsecutiveLabel: "New consecutive",
      consecutiveTooLow: "The new consecutive can't be lower than the current one.",
      consecutiveInvalid: "Enter a valid number.",
      successConsecutiveReset: "Consecutive updated successfully.",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  /**
   * Fetches the complete list of document types scoped to the current tenant.
   */
  const loadDocuments = async () => {
    setLoading(true);
    try {
      const response = await api.get("/v1/document-types");
      // Validate structure based on our Spring Boot generic RestResponse object wrapper
      if (response.data && response.data.success) {
        setRows([...response.data.data]);
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.code?.toLowerCase().includes(term) ||
        r.name?.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  const resetForm  = () => {
    setForm(initialForm);
    setErrors({});
    setEditingId(null);
    originalConsecutiveRef.current = null;
  };
  const openCreatePanel = () => { resetForm(); setOpen(true); };

  const openEditPanel = (item) => {
    const consecutiveValue = item.currentConsecutive != null ? String(item.currentConsecutive) : "0";
    setForm({
      code:               item.code || "",
      name:               item.name || "",
      prefix:             item.prefix || "",
      // Kept as a string in form state (see handleChange) so the field
      // isn't force-reset to "0" mid-edit when the user clears it to
      // retype a new value.
      currentConsecutive: consecutiveValue,
      legalResolution:    item.legalResolution || "",
      isAccounting:       item.isAccounting ?? item.accounting ?? false,
      active:             item.active ?? true,
    });
    originalConsecutiveRef.current = consecutiveValue;
    setErrors({});
    setEditingId(item.id);
    setOpen(true);
  };

  const closePanel = () => { setOpen(false); resetForm(); };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;
    if (name === "code") val = value.toUpperCase().slice(0, 10);
    // FIX: previously forced this to a Number on every keystroke
    // (`Math.max(0, parseInt(value, 10))`), which meant clearing the field
    // to retype a new value immediately snapped back to "0" instead of
    // staying empty — annoying when replacing e.g. "5000" with "6000".
    // Kept as a raw string now; parsed/clamped at submit time instead.
    setForm((prev) => ({ ...prev, [name]: val }));
  };

  const validate = () => {
    const errs = {};
    if (!form.code?.trim()) errs.code = t.required;
    if (!form.name?.trim()) errs.name = t.required;
    // FIX: added an explicit check now that currentConsecutive is a raw
    // string in state — an empty/non-numeric value would otherwise slip
    // through silently and fall back to 0 in the payload.
    const consecutiveNum = Number(form.currentConsecutive);
    if (form.currentConsecutive === "" || isNaN(consecutiveNum) || consecutiveNum < 0) {
      errs.currentConsecutive = t.required;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /**
   * Persists the document type instance via POST (Create) or PUT (Update).
   */
  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const payload = {
      code:               form.code.trim(),
      name:               form.name.trim(),
      prefix:             form.prefix?.trim() || "",
      // Defense in depth: while editing, currentConsecutive is locked in
      // the UI, but this guarantees the payload matches what was actually
      // loaded (originalConsecutiveRef) rather than trusting form state,
      // which could in theory be tampered with client-side. Only a brand
      // new record (editingId == null) may set this from the form.
      currentConsecutive: editingId
        ? Math.floor(Number(originalConsecutiveRef.current)) || 0
        : Math.floor(Number(form.currentConsecutive)) || 0,
      active:             Boolean(form.active),
      isAccounting:       Boolean(form.isAccounting),
      legalResolution:    form.legalResolution?.trim() || "",
    };

    try {
      let response;
      if (editingId) {
        response = await api.put(`/v1/document-types/${editingId}`, payload);
      } else {
        response = await api.post("/v1/document-types", payload);
      }

      if (response.data && response.data.success) {
        showToast(editingId ? t.successUpdate : t.successCreate);
        closePanel();
        loadDocuments();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * Triggers logical soft-deactivate on the specified enterprise record.
   */
  const handleDeactivate = async (id) => {
    if (!window.confirm(t.confirmDeactivate)) return;
    try {
      const response = await api.patch(`/v1/document-types/${id}/deactivate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successDeactivate);
        loadDocuments();
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * FIX: this action was missing entirely — the table always rendered
   * "Desactivar" regardless of the row's current state, so once a document
   * type was deactivated there was no way to bring it back from the UI.
   * Mirrors the activate/deactivate pattern already used in ThirdPartyPage
   * and TaxPage.
   */
  const handleActivate = async (id) => {
    if (!window.confirm(t.confirmActivate)) return;
    try {
      const response = await api.patch(`/v1/document-types/${id}/activate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successActivate);
        loadDocuments();
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * NEW: dedicated "Ajustar Consecutivo" flow — the only real way to
   * change currentConsecutive, since the main edit form/update() endpoint
   * can't touch it at all. Client-side mirrors the backend's forward-only
   * rule (newValue >= current) so the user sees the problem immediately
   * instead of via a failed request.
   */
  const openAdjustPanel = (item) => {
    setAdjustingItem(item);
    setNewConsecutiveValue(item.currentConsecutive != null ? String(item.currentConsecutive) : "0");
    setConsecutiveError("");
  };

  const closeAdjustPanel = () => {
    setAdjustingItem(null);
    setNewConsecutiveValue("");
    setConsecutiveError("");
  };

  const handleAdjustConsecutive = async (e) => {
    e.preventDefault();
    if (!adjustingItem) return;

    const parsed = Number(newConsecutiveValue);
    if (newConsecutiveValue === "" || isNaN(parsed)) {
      setConsecutiveError(t.consecutiveInvalid);
      return;
    }
    // Mirrors DocumentTypeService.resetConsecutive's own check
    // (newConsecutive < existing.getCurrentConsecutive() → rejected).
    if (parsed < Number(adjustingItem.currentConsecutive)) {
      setConsecutiveError(t.consecutiveTooLow);
      return;
    }
    setConsecutiveError("");

    setIsAdjustingConsecutive(true);
    try {
      const response = await api.patch(
        `/v1/document-types/${adjustingItem.id}/reset-consecutive`,
        null,
        { params: { newValue: Math.floor(parsed) } }
      );
      if (response.status === 200 || response.data?.success) {
        showToast(t.successConsecutiveReset);
        closeAdjustPanel();
        loadDocuments();
      } else {
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setIsAdjustingConsecutive(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl transition-all ${
          toast.type === "error" ? "bg-red-500" : "bg-emerald-500"
        }`}>
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
                {[t.code, t.name, t.prefix, t.consecutive, t.resolution, t.active, t.accounting, t.actions].map((h) => (
                  <th key={h} className="px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-slate-400">{t.noResults}</td>
                </tr>
              ) : (
                filteredRows.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-4 font-bold text-slate-700">{item.code}</td>
                    <td className="px-5 py-4 text-slate-600">{item.name}</td>
                    <td className="px-5 py-4 text-slate-400">{item.prefix || "—"}</td>
                    <td className="px-5 py-4 font-mono text-blue-600">{item.currentConsecutive}</td>
                    <td className="px-5 py-4 text-xs text-slate-400 max-w-[160px] truncate"
                        title={item.legalResolution || ""}>
                      {item.legalResolution?.trim()
                        ? item.legalResolution
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <Badge active={item.active} labelOn={t.active} labelOff={t.inactive} colorOn="green" />
                    </td>
                    <td className="px-5 py-4">
                      <Badge active={item.isAccounting ?? item.accounting} labelOn={t.accounting} labelOff={t.noAccounting} colorOn="blue" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="ghost" size="sm" onClick={() => openEditPanel(item)}>
                          {t.edit}
                        </Button>
                        {/* NEW: dedicated action for the only real way to
                            change currentConsecutive — see
                            openAdjustPanel/handleAdjustConsecutive above. */}
                        <Button variant="ghost" size="sm" onClick={() => openAdjustPanel(item)}>
                          {t.adjustConsecutive}
                        </Button>
                        {/* FIX: was always "Desactivar" regardless of
                            item.active, leaving no way to reactivate. */}
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

      {/* ── Lateral Entry Drawer Panel ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closePanel} />
          <div className="relative h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto flex flex-col">

            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">
                {editingId ? t.edit : t.new} — {t.title}
              </h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={handleSave} className="flex-1 px-8 py-6 grid grid-cols-1 gap-5 md:grid-cols-2">

              <Field label={t.code} error={errors.code}>
                <input name="code" value={form.code} onChange={handleChange}
                  maxLength={10} placeholder="Ej: FV"
                  className={inputCls(errors.code)} />
              </Field>

              <Field label={t.name} error={errors.name}>
                <input name="name" value={form.name} onChange={handleChange}
                  maxLength={100} placeholder="Ej: Factura de Venta"
                  className={inputCls(errors.name)} />
              </Field>

              <Field label={t.prefix}>
                <input name="prefix" value={form.prefix} onChange={handleChange}
                  maxLength={5} placeholder="Ej: FV-"
                  className={inputCls()} />
              </Field>

              {/* TODO(consecutive-lock): see the note above initialForm's
                  translations for the full reasoning (confirmed with
                  backend: no real protection exists on the PUT endpoint
                  today, and the "delete needs rollback" case must go
                  through a dedicated audited flow, not this field). Locked
                  to read-only once editingId is set — only editable at
                  creation time, when you're defining the starting number
                  per the legal resolution. */}
              <Field label={t.consecutive} error={errors.currentConsecutive}>
                <input type="number" name="currentConsecutive"
                  value={form.currentConsecutive} onChange={handleChange}
                  min="0" readOnly={!!editingId}
                  className={`${inputCls(errors.currentConsecutive)} font-mono ${editingId ? "opacity-60 cursor-not-allowed" : ""}`} />
                {editingId && (
                  <span className="text-[10px] text-amber-600">{t.consecutiveLockedHint}</span>
                )}
              </Field>

              <div className="md:col-span-2">
                <Field label={t.resolution}>
                  <input name="legalResolution" value={form.legalResolution}
                    onChange={handleChange} maxLength={255}
                    placeholder="Ej: Res. DIAN 18760003"
                    className={inputCls()} />
                </Field>
              </div>

              <div className="md:col-span-2 flex gap-6">
                <Toggle name="active"       checked={form.active}       onChange={handleChange} label={t.active}      color="emerald" />
                <Toggle name="isAccounting" checked={form.isAccounting} onChange={handleChange} label={t.accounting}  color="blue" />
              </div>

              <div className="md:col-span-2 flex gap-3 pt-4">
                <Button type="submit" variant="primary" size="lg" fullWidth>
                  {editingId ? t.update : t.save}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closePanel}>
                  {t.cancel}
                </Button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* NEW: dedicated "Ajustar Consecutivo" panel — separate from the
          main edit form on purpose, since that form can't touch
          currentConsecutive at all (the backend's update() ignores it).
          This calls PATCH .../reset-consecutive, the only real endpoint
          that can change it, and mirrors its forward-only validation
          client-side. */}
      {adjustingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeAdjustPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800">{t.adjustConsecutiveTitle}</h2>
              <button onClick={closeAdjustPanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={handleAdjustConsecutive} className="px-6 py-5 flex flex-col gap-4">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  {adjustingItem.code} — {adjustingItem.name}
                </div>
                <div className="text-sm text-slate-600">
                  {t.currentConsecutiveLabel}:{" "}
                  <span className="font-mono font-bold text-slate-800">
                    {adjustingItem.currentConsecutive}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {t.newConsecutiveLabel}
                </label>
                <input
                  type="number"
                  value={newConsecutiveValue}
                  onChange={(e) => { setNewConsecutiveValue(e.target.value); setConsecutiveError(""); }}
                  min={adjustingItem.currentConsecutive}
                  className={`w-full border-b-2 ${consecutiveError ? "border-red-400" : "border-gray-100"} p-3 text-sm font-mono outline-none focus:border-blue-500 transition-colors bg-transparent`}
                  autoFocus
                />
                {consecutiveError && (
                  <span className="text-[10px] text-red-500">{consecutiveError}</span>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" size="lg" fullWidth loading={isAdjustingConsecutive}>
                  {t.save}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closeAdjustPanel} disabled={isAdjustingConsecutive}>
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

// ── Local Helpers UI Elements ──────────────────────────────────────────────────
const inputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-3 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent`;

function Field({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
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
        <input type="checkbox" name={name} checked={checked} onChange={onChange} className="sr-only" />
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
    blue:  "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
      active ? colors[colorOn] : "bg-gray-100 text-gray-500"
    }`}>
      {active ? labelOn : labelOff}
    </span>
  );
}

export default DocumentTypePage;
