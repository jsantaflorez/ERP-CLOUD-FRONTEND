// UserManagementPage.jsx
import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

// REWRITTEN (2026-10-29, Multiempresa Fase 3): this screen used to be
// 100% mock -- MOCK_USERS, no fetch calls anywhere, a `username` field
// that doesn't even exist on the real User entity. There was also no
// backend for it at all (no UserController). Both now exist:
// UserManagementService/UserManagementController on the backend,
// wired in end to end here.
//
// Scope, to match how every other screen in this app already works:
// everything here operates on the CURRENT company only (whichever one
// is active via the AppHeader switcher). "Roles en esta empresa" is
// the actual access-control surface -- a user with zero roles here
// simply doesn't appear in the list. The user's name and password are
// genuinely GLOBAL (one person, one account, usable across every
// company they have a role in), which is called out explicitly in the
// UI wherever it matters, so an admin never changes those without
// realizing the blast radius reaches beyond the current company.

const initialForm = {
  email: "",
  firstName: "",
  lastName: "",
  password: "",
  confirmPassword: "",
  roleIds: [],
};

function UserManagementPage({ language = "es" }) {
  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const [rows, setRows] = useState([]);
  const [rolesCatalog, setRolesCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState(null);

  // Create/edit drawer. editingUser === null means "create" mode.
  const [open, setOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Create-mode only: resolves whether the typed email already belongs
  // to a registered user elsewhere, so the form can skip straight to
  // "pick roles" instead of asking for a name/password that would just
  // be ignored by the backend anyway.
  const [emailLookup, setEmailLookup] = useState({ checked: false, checking: false, exists: false, fullName: null });

  // Per-role checkbox busy state in edit mode, keyed "userId-roleId" --
  // each toggle calls the backend immediately, this just disables that
  // one checkbox while its own call is in flight.
  const [roleBusy, setRoleBusy] = useState(null);

  // Password-reset panel.
  const [pwdPanel, setPwdPanel] = useState(null); // { id, email }
  const [pwdForm, setPwdForm] = useState({ newPassword: "", confirmPassword: "" });
  const [pwdErrors, setPwdErrors] = useState({});
  const [savingPwd, setSavingPwd] = useState(false);

  // Confirmation gate for the GLOBAL active flag -- the one action here
  // whose effect reaches beyond the current company.
  const [toggleTarget, setToggleTarget] = useState(null);
  const [togglingActive, setTogglingActive] = useState(false);

  const t = {
    es: {
      title: "Gestión de Usuarios", subtitle: "Usuarios y roles de esta empresa",
      new: "Agregar Usuario", edit: "Editar", save: "Guardar", saving: "Guardando...",
      cancel: "Cancelar", close: "Cerrar", search: "Buscar usuario...",
      email: "Correo", firstName: "Nombre", lastName: "Apellido",
      actions: "Acciones", required: "Obligatorio",
      activate: "Activar cuenta", deactivate: "Desactivar cuenta",
      changePassword: "Cambiar Contraseña", password: "Contraseña",
      confirmPassword: "Confirmar Contraseña", passwordMismatch: "Las contraseñas no coinciden",
      passwordMin: "Mínimo 6 caracteres", noResults: "No hay usuarios en esta empresa todavía.",
      successCreate: "¡Usuario guardado!", successUpdate: "¡Nombre actualizado!",
      successToggle: "Estado de la cuenta actualizado.", successPassword: "¡Contraseña actualizada!",
      successRoleAdded: "Rol asignado.", successRoleRemoved: "Rol retirado.",
      successRevoked: "Usuario retirado de esta empresa.",
      errorConn: "Error de conexión.",
      newPassword: "Nueva Contraseña",
      rolesInCompany: "Roles en esta empresa",
      noRolesAvailable: "No hay roles configurados para esta empresa.",
      noRolesSelected: "Selecciona al menos un rol.",
      checkingEmail: "Verificando...",
      existingUserNote: (name) => `Usuario existente: ${name}. Se le dará acceso a esta empresa con los roles seleccionados — su nombre y contraseña actuales no cambian.`,
      accountGlobalLabel: "Cuenta (global, afecta todas sus empresas)",
      accountGlobalWarning: "Esta acción afecta el acceso del usuario en TODAS las empresas donde tiene roles, no solo en esta. La contraseña funciona igual en todas partes.",
      confirmDeactivateTitle: "Confirmar desactivación de cuenta",
      confirmActivateTitle: "Confirmar activación de cuenta",
      removeFromCompany: "Quitar de esta empresa",
      confirmRemoveFromCompany: "¿Quitar a este usuario de esta empresa? Perderá acceso solo aquí — sus otras empresas, si tiene, no se ven afectadas.",
      manageInThisPanel: "Los cambios de rol se aplican de inmediato.",
      newUserHint: "Si el correo no existe todavía en el sistema, se creará una cuenta nueva.",
    },
    en: {
      title: "User Management", subtitle: "Users and roles for this company",
      new: "Add User", edit: "Edit", save: "Save", saving: "Saving...",
      cancel: "Cancel", close: "Close", search: "Search user...",
      email: "Email", firstName: "First Name", lastName: "Last Name",
      actions: "Actions", required: "Required",
      activate: "Activate account", deactivate: "Deactivate account",
      changePassword: "Change Password", password: "Password",
      confirmPassword: "Confirm Password", passwordMismatch: "Passwords don't match",
      passwordMin: "Minimum 6 characters", noResults: "No users in this company yet.",
      successCreate: "User saved!", successUpdate: "Name updated!",
      successToggle: "Account status updated.", successPassword: "Password updated!",
      successRoleAdded: "Role assigned.", successRoleRemoved: "Role removed.",
      successRevoked: "User removed from this company.",
      errorConn: "Connection error.",
      newPassword: "New Password",
      rolesInCompany: "Roles in this company",
      noRolesAvailable: "No roles configured for this company.",
      noRolesSelected: "Select at least one role.",
      checkingEmail: "Checking...",
      existingUserNote: (name) => `Existing user: ${name}. They will be granted access to this company with the selected roles -- their current name and password don't change.`,
      accountGlobalLabel: "Account (global, affects every company)",
      accountGlobalWarning: "This affects the user's access in EVERY company where they have roles, not just this one. Their password works the same way everywhere.",
      confirmDeactivateTitle: "Confirm account deactivation",
      confirmActivateTitle: "Confirm account activation",
      removeFromCompany: "Remove from this company",
      confirmRemoveFromCompany: "Remove this user from this company? They lose access only here -- their other companies, if any, are unaffected.",
      manageInThisPanel: "Role changes apply immediately.",
      newUserHint: "If this email doesn't exist yet in the system, a brand-new account will be created.",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Carga inicial ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setListError(null);

    Promise.all([api.get("/v1/users"), api.get("/v1/roles")])
      .then(([usersRes, rolesRes]) => {
        if (cancelled) return;
        setRows(Array.isArray(usersRes.data?.data) ? usersRes.data.data : []);
        setRolesCatalog(Array.isArray(rolesRes.data?.data) ? rolesRes.data.data : []);
      })
      .catch((err) => {
        if (!cancelled) setListError(getApiErrorMessage(err, language, t.errorConn));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyId]);

  // ── Filtro ───────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.fullName?.toLowerCase().includes(term) ||
        r.email?.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  const roleLabel = (r) => r.roleName;

  // ── Drawer: abrir/cerrar ─────────────────────────────────────────
  const closePanel = () => {
    setOpen(false);
    setEditingUser(null);
    setForm(initialForm);
    setErrors({});
    setFormError(null);
    setEmailLookup({ checked: false, checking: false, exists: false, fullName: null });
  };

  const openCreatePanel = () => {
    setEditingUser(null);
    setForm(initialForm);
    setErrors({});
    setFormError(null);
    setEmailLookup({ checked: false, checking: false, exists: false, fullName: null });
    setOpen(true);
  };

  const openEditPanel = (user) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      password: "",
      confirmPassword: "",
      roleIds: [],
    });
    setErrors({});
    setFormError(null);
    setOpen(true);
  };

  // ── Lookup de correo (solo modo creación) ──────────────────────
  const handleEmailBlur = async () => {
    if (editingUser) return;
    const email = form.email.trim().toLowerCase();
    if (!email) return;

    setEmailLookup((prev) => ({ ...prev, checking: true }));
    try {
      const res = await api.get("/v1/users/lookup", { params: { email } });
      const data = res.data?.data || { exists: false, fullName: null };
      setEmailLookup({ checked: true, checking: false, exists: !!data.exists, fullName: data.fullName || null });
    } catch {
      setEmailLookup({ checked: false, checking: false, exists: false, fullName: null });
    }
  };

  const handleEmailChange = (e) => {
    setForm((prev) => ({ ...prev, email: e.target.value }));
    setEmailLookup({ checked: false, checking: false, exists: false, fullName: null });
  };

  const toggleCreateRole = (roleId, checked) => {
    setForm((prev) => ({
      ...prev,
      roleIds: checked ? [...prev.roleIds, roleId] : prev.roleIds.filter((id) => id !== roleId),
    }));
  };

  // ── Guardar (crear / invitar) ───────────────────────────────────
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.email.trim()) errs.email = t.required;
    if (!emailLookup.exists) {
      if (!form.firstName.trim()) errs.firstName = t.required;
      if (!form.lastName.trim()) errs.lastName = t.required;
      if (!form.password || form.password.length < 6) errs.password = t.passwordMin;
      if (form.password !== form.confirmPassword) errs.confirmPassword = t.passwordMismatch;
    }
    if (form.roleIds.length === 0) errs.roles = t.noRolesSelected;
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        email: form.email.trim().toLowerCase(),
        firstName: emailLookup.exists ? null : form.firstName.trim(),
        lastName: emailLookup.exists ? null : form.lastName.trim(),
        password: emailLookup.exists ? null : form.password,
        roleIds: form.roleIds,
      };
      const res = await api.post("/v1/users", payload);
      const saved = res.data?.data;
      setRows((prev) => {
        const existingIdx = prev.findIndex((r) => r.id === saved.id);
        if (existingIdx === -1) return [...prev, saved];
        const copy = [...prev];
        copy[existingIdx] = saved;
        return copy;
      });
      showToast(t.successCreate);
      closePanel();
    } catch (err) {
      setFormError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setSaving(false);
    }
  };

  // ── Guardar nombre (modo edición) ───────────────────────────────
  const handleUpdateName = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setErrors({ firstName: !form.firstName.trim() ? t.required : undefined, lastName: !form.lastName.trim() ? t.required : undefined });
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await api.patch(`/v1/users/${editingUser.id}`, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      });
      const updated = res.data?.data;
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditingUser(updated);
      showToast(t.successUpdate);
    } catch (err) {
      setFormError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setSaving(false);
    }
  };

  // ── Roles en esta empresa (aplican de inmediato) ───────────────
  const handleToggleRole = async (role, checked) => {
    if (!editingUser) return;
    const key = `${editingUser.id}-${role.id}`;
    setRoleBusy(key);
    try {
      const res = checked
        ? await api.post(`/v1/users/${editingUser.id}/roles/${role.id}`)
        : await api.delete(`/v1/users/${editingUser.id}/roles/${role.id}`);
      const updated = res.data?.data;
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditingUser(updated);
      showToast(checked ? t.successRoleAdded : t.successRoleRemoved);
    } catch (err) {
      showToast(getApiErrorMessage(err, language, t.errorConn), "error");
    } finally {
      setRoleBusy(null);
    }
  };

  // ── Cuenta global: activar/desactivar (con confirmación) ───────
  const confirmToggleActive = async () => {
    if (!toggleTarget) return;
    setTogglingActive(true);
    try {
      const res = await api.patch(`/v1/users/${toggleTarget.id}/toggle-active`);
      const updated = res.data?.data;
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      if (editingUser?.id === updated.id) setEditingUser(updated);
      showToast(t.successToggle);
      setToggleTarget(null);
    } catch (err) {
      showToast(getApiErrorMessage(err, language, t.errorConn), "error");
    } finally {
      setTogglingActive(false);
    }
  };

  // ── Quitar de esta empresa ──────────────────────────────────────
  const handleRemoveFromCompany = async (user) => {
    if (!window.confirm(t.confirmRemoveFromCompany)) return;
    try {
      await api.delete(`/v1/users/${user.id}/company-access`);
      setRows((prev) => prev.filter((r) => r.id !== user.id));
      if (editingUser?.id === user.id) closePanel();
      showToast(t.successRevoked);
    } catch (err) {
      showToast(getApiErrorMessage(err, language, t.errorConn), "error");
    }
  };

  // ── Cambio de contraseña ─────────────────────────────────────────
  const openPwdPanel = (user) => {
    setPwdPanel({ id: user.id, email: user.email });
    setPwdForm({ newPassword: "", confirmPassword: "" });
    setPwdErrors({});
  };
  const closePwdPanel = () => setPwdPanel(null);

  const handlePwdSave = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!pwdForm.newPassword || pwdForm.newPassword.length < 6) errs.newPassword = t.passwordMin;
    if (pwdForm.newPassword !== pwdForm.confirmPassword) errs.confirmPassword = t.passwordMismatch;
    setPwdErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSavingPwd(true);
    try {
      await api.patch(`/v1/users/${pwdPanel.id}/password`, { newPassword: pwdForm.newPassword });
      showToast(t.successPassword);
      closePwdPanel();
    } catch (err) {
      setPwdErrors({ form: getApiErrorMessage(err, language, t.errorConn) });
    } finally {
      setSavingPwd(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────
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
        language={language}
        actions={
          <button
            onClick={openCreatePanel}
            className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors shadow-md shadow-blue-100"
          >
            + {t.new}
          </button>
        }
      />

      <input
        type="text" autoComplete="off" name="userSearch"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={t.search}
        className="w-full md:max-w-md rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none shadow-sm focus:border-blue-500 transition-all"
      />

      {listError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {listError}
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {[t.firstName, t.email, t.rolesInCompany, t.accountGlobalLabel, t.actions].map((h) => (
                <th key={h} className="px-5 py-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={5} className="py-16 text-center text-slate-400">...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={5} className="py-16 text-center text-slate-400">{t.noResults}</td></tr>
            ) : (
              filteredRows.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-4 font-bold text-slate-700">{item.fullName}</td>
                  <td className="px-5 py-4 text-slate-400 text-xs">{item.email}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {item.roles.length === 0 ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : (
                        item.roles.map((r) => (
                          <span key={r.roleId} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-600">
                            {roleLabel(r)}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
                      item.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}>
                      {item.active ? t.activate.replace("Activar ", "").replace("Activate ", "") : t.deactivate.replace("Desactivar ", "").replace("Deactivate ", "")}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => openEditPanel(item)}
                      className="text-blue-600 hover:text-blue-800 font-semibold text-xs">
                      {t.edit}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer: crear / editar */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="absolute inset-0 bg-slate-900/20" onClick={closePanel} />
          <div className="relative h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto flex flex-col">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">
                {editingUser ? t.edit : t.new}
              </h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>

            <div className="flex-1 px-8 py-6 flex flex-col gap-5">
              {formError && (
                <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}

              {!editingUser && (
                <p className="text-[11px] text-slate-400">{t.newUserHint}</p>
              )}

              <form onSubmit={editingUser ? handleUpdateName : handleCreateSubmit} className="flex flex-col gap-5">
                <UField label={t.email} error={errors.email}>
                  <input type="email" name="email" autoComplete="email" value={form.email} onChange={handleEmailChange} onBlur={handleEmailBlur}
                    disabled={!!editingUser}
                    placeholder="Ej: juan@empresa.com" className={uInputCls(errors.email)} />
                </UField>

                {!editingUser && emailLookup.checking && (
                  <p className="text-[11px] text-slate-400">{t.checkingEmail}</p>
                )}
                {!editingUser && emailLookup.checked && emailLookup.exists && (
                  <p className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                    {t.existingUserNote(emailLookup.fullName)}
                  </p>
                )}

                {(editingUser || !emailLookup.exists) && (
                  <>
                    <UField label={t.firstName} error={errors.firstName}>
                      <input name="firstName" autoComplete="given-name" value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                        placeholder="Ej: Juan" className={uInputCls(errors.firstName)} />
                    </UField>
                    <UField label={t.lastName} error={errors.lastName}>
                      <input name="lastName" autoComplete="family-name" value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
                        placeholder="Ej: Pérez" className={uInputCls(errors.lastName)} />
                    </UField>
                  </>
                )}

                {!editingUser && !emailLookup.exists && (
                  <>
                    <UField label={t.password} error={errors.password}>
                      <input type="password" name="newUserPassword" autoComplete="new-password" value={form.password}
                        onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                        className={uInputCls(errors.password)} />
                    </UField>
                    <UField label={t.confirmPassword} error={errors.confirmPassword}>
                      <input type="password" name="newUserPasswordConfirm" autoComplete="new-password" value={form.confirmPassword}
                        onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                        className={uInputCls(errors.confirmPassword)} />
                    </UField>
                  </>
                )}

                {!editingUser && (
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.rolesInCompany}</span>
                    {rolesCatalog.length === 0 ? (
                      <p className="text-xs text-slate-400">{t.noRolesAvailable}</p>
                    ) : (
                      rolesCatalog.map((role) => (
                        <label key={role.id} className="flex items-center gap-2 text-sm text-slate-600">
                          <input type="checkbox" checked={form.roleIds.includes(role.id)}
                            onChange={(e) => toggleCreateRole(role.id, e.target.checked)} />
                          {role.name}
                        </label>
                      ))
                    )}
                    {errors.roles && <span className="text-[10px] text-red-500">{errors.roles}</span>}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button type="submit" variant="primary" fullWidth loading={saving}>
                    {saving ? t.saving : t.save}
                  </Button>
                  <Button type="button" variant="secondary" fullWidth onClick={closePanel}>
                    {t.cancel}
                  </Button>
                </div>
              </form>

              {editingUser && (
                <>
                  <div className="border-t border-slate-100 pt-5 flex flex-col gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.rolesInCompany}</span>
                    <p className="text-[11px] text-slate-400">{t.manageInThisPanel}</p>
                    {rolesCatalog.length === 0 ? (
                      <p className="text-xs text-slate-400">{t.noRolesAvailable}</p>
                    ) : (
                      rolesCatalog.map((role) => {
                        const checked = editingUser.roles.some((r) => r.roleId === role.id);
                        const busy = roleBusy === `${editingUser.id}-${role.id}`;
                        return (
                          <label key={role.id} className="flex items-center gap-2 text-sm text-slate-600">
                            <input type="checkbox" checked={checked} disabled={busy}
                              onChange={(e) => handleToggleRole(role, e.target.checked)} />
                            {role.name}
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div className="border-t border-slate-100 pt-5 flex flex-col gap-3">
                    <button onClick={() => openPwdPanel(editingUser)}
                      className="text-left text-slate-500 hover:text-slate-800 font-semibold text-xs">
                      🔑 {t.changePassword}
                    </button>

                    <button onClick={() => setToggleTarget(editingUser)}
                      className={`text-left font-semibold text-xs ${editingUser.active ? "text-red-500 hover:text-red-700" : "text-emerald-600 hover:text-emerald-800"}`}>
                      {editingUser.active ? t.deactivate : t.activate}
                    </button>

                    <button onClick={() => handleRemoveFromCompany(editingUser)}
                      className="text-left text-red-600 hover:text-red-800 font-semibold text-xs">
                      {t.removeFromCompany}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Panel: cambio de contraseña */}
      {pwdPanel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/20" onClick={closePwdPanel} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-lg font-black text-slate-800 mb-1">{t.changePassword}</h2>
            <p className="text-xs text-slate-400 mb-6">{pwdPanel.email}</p>

            {pwdErrors.form && (
              <p className="mb-4 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {pwdErrors.form}
              </p>
            )}

            <form onSubmit={handlePwdSave} className="flex flex-col gap-4">
              <UField label={t.newPassword} error={pwdErrors.newPassword}>
                <input type="password" name="changePwdNew" autoComplete="new-password" value={pwdForm.newPassword}
                  onChange={(e) => setPwdForm((p) => ({ ...p, newPassword: e.target.value }))}
                  className={uInputCls(pwdErrors.newPassword)} />
              </UField>
              <UField label={t.confirmPassword} error={pwdErrors.confirmPassword}>
                <input type="password" name="changePwdConfirm" autoComplete="new-password" value={pwdForm.confirmPassword}
                  onChange={(e) => setPwdForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                  className={uInputCls(pwdErrors.confirmPassword)} />
              </UField>
              <div className="flex gap-3 pt-2">
                <Button type="submit" variant="primary" fullWidth loading={savingPwd}>
                  {savingPwd ? t.saving : t.save}
                </Button>
                <Button type="button" variant="secondary" fullWidth onClick={closePwdPanel}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: confirmar cambio de estado GLOBAL de la cuenta */}
      {toggleTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => !togglingActive && setToggleTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-black text-slate-800">
                {toggleTarget.active ? t.confirmDeactivateTitle : t.confirmActivateTitle}
              </h2>
            </div>
            <div className="flex flex-col gap-4 px-6 py-5">
              <p className="text-sm font-semibold text-slate-700">{toggleTarget.fullName}</p>
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700">
                {t.accountGlobalWarning}
              </p>
              <div className="flex gap-3 pt-1">
                <Button type="button" variant="danger" fullWidth loading={togglingActive} onClick={confirmToggleActive}>
                  {toggleTarget.active ? t.deactivate : t.activate}
                </Button>
                <Button type="button" variant="secondary" fullWidth disabled={togglingActive} onClick={() => setToggleTarget(null)}>
                  {t.cancel}
                </Button>
              </div>
            </div>
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

export default UserManagementPage;
