// UserManagementPage.jsx
import { useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";

// 🔗 Cuando el backend esté listo, descomenta API_URL y elimina MOCK_USERS
// const API_URL = "https://ungnostic-unadversely-sage.ngrok-free.dev/api/v1/users";
// const REQUEST_HEADERS = {
//   "Content-Type": "application/json",
//   "ngrok-skip-browser-warning": "69420",
//   "X-Tenant-Id": "tenant-demo",
// };

// ── Datos mock — reemplazar por fetch cuando el backend esté listo ──
const MOCK_USERS = [
  { id: 1, username: "admin",    fullName: "Administrador Principal", email: "admin@erp.com",    level: 1, active: true  },
  { id: 2, username: "jefe",     fullName: "Jefe de Área",            email: "jefe@erp.com",     level: 2, active: true  },
  { id: 3, username: "contador", fullName: "Contador General",        email: "conta@erp.com",    level: 3, active: true  },
  { id: 4, username: "auxiliar", fullName: "Auxiliar Contable",       email: "aux@erp.com",      level: 4, active: false },
];

// Niveles de acceso del sistema — ajustar según reglas de negocio
const ACCESS_LEVELS = [
  { value: 1, label: "1 — Superadmin"  },
  { value: 2, label: "2 — Administrador" },
  { value: 3, label: "3 — Supervisor"  },
  { value: 4, label: "4 — Operador"    },
  { value: 5, label: "5 — Solo lectura" },
];

const initialForm = {
  username:    "",
  fullName:    "",
  email:       "",
  level:       4,
  active:      true,
  password:    "",
  confirmPassword: "",
};

function UserManagementPage({ language = "es", currentUser }) {
  const [rows, setRows]             = useState(MOCK_USERS);
  const [form, setForm]             = useState(initialForm);
  const [errors, setErrors]         = useState({});
  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast]           = useState(null);
  // Panel secundario para cambio de contraseña
  const [pwdPanel, setPwdPanel]     = useState(null); // { id, username }
  const [pwdForm, setPwdForm]       = useState({ newPassword: "", confirmPassword: "" });
  const [pwdErrors, setPwdErrors]   = useState({});

  // ── Traducciones ─────────────────────────────────────────────────
  const t = {
    es: {
      title: "Gestión de Usuarios", subtitle: "Administración / User Management",
      new: "Nuevo Usuario", edit: "Editar", save: "Guardar", update: "Actualizar",
      cancel: "Cancelar", search: "Buscar usuario...",
      username: "Usuario", fullName: "Nombre Completo", email: "Correo",
      level: "Nivel de Acceso", active: "Activo", inactive: "Inactivo",
      actions: "Acciones", required: "Obligatorio",
      activate: "Activar", deactivate: "Desactivar",
      changePassword: "Cambiar Contraseña", password: "Contraseña",
      confirmPassword: "Confirmar Contraseña", passwordMismatch: "Las contraseñas no coinciden",
      passwordMin: "Mínimo 6 caracteres", noResults: "Sin usuarios",
      confirmDeactivate: "¿Desactivar este usuario?",
      confirmActivate: "¿Activar este usuario?",
      successCreate: "¡Usuario creado!", successUpdate: "¡Actualizado!",
      successToggle: "Estado actualizado.", successPassword: "¡Contraseña actualizada!",
      levelLabel: "Nivel", errorConn: "Error de conexión.",
      ownAccountWarning: "No puedes desactivar tu propia cuenta.",
      newPassword: "Nueva Contraseña",
    },
    en: {
      title: "User Management", subtitle: "Administration / User Management",
      new: "New User", edit: "Edit", save: "Save", update: "Update",
      cancel: "Cancel", search: "Search user...",
      username: "Username", fullName: "Full Name", email: "Email",
      level: "Access Level", active: "Active", inactive: "Inactive",
      actions: "Actions", required: "Required",
      activate: "Activate", deactivate: "Deactivate",
      changePassword: "Change Password", password: "Password",
      confirmPassword: "Confirm Password", passwordMismatch: "Passwords don't match",
      passwordMin: "Minimum 6 characters", noResults: "No users found",
      confirmDeactivate: "Deactivate this user?",
      confirmActivate: "Activate this user?",
      successCreate: "User created!", successUpdate: "Updated!",
      successToggle: "Status updated.", successPassword: "Password updated!",
      levelLabel: "Level", errorConn: "Connection error.",
      ownAccountWarning: "You cannot deactivate your own account.",
      newPassword: "New Password",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Filtro ───────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.username?.toLowerCase().includes(term) ||
        r.fullName?.toLowerCase().includes(term) ||
        r.email?.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  // ── Formulario ───────────────────────────────────────────────────
  const resetForm = () => { setForm(initialForm); setErrors({}); setEditingId(null); };
  const closePanel = () => { setOpen(false); resetForm(); };

  const openCreatePanel = () => { resetForm(); setOpen(true); };

  const openEditPanel = (item) => {
    setForm({
      username:        item.username || "",
      fullName:        item.fullName || "",
      email:           item.email || "",
      level:           item.level ?? 4,
      active:          item.active ?? true,
      password:        "",
      confirmPassword: "",
    });
    setErrors({});
    setEditingId(item.id);
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
    if (!form.username?.trim())  errs.username = t.required;
    if (!form.fullName?.trim())  errs.fullName = t.required;
    if (!form.email?.trim())     errs.email    = t.required;
    // Contraseña solo obligatoria al crear
    if (!editingId) {
      if (!form.password || form.password.length < 6) errs.password = t.passwordMin;
      if (form.password !== form.confirmPassword)      errs.confirmPassword = t.passwordMismatch;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── CRUD (mock — listo para reemplazar por fetch) ────────────────
  const handleSave = (e) => {
    e.preventDefault();
    if (!validate()) return;

    // TODO: Reemplazar por fetch cuando el backend esté listo:
    // const payload = { username, fullName, email, level, active, password }
    // await fetch(url, { method, headers: REQUEST_HEADERS, body: JSON.stringify(payload) })

    if (editingId) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? { ...r, username: form.username, fullName: form.fullName, email: form.email, level: Number(form.level), active: form.active }
            : r
        )
      );
      showToast(t.successUpdate);
    } else {
      setRows((prev) => [
        ...prev,
        { id: Date.now(), username: form.username, fullName: form.fullName, email: form.email, level: Number(form.level), active: form.active },
      ]);
      showToast(t.successCreate);
    }
    closePanel();
  };

  const handleToggleActive = (item) => {
    // Protección: no desactivar la propia cuenta
    if (!item.active === false && currentUser?.id === item.id) {
      showToast(t.ownAccountWarning, "error");
      return;
    }
    if (!window.confirm(item.active ? t.confirmDeactivate : t.confirmActivate)) return;

    // TODO: await fetch(`${API_URL}/${item.id}/toggle-active`, { method: "PATCH", headers: REQUEST_HEADERS })
    setRows((prev) =>
      prev.map((r) => (r.id === item.id ? { ...r, active: !r.active } : r))
    );
    showToast(t.successToggle);
  };

  // ── Cambio de contraseña ─────────────────────────────────────────
  const openPwdPanel = (item) => {
    setPwdPanel({ id: item.id, username: item.username });
    setPwdForm({ newPassword: "", confirmPassword: "" });
    setPwdErrors({});
  };
  const closePwdPanel = () => setPwdPanel(null);

  const handlePwdChange = (e) => {
    setPwdForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePwdSave = (e) => {
    e.preventDefault();
    const errs = {};
    if (!pwdForm.newPassword || pwdForm.newPassword.length < 6) errs.newPassword = t.passwordMin;
    if (pwdForm.newPassword !== pwdForm.confirmPassword)         errs.confirmPassword = t.passwordMismatch;
    setPwdErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // TODO: await fetch(`${API_URL}/${pwdPanel.id}/change-password`, { method: "PATCH", headers: REQUEST_HEADERS, body: JSON.stringify({ newPassword: pwdForm.newPassword }) })
    showToast(t.successPassword);
    closePwdPanel();
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4">
      {/* Toast */}
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
        tenantId="tenant-demo"
        actions={
          <button
            onClick={openCreatePanel}
            className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors shadow-md shadow-blue-100"
          >
            + {t.new}
          </button>
        }
      />

      {/* Búsqueda */}
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={t.search}
        className="w-full md:max-w-md rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none shadow-sm focus:border-blue-500 transition-all"
      />

      {/* Tabla */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {[t.username, t.fullName, t.email, t.level, t.active, t.actions].map((h) => (
                <th key={h} className="px-5 py-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredRows.length === 0 ? (
              <tr><td colSpan={6} className="py-16 text-center text-slate-400">{t.noResults}</td></tr>
            ) : (
              filteredRows.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-4 font-bold text-slate-700">{item.username}</td>
                  <td className="px-5 py-4 text-slate-600">{item.fullName}</td>
                  <td className="px-5 py-4 text-slate-400 text-xs">{item.email}</td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-bold text-indigo-600">
                      {t.levelLabel} {item.level}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
                      item.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}>
                      {item.active ? t.active : t.inactive}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-3 flex-wrap">
                      <button onClick={() => openEditPanel(item)}
                        className="text-blue-600 hover:text-blue-800 font-semibold text-xs">
                        {t.edit}
                      </button>
                      <button onClick={() => handleToggleActive(item)}
                        className={`font-semibold text-xs ${item.active ? "text-red-500 hover:text-red-700" : "text-emerald-600 hover:text-emerald-800"}`}>
                        {item.active ? t.deactivate : t.activate}
                      </button>
                      <button onClick={() => openPwdPanel(item)}
                        className="text-slate-400 hover:text-slate-700 font-semibold text-xs">
                        🔑 {t.changePassword}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Drawer: Crear / Editar usuario ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closePanel} />
          <div className="relative h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto flex flex-col">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">
                {editingId ? t.edit : t.new}
              </h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <form onSubmit={handleSave} className="flex-1 px-8 py-6 flex flex-col gap-5">

              <UField label={t.username} error={errors.username}>
                <input name="username" value={form.username} onChange={handleChange}
                  placeholder="Ej: jperez" className={uInputCls(errors.username)}
                  // No permitir cambiar username al editar
                  disabled={!!editingId}
                />
              </UField>

              <UField label={t.fullName} error={errors.fullName}>
                <input name="fullName" value={form.fullName} onChange={handleChange}
                  placeholder="Ej: Juan Pérez" className={uInputCls(errors.fullName)} />
              </UField>

              <UField label={t.email} error={errors.email}>
                <input type="email" name="email" value={form.email} onChange={handleChange}
                  placeholder="Ej: juan@empresa.com" className={uInputCls(errors.email)} />
              </UField>

              <UField label={t.level}>
                <select name="level" value={form.level} onChange={handleChange} className={uInputCls()}>
                  {ACCESS_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </UField>

              {/* Contraseña solo visible al crear */}
              {!editingId && (
                <>
                  <UField label={t.password} error={errors.password}>
                    <input type="password" name="password" value={form.password}
                      onChange={handleChange} className={uInputCls(errors.password)} />
                  </UField>
                  <UField label={t.confirmPassword} error={errors.confirmPassword}>
                    <input type="password" name="confirmPassword" value={form.confirmPassword}
                      onChange={handleChange} className={uInputCls(errors.confirmPassword)} />
                  </UField>
                </>
              )}

              <UToggle name="active" checked={form.active} onChange={handleChange}
                label={t.active} color="emerald" />

              <div className="flex gap-3 pt-4 mt-auto">
                <button type="submit"
                  className="flex-1 bg-blue-700 text-white py-3.5 rounded-xl font-black uppercase tracking-widest text-sm hover:bg-blue-800 transition-all">
                  {editingId ? t.update : t.save}
                </button>
                <button type="button" onClick={closePanel}
                  className="flex-1 border-2 border-slate-100 py-3.5 rounded-xl font-black uppercase tracking-widest text-sm text-slate-400 hover:border-slate-200">
                  {t.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Panel: Cambio de contraseña ── */}
      {pwdPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closePwdPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-lg font-black text-slate-800 mb-1">{t.changePassword}</h2>
            <p className="text-xs text-slate-400 mb-6">@{pwdPanel.username}</p>

            <form onSubmit={handlePwdSave} className="flex flex-col gap-4">
              <UField label={t.newPassword} error={pwdErrors.newPassword}>
                <input type="password" name="newPassword" value={pwdForm.newPassword}
                  onChange={handlePwdChange} className={uInputCls(pwdErrors.newPassword)} />
              </UField>
              <UField label={t.confirmPassword} error={pwdErrors.confirmPassword}>
                <input type="password" name="confirmPassword" value={pwdForm.confirmPassword}
                  onChange={handlePwdChange} className={uInputCls(pwdErrors.confirmPassword)} />
              </UField>
              <div className="flex gap-3 pt-2">
                <button type="submit"
                  className="flex-1 bg-blue-700 text-white py-3 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-blue-800 transition-all">
                  {t.save}
                </button>
                <button type="button" onClick={closePwdPanel}
                  className="flex-1 border-2 border-slate-100 py-3 rounded-xl font-black text-sm uppercase tracking-widest text-slate-400">
                  {t.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────
const uInputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-3 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent disabled:text-slate-400`;

function UField({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

function UToggle({ name, checked, onChange, label, color = "blue" }) {
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

export default UserManagementPage;