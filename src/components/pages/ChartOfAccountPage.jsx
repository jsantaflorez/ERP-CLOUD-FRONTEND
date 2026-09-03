import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api"; // Centralized Axios instance with multi-tenancy context
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage, API_ERROR_LABELS } from "../../constants/apiErrors";

const initialForm = {
  code: "",
  name: "",
  nature: "D",
  accountClass: "",
  accountCategory: "",
  financialStatement: "",
  postingAccount: false,
  requiresThirdParty: false,
  requiresCostCenter: false,
  active: true,
  parentId: "",
};

// FIX: ACCOUNT_CLASS_OPTIONS / ACCOUNT_CATEGORY_OPTIONS /
// FINANCIAL_STATEMENT_OPTIONS + their *_LABELS dictionaries used to be
// hardcoded here — a duplicate, hand-maintained copy of the backend's
// AccountClass/AccountCategory/FinancialStatement enums. That's exactly
// how ACCOUNT_CATEGORY_OPTIONS drifted (19 invented values vs. the real
// 44), causing a runtime Jackson deserialization error when the user
// picked a category that doesn't exist. Those enums ALREADY carry
// getDisplayName()/getDisplayNameEs() in Java, so instead of maintaining
// a second copy in JS, this page now fetches them once from
// GET /v1/chart-of-accounts/metadata (see loadMetadata below) — the
// backend enum is the single source of truth, and this page can never
// drift out of sync with it again.

// Looks up the display label for a given enum value (e.g. "ASSET") inside
// a metadata list loaded from the backend (shape: { value, displayName,
// displayNameEs }), picking the field that matches the active language.
// Falls back to the raw value if metadata hasn't loaded yet or doesn't
// contain a match, so the UI never shows a blank cell.
const getMetadataLabel = (list, value, language) => {
  if (!value) return null;
  const match = list.find((item) => item.value === value);
  if (!match) return value;
  return language === "es" ? match.displayNameEs : match.displayName;
};

// Mirrors ChartOfAccountService.validateCodeStructure exactly (PUC —
// Colombian Chart of Accounts structure rules), so the user sees a
// structural problem with the code immediately instead of only after a
// failed save. Returns one of apiErrors.js's error codes, or null if the
// code structure is valid. Reuses those same codes/translations rather
// than duplicating the wording a third time — this stays identical to
// what the backend would return if this check were ever bypassed.
const getCodeStructureErrorCode = (code, parentId, isPostingAccount, rows) => {
  if (!code) return null; // empty code is handled by the required-field check

  const codeLength = code.length;

  if (isPostingAccount && codeLength < 6) {
    return "POSTING_ACCOUNT_CODE_TOO_SHORT";
  }

  if (!parentId) {
    if (codeLength !== 1) {
      return "ROOT_ACCOUNT_CODE_INVALID_LENGTH";
    }
    return null;
  }

  const parent = rows.find((r) => String(r.id) === String(parentId));
  if (!parent) return null; // parent lookup issues are surfaced elsewhere

  const parentCode = parent.code;
  const parentLength = parentCode.length;

  if (!code.startsWith(parentCode)) {
    return "CHILD_CODE_MUST_START_WITH_PARENT";
  }

  const isValidJump =
    (parentLength === 1 && codeLength === 2) ||
    (parentLength === 2 && codeLength === 4) ||
    (parentLength >= 4 && codeLength === parentLength + 2);

  if (!isValidJump) {
    return "INVALID_CODE_STRUCTURE";
  }

  return null;
};

// Mirrors ChartOfAccountService.getExpectedLength — used only to show a
// proactive hint ("expect N digits") near the code field, not for
// validation itself (getCodeStructureErrorCode handles that).
const getExpectedCodeLength = (parentId, rows) => {
  if (!parentId) return 1;
  const parent = rows.find((r) => String(r.id) === String(parentId));
  if (!parent) return null;
  const parentLength = parent.code.length;
  if (parentLength === 1) return 2;
  if (parentLength === 2) return 4;
  return parentLength + 2;
};

