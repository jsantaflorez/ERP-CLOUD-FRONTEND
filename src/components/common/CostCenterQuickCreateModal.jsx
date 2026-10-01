import { useState } from "react";
import api from "../../services/api";
import Button from "../ui/Button";
import { getApiErrorMessage } from "../../constants/apiErrors";

// NEW (2026-10-01): sibling to AccountQuickCreateModal.jsx -- lets a journal
// entry line create the cost center it needs without leaving the comprobante
// being typed. CostCenterPage.jsx's own create form is much simpler than
// ChartOfAccountPage.jsx's (no PUC code-structure rules), so this is a
// straight, scoped copy of its create-only path: same fields, same payload,
// same backend endpoint. Left out on purpose because they only matter in
// edit mode, never for a brand-new record: the descendant-based parent
// exclusion (getDescendantIds in CostCenterPage.jsx) and the
// has-children-forces-no-movement guard (a new record never has children).

const initialForm = {
  code: "",
  name: "",
  parentId: "",
  // Defaults to true, like AccountQuickCreateModal's postingAccount default
  // -- the point of this modal is a center that can be posted to right away.
  allowsMovement: true,
  active: true,
};

/**
 * Quick-create modal for a Cost Center, opened from a "+" button next to a
 * cost-center picker elsewhere in the app (currently just the Journal Entry
 * form). `rows` is the caller's own full cost-centers list (same shape
 * loaded by CostCenterPage.jsx / JournalEntryPage.jsx's `costCenters`
 * state) -- used only for the parent dropdown. `onCreated(costCenter)`
 * fires once after a successful save with the backend's full
 * CostCenterResponseDTO; `onClose()` fires on cancel or after onCreated,
 * whichever the caller doesn't already handle.
 */
function CostCenterQuickCreateModal({ language = "es", rows, onCreated, onClose }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const t = {
    es: {
      title: "Nuevo Centro de Costo",
      code: "Código",
      name: "Nombre",
      parent: "Centro Padre",
      noParent: "— Sin padre —",
      allowsMovement: "Permite Movimiento",
      active: "Activo",
      required: "Campo obligatorio",
      save: "Crear Centro",
      saving: "Creando...",
      cancel: "Cancelar",
      errorConn: "Error de conexión con el servidor.",
      postingHint: "Desmárquelo solo si este centro es un grupo/encabezado. En ese caso no quedará seleccionable en esta línea del comprobante.",
    },
    en: {
      title: "New Cost Center",
      code: "Code",
      name: "Name",
      parent: "Parent Center",
      noParent: "— No parent —",
      allowsMovement: "Allows Movement",
      active: "Active",
      required: "Required",
      save: "Create Center",
      saving: "Creating...",
      cancel: "Cancel",
      errorConn: "Server connection error.",
      postingHint: "Only uncheck this if the center is a header/group. If you do, it won't be selectable on this entry's line.",
    },
  }[language];

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === "checkbox" ? checked : value;
    setForm((prev) => ({ ...prev, [name]: val }));
  };

  const validate = () => {
    const errs = {};
    if (!form.code?.trim()) errs.code = t.required;
    if (!form.name?.trim()) errs.name = t.required;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!validate()) return;

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      parentId: form.parentId !== "" ? Number(form.parentId) : null,
      allowsMovement: Boolean(form.allowsMovement),
      active: Boolean(form.active),
    };

    setSaving(true);
    try {
      const response = await api.post("/v1/cost-centers", payload);
      if (response.data && response.data.success) {
        onCreated(response.data.data);
      } else {
        setErrorMsg(
          getApiErrorMessage({ response }, language, t.errorConn)
        );
      }
    } catch (error) {
      setErrorMsg(getApiErrorMessage(error, language, t.errorConn));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-800">{t.title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSave} className="px-6 py-5 flex flex-col gap-4">
          {errorMsg && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          <CcField label={t.code} error={errors.code}>
            <input
              name="code"
              value={form.code}
              onChange={handleChange}
              maxLength={20}
              placeholder="Ej: 01"
              className={ccInputCls(errors.code)}
              autoFocus
            />
          </CcField>

          <CcField label={t.name} error={errors.name}>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              maxLength={150}
              placeholder="Ej: Ventas"
              className={ccInputCls(errors.name)}
            />
          </CcField>

          <CcField label={t.parent}>
            <select name="parentId" value={form.parentId} onChange={handleChange} className={ccInputCls()}>
              <option value="">{t.noParent}</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
              ))}
            </select>
          </CcField>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-6">
              <CcToggle name="active" checked={form.active} onChange={handleChange} label={t.active} color="emerald" />
              <CcToggle name="allowsMovement" checked={form.allowsMovement} onChange={handleChange} label={t.allowsMovement} color="blue" />
            </div>
            {!form.allowsMovement && (
              <p className="text-[11px] text-amber-600">{t.postingHint}</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" fullWidth loading={saving}>
              {saving ? t.saving : t.save}
            </Button>
            <Button type="button" variant="secondary" fullWidth onClick={onClose}>
              {t.cancel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ccInputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-2.5 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent`;

function CcField({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

function CcToggle({ name, checked, onChange, label, color = "blue" }) {
  const colors = { blue: "bg-blue-600", emerald: "bg-emerald-500" };
  return (
    <label className="flex items-center gap-2 select-none cursor-pointer">
      <div className="relative">
        <input type="checkbox" name={name} checked={checked} onChange={onChange} className="sr-only" />
        <div className={`w-9 h-5 rounded-full transition-colors ${checked ? colors[color] : "bg-slate-200"}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </div>
      <span className="text-xs font-medium text-slate-600">{label}</span>
    </label>
  );
}

export default CostCenterQuickCreateModal;
