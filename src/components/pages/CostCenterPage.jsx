import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api"; // Centralized Axios instance configured for multi-tenancy
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

const initialForm = {
  code: "",
  name: "",
  parentId: "",
  allowsMovement: true,
  active: true,
};

// Returns the set of ids that are descendants (children, grandchildren, ...)
// of a given cost center, based on parentId links in `rows`. Used to keep
// the "Centro Padre" selector from offering a descendant as a parent,
// which would create a circular reference in the hierarchy (e.g. editing
// "Gerencia" and setting its own child "Ventas" as its parent).
const getDescendantIds = (id, rows) => {
  const descendants = new Set();
  const stack = [id];
  while (stack.length > 0) {
    const currentId = stack.pop();
    for (const row of rows) {
      if (row.parentId === currentId && !descendants.has(row.id)) {
        descendants.add(row.id);
        stack.push(row.id);
      }
    }
  }
  return descendants;
};

// The backend rejects allowsMovement=true on any cost center that has
// children (a parent node shouldn't receive direct postings — only its
// leaf-level children should, to avoid double-counting in reports). This
// mirrors that rule on the frontend so the user sees it immediately
// instead of discovering it via a failed save.
const hasChildren = (id, rows) => rows.some((r) => r.parentId === id);

function CostCenterPage({ language = "es" }) {
  const [rows, setRows]             = useState([]);
  const [form, setForm]             = useState(initialForm);
  const [errors, setErrors]         = useState({});
  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading]       = useState(false);
  const [toast, setToast]           = useState(null);

  // Sync ref to safeguard against React asynchronous state batching inside execution scopes
  const editingIdRef = useRef(null);

  // Resolve active multi-tenant identifier from AuthContext (reactive —
  // updates automatically if switchCompany() runs), instead of reading
  // localStorage directly, which wouldn't trigger a re-render.
  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Centros de Costo", subtitle: "Estructura Organizacional y Operativa",
      new: "Nuevo", edit: "Editar", save: "Guardar", update: "Actualizar",
      cancel: "Cancelar", search: "Buscar...",
      code: "Código", name: "Nombre", level: "Nivel", parent: "Centro Padre",
      active: "Activo", inactive: "Inactivo",
      allowsMovement: "Permite Movimiento", noMovement: "Sin Movimiento",
      actions: "Acciones", required: "Obligatorio",
      deactivate: "Desactivar", activate: "Activar", noParent: "— Sin padre —",
      confirmDeactivate: "¿Desactivar este centro de costo?",
      confirmActivate: "¿Activar este centro de costo?",
      noResults: "Sin registros", errorConn: "Error de conexión con el servidor.",
      loading: "Cargando registros...",
      successCreate: "¡Centro creado!", successUpdate: "¡Actualizado!",
      successDeactivate: "Desactivado.", successActivate: "Activado.",
      movementBlockedByChildren: "No permite movimiento porque tiene centros hijos asociados.",
      parentAllowsMovementWarning: "Este centro padre permite movimiento. Debes desactivar \"Permite Movimiento\" en él antes de guardar, o el backend rechazará el cambio.",
    },
    en: {
      title: "Cost Centers", subtitle: "Organizational and Operational Structure",
      new: "New", edit: "Edit", save: "Save", update: "Update",
      cancel: "Cancel", search: "Search...",
      code: "Code", name: "Name", level: "Level", parent: "Parent Center",
      active: "Active", inactive: "Inactive",
      allowsMovement: "Allows Movement", noMovement: "No Movement",
      actions: "Actions", required: "Required",
      deactivate: "Deactivate", activate: "Activate", noParent: "— No parent —",
      confirmDeactivate: "Deactivate this cost center?",
      confirmActivate: "Activate this cost center?",
      noResults: "No records", errorConn: "Server connection error.",
      loading: "Loading records...",
      successCreate: "Center created!", successUpdate: "Updated!",
      successDeactivate: "Deactivated.", successActivate: "Activated.",
      movementBlockedByChildren: "Movement isn't allowed because this center has child cost centers.",
      parentAllowsMovementWarning: "This parent center allows movement. You must disable \"Allows Movement\" on it before saving, or the backend will reject the change.",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  /**
   * Loads cost centers mapped under the authorized active tenant context.
   */
  const loadCostCenters = async () => {
    setLoading(true);
    try {
      const response = await api.get("/v1/cost-centers");
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
    loadCostCenters();
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

  const resetForm = () => {
    setForm(initialForm);
    setErrors({});
    setEditingId(null);
    editingIdRef.current = null;
  };

  const closePanel = () => { setOpen(false); resetForm(); };

  const openEditPanel = (item) => {
    // Defensive repair: if this record has children but was somehow saved
    // with allowsMovement=true (legacy data, or a child added after the
    // fact through another flow), don't load an inconsistent value into
    // the form — the toggle would be disabled anyway, but this keeps the
    // payload correct even if the user never touches this field.
    const itemHasChildren = hasChildren(item.id, rows);

    setForm({
      code:           item.code || "",
      name:           item.name || "",
      parentId:       item.parentId != null ? String(item.parentId) : "",
      allowsMovement: itemHasChildren ? false : (item.allowsMovement ?? true),
      active:         item.active ?? true,
    });
    setErrors({});
    setEditingId(item.id);
    editingIdRef.current = item.id;
    setOpen(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const validate = () => {
    const errs = {};
    if (!form.code?.trim()) errs.code = t.required;
    if (!form.name?.trim()) errs.name = t.required;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /**
   * Handles database persistence via active Spring Boot api routes.
   */
  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const currentId = editingIdRef.current;

    // Defense in depth: even though the toggle is disabled in the UI when
    // this record has children, never submit allowsMovement=true for a
    // parent node — mirrors the backend rule so a stale/inconsistent
    // client-side value can't slip through.
    const recordHasChildren = currentId != null && hasChildren(currentId, rows);

    const payload = {
      code:           form.code.trim(),
      name:           form.name.trim(),
      parentId:       form.parentId !== "" ? Number(form.parentId) : null,
      allowsMovement: recordHasChildren ? false : Boolean(form.allowsMovement),
      active:         Boolean(form.active),
    };

    try {
      let response;
      if (currentId) {
        response = await api.put(`/v1/cost-centers/${currentId}`, payload);
      } else {
        response = await api.post("/v1/cost-centers", payload);
      }

      if (response.data && response.data.success) {
        showToast(currentId ? t.successUpdate : t.successCreate);
        closePanel();
        loadCostCenters();
      } else {
        // FIX: this branch handles a 200 response where the backend's own
        // business logic says success:false (not a thrown exception) —
        // e.g. an explicit validation failure. Routed through
        // getApiErrorMessage too, in case the backend uses the same error
        // codes here as it does for DataIntegrityViolationException.
        showToast(getApiErrorMessage({ response }, language, t.errorConn), "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * Performs soft logical deactivation against specific enterprise nodes.
   */
  const handleDeactivate = async (id) => {
    if (!window.confirm(t.confirmDeactivate)) return;
    try {
      const response = await api.patch(`/v1/cost-centers/${id}/deactivate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successDeactivate);
        loadCostCenters();
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * FIX: this action was missing entirely — the table always rendered
   * "Desactivar" regardless of the row's current state, so an inactive
   * cost center had no way back. Mirrors ThirdPartyPage's activate/
   * deactivate pattern.
   */
  const handleActivate = async (id) => {
    if (!window.confirm(t.confirmActivate)) return;
    try {
      const response = await api.patch(`/v1/cost-centers/${id}/activate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successActivate);
        loadCostCenters();
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  return (
    <div className="space-y-6 p-4">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${
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
          <Button variant="primary" onClick={() => { resetForm(); setOpen(true); }}>
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
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">{t.loading}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {[t.code, t.name, t.parent, t.level, t.active, t.allowsMovement, t.actions].map((h) => (
                  <th key={h} className="px-5 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredRows.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-slate-400">{t.noResults}</td></tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-4 font-bold text-slate-700">{r.code}</td>
                    <td className="px-5 py-4 text-slate-600">{r.name}</td>
                    <td className="px-5 py-4 text-slate-400 text-xs">
                      {r.parentId
                        ? rows.find((p) => p.id === r.parentId)?.name ?? "—"
                        : <span className="text-slate-300">Raíz</span>
                      }
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                        {r.level ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
                        r.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {r.active ? t.active : t.inactive}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
                        r.allowsMovement ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {r.allowsMovement ? t.allowsMovement : t.noMovement}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditPanel(r)}>
                          {t.edit}
                        </Button>
                        {/* FIX: was always "Desactivar" regardless of r.active,
                            leaving no way to reactivate an inactive center. */}
                        {r.active ? (
                          <Button variant="danger" size="sm" onClick={() => handleDeactivate(r.id)}>
                            {t.deactivate}
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => handleActivate(r.id)}>
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
          <div className="relative h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto flex flex-col">

            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">
                {editingIdRef.current ? t.edit : t.new} — {t.title}
              </h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={handleSave} className="flex-1 px-8 py-6 flex flex-col gap-5">

              <CcField label={t.code} error={errors.code}>
                <input name="code" value={form.code} onChange={handleChange}
                  placeholder="Ej: 10-01" className={ccInputCls(errors.code)} />
              </CcField>

              <CcField label={t.name} error={errors.name}>
                <input name="name" value={form.name} onChange={handleChange}
                  placeholder="Ej: Gerencia" className={ccInputCls(errors.name)} />
              </CcField>

              <CcField label={t.parent}>
                <select name="parentId" value={form.parentId} onChange={handleChange}
                  className={ccInputCls()}>
                  <option value="">{t.noParent}</option>
                  {rows
                    // FIX: previously only excluded the record being edited
                    // itself, which allowed picking one of ITS OWN
                    // descendants as its parent — creating a circular
                    // reference in the hierarchy (e.g. "Gerencia" → child
                    // "Ventas" → back to "Gerencia" as parent). Now excludes
                    // the record and all of its descendants.
                    .filter((r) => {
                      if (editingIdRef.current == null) return true;
                      if (r.id === editingIdRef.current) return false;
                      const descendantIds = getDescendantIds(editingIdRef.current, rows);
                      return !descendantIds.has(r.id);
                    })
                    .map((r) => (
                      <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
                    ))}
                </select>
              </CcField>

              {/* Warn (non-blocking) when the chosen parent currently allows
                  movement — assigning this record as its child would make
                  that parent a non-leaf node with allowsMovement=true,
                  which the backend will reject on the PARENT's own record. */}
              {form.parentId !== "" &&
                rows.find((r) => String(r.id) === String(form.parentId))?.allowsMovement && (
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {t.parentAllowsMovementWarning}
                  </p>
                )}

              <div className="flex gap-6 pt-2">
                <CcToggle name="active" checked={form.active} onChange={handleChange} label={t.active} color="emerald" />
                <div className="flex flex-col gap-1">
                  <CcToggle
                    name="allowsMovement"
                    checked={form.allowsMovement}
                    onChange={handleChange}
                    label={t.allowsMovement}
                    color="blue"
                    disabled={editingIdRef.current != null && hasChildren(editingIdRef.current, rows)}
                  />
                  {/* FIX: this record has children — the backend rejects
                      allowsMovement=true on non-leaf cost centers, so the
                      toggle is disabled and explained here instead of
                      letting the user find out only after a failed save. */}
                  {editingIdRef.current != null && hasChildren(editingIdRef.current, rows) && (
                    <p className="text-[11px] text-slate-400 max-w-[220px]">
                      {t.movementBlockedByChildren}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4 mt-auto">
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

// ── Local Helpers UI Elements ──────────────────────────────────────────────────
const ccInputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-3 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent`;

function CcField({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

function CcToggle({ name, checked, onChange, label, color = "blue", disabled = false }) {
  const colors = { blue: "bg-blue-600", emerald: "bg-emerald-500" };
  return (
    <label className={`flex items-center gap-3 select-none ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <div className="relative">
        <input type="checkbox" name={name} checked={checked} onChange={onChange} disabled={disabled} className="sr-only" />
        <div className={`w-11 h-6 rounded-full transition-colors ${checked ? colors[color] : "bg-slate-200"}`} />
        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </div>
      <span className="text-sm font-medium text-slate-600">{label}</span>
    </label>
  );
}

export default CostCenterPage;