// Returns the set of ids that are descendants (children, grandchildren, ...)
// of a given account, based on the parentCode links available on each row
// (accounts list items expose parentCode/parentName as denormalized display
// fields — there's no raw parentId per row, only a resolved id via lookup
// in openEditPanel). Used to keep the "Cuenta Padre" selector from offering
// a descendant as a parent, which would create a circular reference in the
// hierarchy.
const getDescendantIds = (code, rows) => {
  const descendants = new Set();
  const stack = [code];
  while (stack.length > 0) {
    const currentCode = stack.pop();
    for (const row of rows) {
      if (row.parentCode === currentCode && !descendants.has(row.id)) {
        descendants.add(row.id);
        stack.push(row.code);
      }
    }
  }
  return descendants;
};

// The backend rejects postingAccount=true on any account that has
// sub-accounts (a header/parent account should never receive direct
// postings — only its leaf-level children should, to avoid double-
// counting in the financial statements). This mirrors that rule on the
// frontend so the user sees it immediately instead of discovering it via
// a failed save. Based on parentCode links, same as getDescendantIds.
const hasChildren = (code, rows) => rows.some((r) => r.parentCode === code);

function ChartOfAccountsPage({ language = "es" }) {
  const [rows, setRows]             = useState([]);
  const [form, setForm]             = useState(initialForm);
  const [errors, setErrors]         = useState({});
  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading]       = useState(false);
  const [toast, setToast]           = useState(null);

  // Snapshot of `code` at the moment editing started. Used as a
  // defense-in-depth guard in handleSave: even though the field is
  // rendered readOnly while editing, this ensures the payload can never
  // carry a different value than what was actually loaded, regardless of
  // any client-side tampering with the DOM/readOnly attribute — mirrors
  // the backend's own immutability rule on `code`.
  const originalCodeRef = useRef(null);

  // NEW: dynamically loaded from GET /v1/chart-of-accounts/metadata,
  // replacing the old hardcoded ACCOUNT_CLASS_OPTIONS/ACCOUNT_CATEGORY_OPTIONS/
  // FINANCIAL_STATEMENT_OPTIONS + their *_LABELS dictionaries. Each entry
  // has the shape { value, displayName, displayNameEs }.
  const [accountClasses, setAccountClasses]           = useState([]);
  const [accountCategories, setAccountCategories]     = useState([]);
  const [financialStatements, setFinancialStatements] = useState([]);
  const [loadingMetadata, setLoadingMetadata]         = useState(false);

  // Reference pointer to guarantee consistent identity states during transactional operations
  const editingIdRef = useRef(null);

  // Resolve active multi-tenant identifier from AuthContext (reactive —
  // updates automatically if switchCompany() runs), instead of reading
  // localStorage directly, which wouldn't trigger a re-render.
  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Plan de Cuentas",
      subtitle: "Estructura Contable y Financiera Principal",
      new: "Nuevo",
      edit: "Editar",
      save: "Guardar",
      update: "Actualizar",
      cancel: "Cancelar",
      search: "Buscar por código, nombre o categoría...",
      code: "Código",
      name: "Nombre",
      level: "Nivel",
      nature: "Naturaleza",
      debit: "Débito",
      credit: "Crédito",
      accountClass: "Clase",
      accountCategory: "Categoría",
      financialStatement: "Estado Financiero",
      postingAccount: "Cuenta de Movimiento",
      noPostingAccount: "Cuenta Mayor",
      requiresThirdParty: "Requiere Tercero",
      requiresCostCenter: "Requiere C. Costo",
      noRequiresThirdParty: "Sin Tercero",
      noRequiresCostCenter: "Sin C. Costo",
      active: "Activo",
      inactive: "Inactivo",
      parent: "Cuenta Padre",
      noParent: "— Sin padre —",
      actions: "Acciones",
      required: "Campo obligatorio",
      deactivate: "Desactivar",
      activate: "Activar",
      noResults: "Sin registros",
      confirmDeactivate: "¿Desactivar esta cuenta?",
      confirmActivate: "¿Activar esta cuenta?",
      successCreate: "¡Cuenta creada!",
      successUpdate: "¡Actualizada correctamente!",
      successDeactivate: "Cuenta desactivada.",
      successActivate: "Cuenta activada.",
      errorConn: "Error de conexión con el servidor.",
      selectOption: "Seleccione...",
      selectClassFirst: "Seleccione primero una clase",
      categoryHint: "Mostrando categorías aplicables para:",
      loading: "Cargando...",
      loadingMetadata: "Cargando opciones...",
      codeLockedHint: "El código no se puede modificar una vez creada la cuenta.",
      expectedCodeLengthHint: "Se espera un código de",
      expectedCodeLengthHintDigits: "dígitos.",
      postingBlockedByChildren: "No puede ser cuenta de movimiento porque tiene subcuentas asociadas.",
      parentIsPostingWarning: "Esta cuenta padre es de movimiento. Debes desmarcar \"Cuenta de Movimiento\" en ella antes de guardar, o el backend rechazará el cambio.",
    },
    en: {
      title: "Chart of Accounts",
      subtitle: "Core Accounting and Financial Structure",
      new: "New",
      edit: "Edit",
      save: "Save",
      update: "Update",
      cancel: "Cancel",
      search: "Search by code, name or category...",
      code: "Code",
      name: "Name",
      level: "Level",
      nature: "Nature",
      debit: "Debit",
      credit: "Credit",
      accountClass: "Class",
      accountCategory: "Category",
      financialStatement: "Financial Statement",
      postingAccount: "Posting Account",
      noPostingAccount: "Header Account",
      requiresThirdParty: "Requires Third Party",
      requiresCostCenter: "Requires Cost Center",
      noRequiresThirdParty: "No Third Party",
      noRequiresCostCenter: "No Cost Center",
      active: "Active",
      inactive: "Inactive",
      parent: "Parent Account",
      noParent: "— No parent —",
      actions: "Actions",
      required: "Required field",
      deactivate: "Deactivate",
      activate: "Activate",
      noResults: "No records",
      confirmDeactivate: "Deactivate this account?",
      confirmActivate: "Activate this account?",
      successCreate: "Account created!",
      successUpdate: "Updated successfully!",
      successDeactivate: "Account deactivated.",
      successActivate: "Account activated.",
      errorConn: "Server connection error.",
      selectOption: "Select...",
      selectClassFirst: "Select a class first",
      categoryHint: "Showing categories applicable to:",
      loading: "Loading...",
      loadingMetadata: "Loading options...",
      codeLockedHint: "The code can't be changed once the account is created.",
      expectedCodeLengthHint: "Expected code length:",
      expectedCodeLengthHintDigits: "digits.",
      postingBlockedByChildren: "Can't be a posting account because it has sub-accounts.",
      parentIsPostingWarning: "This parent account is a posting account. You must uncheck \"Posting Account\" on it before saving, or the backend will reject the change.",
    },
  }[language];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  /**
   * Dispatches asynchronous fetch via Axios targeting database ledger definitions.
   */
  const loadAccounts = async () => {
    setLoading(true);
    try {
      // Retaining standard sorting options via Spring request params
      const response = await api.get("/v1/chart-of-accounts", {
        params: { size: 200, sort: "code" }
      });

      if (response.data && response.data.success) {
        const payloadData = response.data.data;
        // Fallback protection check to support both PageImpl wrappers and linear collections
        const accountsList = Array.isArray(payloadData)
          ? payloadData
          : (Array.isArray(payloadData?.content) ? payloadData.content : []);
        setRows(accountsList);
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
   * NEW: fetches the AccountClass/AccountCategory/FinancialStatement enum
   * values + display names from the backend, replacing the old hardcoded
   * OPTIONS/LABELS constants. The backend enum is now the single source
   * of truth — this page can't drift out of sync with it again.
   */
  const loadMetadata = async () => {
    setLoadingMetadata(true);
    try {
      const response = await api.get("/v1/chart-of-accounts/metadata");
      if (response.data && response.data.success) {
        const data = response.data.data || {};
        setAccountClasses(Array.isArray(data.accountClasses) ? data.accountClasses : []);
        setAccountCategories(Array.isArray(data.accountCategories) ? data.accountCategories : []);
        setFinancialStatements(Array.isArray(data.financialStatements) ? data.financialStatements : []);
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoadingMetadata(false);
    }
  };

  useEffect(() => {
    loadAccounts();
    loadMetadata();
  }, []);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return rows;

    return rows.filter(
      (r) =>
        r.code?.toLowerCase().includes(term) ||
        r.name?.toLowerCase().includes(term) ||
        r.accountCategory?.toLowerCase().includes(term) ||
        r.accountCategoryDisplay?.toLowerCase().includes(term) ||
        r.accountClass?.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  // FIX: previously depended on `[rows]` only, while filtering using
  // `editingIdRef.current` — a ref mutation doesn't trigger a re-render or
  // recompute a useMemo, so this could stay stale across different
  // "Editar" clicks whenever `rows` itself hadn't changed (i.e. almost
  // always, since rows only reloads after a save). Now depends on the
  // `editingId` STATE instead, which reliably triggers recomputation.
  // Also now excludes all DESCENDANTS of the account being edited, not
  // just the account itself — previously nothing stopped picking one of
  // an account's own children as its parent, creating a circular
  // reference in the hierarchy.
  const availableParents = useMemo(() => {
    if (editingId == null) return rows;
    const editingRow = rows.find((r) => r.id === editingId);
    if (!editingRow) return rows.filter((r) => r.id !== editingId);
    const descendantIds = getDescendantIds(editingRow.code, rows);
    return rows.filter((r) => r.id !== editingId && !descendantIds.has(r.id));
  }, [rows, editingId]);

  const resetForm = () => {
    setForm(initialForm);
    setErrors({});
    setEditingId(null);
    editingIdRef.current = null;
    originalCodeRef.current = null;
  };

  const openCreatePanel = () => {
    resetForm();
    setOpen(true);
  };

  const openEditPanel = (item) => {
    // FIX: previously matched by BOTH code AND name
    // (`r.code === item.parentCode && r.name === item.parentName`). Code
    // alone should already be the unique key here — requiring the name to
    // match too is fragile: if the parent's `name` was ever updated and
    // the denormalized `item.parentName` on this record is momentarily
    // stale, the match would silently fail and parentId would end up
    // empty even though the correct parent still exists.
    const parentMatch = rows.find((r) => r.code === item.parentCode);

    // Defensive repair: if this account has sub-accounts but was somehow
    // saved with postingAccount=true (legacy data, or a sub-account added
    // afterward through another flow), don't load an inconsistent value
    // into the form — the toggle will be disabled anyway, but this keeps
    // the payload correct even if the user never touches this field.
    const itemHasChildren = hasChildren(item.code, rows);

    // Defensive repair: if this account's stored accountCategory doesn't
    // actually belong to its accountClass (legacy data, or a value that
    // predates the class-based filtering), clear it rather than loading
    // an invalid combination — same reasoning as the handleChange cascade
    // above.
    const categoryStillValid = accountCategories.some(
      (c) => c.value === item.accountCategory && c.accountClass === item.accountClass
    );

    setForm({
      code:               item.code || "",
      name:               item.name || "",
      nature:             item.nature || "D",
      accountClass:       item.accountClass || "",
      accountCategory:    categoryStillValid ? item.accountCategory : "",
      financialStatement: item.financialStatement || "",
      postingAccount:     itemHasChildren ? false : (item.postingAccount ?? false),
      requiresThirdParty: item.requiresThirdParty ?? false,
      requiresCostCenter: item.requiresCostCenter ?? false,
      active:             item.active ?? true,
      parentId:           parentMatch?.id != null ? String(parentMatch.id) : "",
    });

    setErrors({});
    setEditingId(item.id);
    editingIdRef.current = item.id;
    originalCodeRef.current = item.code || "";
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
    resetForm();
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;

    if (name === "code") val = value.toUpperCase().slice(0, 20);
    if (name === "name") val = value.slice(0, 150);

    setForm((prev) => {
      const next = { ...prev, [name]: val };

      // FIX: accountCategory is now filtered by accountClass (see the
      // category <select> below). If accountClass changes, the previously
      // selected category may no longer belong to it (e.g. SALES_REVENUE
      // while switching from REVENUE to ASSET) — clear it instead of
      // silently keeping an inconsistent combination. Unlike taxRegime
      // (which has a sensible default per personType), there's no
      // "canonical" category per class, so this clears to force an
      // explicit re-selection rather than guessing one.
      if (name === "accountClass") {
        const stillValid = accountCategories.some(
          (c) => c.value === prev.accountCategory && c.accountClass === val
        );
        if (!stillValid) {
          next.accountCategory = "";
        }
      }

      return next;
    });
  };

  const validate = () => {
    const errs = {};

    if (!form.code?.trim()) {
      errs.code = t.required;
    } else {
      // NEW: mirrors the backend's PUC structure rules (root = 1 digit,
      // posting accounts >= 6 digits, child code must extend the parent's
      // code by the exact expected jump). Checked against form.parentId
      // as it currently stands — relevant even in edit mode, since `code`
      // stays locked but the user can still reassign the parent, and the
      // backend re-validates the (fixed) code against the NEW parent.
      const structureErrorCode = getCodeStructureErrorCode(
        form.code.trim(),
        form.parentId,
        form.postingAccount,
        rows
      );
      if (structureErrorCode) {
        errs.code = API_ERROR_LABELS[language]?.[structureErrorCode] || structureErrorCode;
      }
    }

    if (!form.name?.trim()) errs.name = t.required;
    if (!form.nature?.trim()) errs.nature = t.required;
    if (!form.accountClass?.trim()) errs.accountClass = t.required;
    if (!form.accountCategory?.trim()) errs.accountCategory = t.required;
    if (!form.financialStatement?.trim()) errs.financialStatement = t.required;

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /**
   * Handles entity updates or creation persistence through REST protocols.
   */
  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const currentId = editingIdRef.current;

    // Defense in depth: even though the toggle is disabled in the UI when
    // this account has sub-accounts, never submit postingAccount=true for
    // a header/parent account — mirrors the backend rule so a stale/
    // inconsistent client-side value can't slip through.
    const editingRow = currentId != null ? rows.find((r) => r.id === currentId) : null;
    const recordHasChildren = editingRow != null && hasChildren(editingRow.code, rows);

    const payload = {
      // Defense in depth: while editing, `code` is locked in the UI, but
      // this guarantees the payload matches what was actually loaded
      // (originalCodeRef) rather than trusting form state — mirrors the
      // backend's own "code is immutable once created" rule. Only a
      // brand-new account (currentId == null) may set this from the form.
      code:               currentId ? originalCodeRef.current : form.code.trim(),
      name:               form.name.trim(),
      nature:             form.nature,
      accountClass:       form.accountClass,
      accountCategory:    form.accountCategory,
      financialStatement: form.financialStatement,
      postingAccount:     recordHasChildren ? false : Boolean(form.postingAccount),
      requiresThirdParty: Boolean(form.requiresThirdParty),
      requiresCostCenter: Boolean(form.requiresCostCenter),
      active:             Boolean(form.active),
      parentId:           form.parentId !== "" ? Number(form.parentId) : null,
    };

    try {
      let response;
      if (currentId) {
        response = await api.put(`/v1/chart-of-accounts/${currentId}`, payload);
      } else {
        response = await api.post("/v1/chart-of-accounts", payload);
      }

      if (response.data && response.data.success) {
        showToast(currentId ? t.successUpdate : t.successCreate);
        closePanel();
        loadAccounts();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * Executes logical soft-deactivation (historical transactions are
   * preserved per the backend's ChartOfAccountsService.deactivate()).
   *
   * Backend controller now maps this as @PatchMapping (previously
   * @DeleteMapping, corrected since deactivate never deletes data — it
   * only flips active=false). Matches every other module's convention
   * (ThirdPartyPage, TaxPage, CostCenterPage, DocumentTypePage).
   *
   * A real hard-delete endpoint may exist in the future for accounts that
   * never had any movements/opening balances — that would be a separate,
   * stricter operation (e.g. a future handleDelete calling
   * DELETE /v1/chart-of-accounts/{id}), not this one.
   */
  const handleDeactivate = async (id) => {
    if (!window.confirm(t.confirmDeactivate)) return;

    try {
      const response = await api.patch(`/v1/chart-of-accounts/${id}/deactivate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successDeactivate);
        loadAccounts();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  /**
   * Enables specific legal nodes inside the tenancy database.
   */
  const handleActivate = async (id) => {
    if (!window.confirm(t.confirmActivate)) return;

    try {
      const response = await api.patch(`/v1/chart-of-accounts/${id}/activate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successActivate);
        loadAccounts();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  // Whether the account currently being edited has sub-accounts — drives
  // both disabling the "Cuenta de Movimiento" toggle and showing its
  // explanatory note below, computed once instead of repeating the lookup
  // inline in JSX.
  const editingAccountHasChildren = useMemo(() => {
    if (editingId == null) return false;
    const editingRow = rows.find((r) => r.id === editingId);
    return editingRow != null && hasChildren(editingRow.code, rows);
  }, [editingId, rows]);

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
                <th className="px-5 py-4">{t.code}</th>
                <th className="px-5 py-4">{t.name}</th>
                <th className="px-5 py-4">{t.level}</th>
                <th className="px-5 py-4">{t.nature}</th>
                <th className="px-5 py-4">{t.accountClass}</th>
                <th className="px-5 py-4">{t.accountCategory}</th>
                <th className="px-5 py-4">{t.financialStatement}</th>
                <th className="px-5 py-4">{t.active}</th>
                <th className="px-5 py-4">{t.postingAccount}</th>
                <th className="px-5 py-4">{t.requiresThirdParty}</th>
                <th className="px-5 py-4">{t.requiresCostCenter}</th>
                <th className="px-5 py-4">{t.actions}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-50">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-16 text-center text-slate-400">
                    {t.noResults}
                  </td>
                </tr>
              ) : (
                filteredRows.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-4 font-bold text-slate-700">{item.code}</td>
                    <td className="px-5 py-4 text-slate-600">{item.name}</td>

                    <td className="px-5 py-4 text-center">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                        {item.level ?? "—"}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <Badge
                        active={item.nature === "D"}
                        labelOn={t.debit}
                        labelOff={t.credit}
                        colorOn="blue"
                      />
                    </td>

                    <td className="px-5 py-4 text-slate-500">
                      {getMetadataLabel(accountClasses, item.accountClass, language) || item.accountClass}
                    </td>

                    <td className="px-5 py-4 text-slate-500">
                      {item.accountCategoryDisplay ||
                        getMetadataLabel(accountCategories, item.accountCategory, language) ||
                        item.accountCategory}
                    </td>

                    <td className="px-5 py-4 text-slate-500">
                      {item.financialStatementDisplay ||
                        getMetadataLabel(financialStatements, item.financialStatement, language) ||
                        item.financialStatement}
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
                        active={item.postingAccount}
                        labelOn={t.postingAccount}
                        labelOff={t.noPostingAccount}
                        colorOn="blue"
                      />
                    </td>

                    <td className="px-5 py-4">
                      <Badge
                        active={item.requiresThirdParty}
                        labelOn={t.requiresThirdParty}
                        labelOff={t.noRequiresThirdParty}
                        colorOn="blue"
                      />
                    </td>

                    <td className="px-5 py-4">
                      <Badge
                        active={item.requiresCostCenter}
                        labelOn={t.requiresCostCenter}
                        labelOff={t.noRequiresCostCenter}
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
              {/* FIX: the backend rejects any change to `code` on update
                  ("Account codes are immutable once created" —
                  ChartOfAccountsService.update()). The field was freely
                  editable here with no indication of that, so a user
                  editing it would only find out via a failed save. Now
                  locked to read-only once editingIdRef.current is set
                  (i.e. only settable at creation time). */}
              <Field label={t.code} error={errors.code}>
                <input
                  name="code"
                  value={form.code}
                  onChange={handleChange}
                  maxLength={20}
                  placeholder="Ej: 110505"
                  readOnly={!!editingIdRef.current}
                  className={`${inputCls(errors.code)} ${editingIdRef.current ? "opacity-60 cursor-not-allowed" : ""}`}
                />
                {editingIdRef.current && (
                  <span className="text-[10px] text-amber-600">{t.codeLockedHint}</span>
                )}
                {/* NEW: proactive hint (create mode only, no error showing
                    yet) — tells the user the expected digit count for the
                    selected parent BEFORE they submit and hit
                    getCodeStructureErrorCode's rejection. */}
                {!editingIdRef.current && !errors.code && (
                  <span className="text-[10px] text-slate-400">
                    {t.expectedCodeLengthHint} {getExpectedCodeLength(form.parentId, rows) ?? "—"} {t.expectedCodeLengthHintDigits}
                  </span>
                )}
              </Field>

              <Field label={t.name} error={errors.name}>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  maxLength={150}
                  placeholder="Ej: Caja General"
                  className={inputCls(errors.name)}
                />
              </Field>

              <Field label={t.nature} error={errors.nature}>
                <select
                  name="nature"
                  value={form.nature}
                  onChange={handleChange}
                  className={inputCls(errors.nature)}
                >
                  <option value="D">D - {t.debit}</option>
                  <option value="C">C - {t.credit}</option>
                </select>
              </Field>

              <Field label={t.parent}>
                <select
                  name="parentId"
                  value={form.parentId}
                  onChange={handleChange}
                  className={inputCls()}
                >
                  <option value="">{t.noParent}</option>
                  {availableParents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Warn (non-blocking) when the chosen parent currently is a
                  posting account — assigning this account as its child
                  would make that parent a non-leaf node with
                  postingAccount=true, which the backend will reject on the
                  PARENT's own record. */}
              {form.parentId !== "" &&
                rows.find((r) => String(r.id) === String(form.parentId))?.postingAccount && (
                  <p className="md:col-span-2 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {t.parentIsPostingWarning}
                  </p>
                )}

              <Field label={t.accountClass} error={errors.accountClass}>
                <select
                  name="accountClass"
                  value={form.accountClass}
                  onChange={handleChange}
                  className={inputCls(errors.accountClass)}
                  disabled={loadingMetadata}
                >
                  <option value="">
                    {loadingMetadata ? t.loadingMetadata : t.selectOption}
                  </option>
                  {accountClasses.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {language === "es" ? opt.displayNameEs : opt.displayName}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t.accountCategory} error={errors.accountCategory}>
                <select
                  name="accountCategory"
                  value={form.accountCategory}
                  onChange={handleChange}
                  className={inputCls(errors.accountCategory)}
                  disabled={loadingMetadata || !form.accountClass}
                >
                  <option value="">
                    {loadingMetadata
                      ? t.loadingMetadata
                      : !form.accountClass
                        ? t.selectClassFirst
                        : t.selectOption}
                  </option>
                  {/* FIX: previously showed all 44 categories regardless of
                      the selected accountClass — a user could pick e.g.
                      SALES_REVENUE (a REVENUE category) on an ASSET
                      account. Now filtered via the accountClass field the
                      backend's /metadata endpoint attaches to each
                      category, same cascading pattern used for
                      taxRegime/personType in ThirdPartyPage. */}
                  {accountCategories
                    .filter((opt) => opt.accountClass === form.accountClass)
                    .map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {language === "es" ? opt.displayNameEs : opt.displayName}
                      </option>
                    ))}
                </select>
                {form.accountClass && !loadingMetadata && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {t.categoryHint}{" "}
                    <strong>
                      {getMetadataLabel(accountClasses, form.accountClass, language)}
                    </strong>
                  </p>
                )}
              </Field>

              <div className="md:col-span-2">
                <Field label={t.financialStatement} error={errors.financialStatement}>
                  <select
                    name="financialStatement"
                    value={form.financialStatement}
                    onChange={handleChange}
                    className={inputCls(errors.financialStatement)}
                    disabled={loadingMetadata}
                  >
                    <option value="">
                      {loadingMetadata ? t.loadingMetadata : t.selectOption}
                    </option>
                    {financialStatements.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {language === "es" ? opt.displayNameEs : opt.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="md:col-span-2 flex flex-wrap gap-6">
                <Toggle
                  name="active"
                  checked={form.active}
                  onChange={handleChange}
                  label={t.active}
                  color="emerald"
                />
                <div className="flex flex-col gap-1">
                  <Toggle
                    name="postingAccount"
                    checked={form.postingAccount}
                    onChange={handleChange}
                    label={t.postingAccount}
                    color="blue"
                    disabled={editingAccountHasChildren}
                  />
                  {/* FIX: this account has sub-accounts — the backend
                      rejects postingAccount=true on non-leaf accounts, so
                      the toggle is disabled and explained here instead of
                      letting the user find out only after a failed save. */}
                  {editingAccountHasChildren && (
                    <p className="text-[11px] text-slate-400 max-w-[220px]">
                      {t.postingBlockedByChildren}
                    </p>
                  )}
                </div>
                <Toggle
                  name="requiresThirdParty"
                  checked={form.requiresThirdParty}
                  onChange={handleChange}
                  label={t.requiresThirdParty}
                  color="blue"
                />
                <Toggle
                  name="requiresCostCenter"
                  checked={form.requiresCostCenter}
                  onChange={handleChange}
                  label={t.requiresCostCenter}
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

function Toggle({ name, checked, onChange, label, color = "blue", disabled = false }) {
  const colors = { blue: "bg-blue-600", emerald: "bg-emerald-500" };
  return (
    <label className={`flex items-center gap-3 select-none ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <div className="relative">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
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

export default ChartOfAccountsPage;
