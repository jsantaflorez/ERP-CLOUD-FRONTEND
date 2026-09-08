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

// UX FIX (2026-09-04): reverse of getExpectedCodeLength -- given how many
// digits the code being TYPED currently has, this returns how many digits
// its parent's code must have, per the same PUC jump rule
// (1 -> 2 -> 4 -> +2...). Returns null when the current length doesn't
// land on a determinable level yet (still-mid-typed codes, or a root
// account). This is what lets the form go from "pick any of these N
// accounts as the parent" to "here's the one account that actually fits
// the code you're typing" -- closing the gap the user flagged: nothing
// previously stopped picking "1105 — CAJA" as the parent of "413595".
const getExpectedParentCodeLength = (codeLength) => {
  if (codeLength === 2) return 1;
  if (codeLength === 4) return 2;
  if (codeLength >= 6 && codeLength % 2 === 0) return codeLength - 2;
  return null;
};

// Looks up the account whose code exactly matches the parent length the
// typed code implies (e.g. typing "4205" implies a 2-digit parent, so this
// looks up "42"). Returns null if the code is too short/an odd length to
// have a determinable parent yet, or if that ancestor doesn't exist in the
// plan yet -- in either case the user still picks manually from the
// (still prefix-filtered) dropdown below.
const getSuggestedParent = (code, rows) => {
  if (!code) return null;
  const parentLength = getExpectedParentCodeLength(code.length);
  if (!parentLength) return null;
  const parentCode = code.slice(0, parentLength);
  return rows.find((r) => r.code === parentCode) || null;
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

// UX FIX (2026-09-04): before this, a new account asked the user to pick
// Clase, Categoría, Estado Financiero AND Naturaleza independently, with
// nothing hinting how they relate -- exactly how the user hit
// PARENT_CLASS_MISMATCH and FINANCIAL_STATEMENT_CLASS_MISMATCH creating
// accounts "42"/"4205". In reality only two of those four are ever free
// choices; the other two are determined (or at least suggested) by the
// selected parent/Clase:
//
// Mirrors FinancialStatement.fromAccountClass() exactly. This mapping has
// NO exceptions in the backend, so -- unlike Naturaleza below -- Estado
// Financiero is never left as a free choice: the field is always locked
// to whatever this returns, driven by Clase alone.
const FINANCIAL_STATEMENT_BY_CLASS = {
  ASSET: "BALANCE_SHEET",
  LIABILITY: "BALANCE_SHEET",
  EQUITY: "BALANCE_SHEET",
  REVENUE: "INCOME_STATEMENT",
  EXPENSE: "INCOME_STATEMENT",
  COST: "INCOME_STATEMENT",
};

// Standard PUC debit/credit convention per class -- mirrors the doc
// comment on the backend's AccountNature enum ("Debit accounts: Assets,
// Expenses, Costs; Credit accounts: Liabilities, Equity, Revenue"). The
// backend deliberately does NOT enforce this (contra-accounts like
// "Depreciación Acumulada" are a legitimate, intentional exception), so
// this is only ever a *suggestion* -- Naturaleza stays freely editable
// after this fills it in, unlike Estado Financiero above.
const DEFAULT_NATURE_BY_CLASS = {
  ASSET: "D",
  EXPENSE: "D",
  COST: "D",
  LIABILITY: "C",
  EQUITY: "C",
  REVENUE: "C",
};

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
      classInheritedHint: "Heredada de la cuenta padre — toda subcuenta debe compartir la clase de su padre.",
      financialStatementAutoHint: "Se determina automáticamente según la Clase contable elegida.",
      natureSuggestedHint: "Sugerida según la Clase — cámbiela si esta cuenta es una contra-cuenta.",
      parentFilteredHint: "Mostrando solo cuentas compatibles con el código ingresado.",
      parentAutoSelectedHint: "Padre seleccionado automáticamente según el código — puede cambiarlo.",
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
      classInheritedHint: "Inherited from the parent account — every sub-account must share its parent's class.",
      financialStatementAutoHint: "Determined automatically from the selected account Class.",
      natureSuggestedHint: "Suggested based on Class — change it if this is a contra-account.",
      parentFilteredHint: "Showing only accounts consistent with the code entered.",
      parentAutoSelectedHint: "Parent auto-selected based on the code — you can still change it.",
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

  // UX FIX (2026-09-04): narrows availableParents to only the accounts
  // whose code is actually a prefix of the code being typed -- e.g. typing
  // "413595" only leaves "4" and "41" (if they exist) as candidates,
  // "1105 — CAJA" simply can't appear in the list anymore. Mirrors the
  // CHILD_CODE_MUST_START_WITH_PARENT rule the backend already enforces on
  // save, just applied proactively to the dropdown's contents instead of
  // discovered only after a failed submit. Falls back to the unfiltered
  // list once no candidate matches (a brand-new branch, or intermediate
  // accounts that don't exist yet) so the field is never left empty when a
  // legitimate manual pick is still needed.
  const parentCandidates = useMemo(() => {
    const code = form.code.trim();
    if (!code) return availableParents;
    const prefixMatches = availableParents.filter((r) => code.startsWith(r.code));
    return prefixMatches.length > 0 ? prefixMatches : availableParents;
  }, [availableParents, form.code]);

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

  // Cascades an accountClass value (picked directly, or inherited from a
  // newly selected parent) into every field it determines:
  //  - financialStatement: always overwritten (strict 1:1 rule, no
  //    exceptions -- see FINANCIAL_STATEMENT_BY_CLASS above).
  //  - nature: overwritten with the standard suggestion, but the user can
  //    still change it afterward (contra-accounts are legitimate).
  //  - accountCategory: cleared only if it no longer belongs to the new
  //    class (same rule the plain accountClass change already applied).
  const applyAccountClass = (formState, newClass) => {
    const next = { ...formState, accountClass: newClass };

    next.financialStatement = FINANCIAL_STATEMENT_BY_CLASS[newClass] || "";

    if (newClass && DEFAULT_NATURE_BY_CLASS[newClass]) {
      next.nature = DEFAULT_NATURE_BY_CLASS[newClass];
    }

    const categoryStillValid = accountCategories.some(
      (c) => c.value === formState.accountCategory && c.accountClass === newClass
    );
    if (!categoryStillValid) {
      next.accountCategory = "";
    }

    return next;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;

    if (name === "code") val = value.toUpperCase().slice(0, 20);
    if (name === "name") val = value.slice(0, 150);

    setForm((prev) => {
      let next = { ...prev, [name]: val };

      // UX FIX: selecting a parent inherits its Clase -- the backend
      // requires every child to share its parent's accountClass exactly
      // (PARENT_CLASS_MISMATCH), so there's no legitimate case where they
      // could differ. The accountClass <select> below is locked
      // (disabled) whenever a parent is set, so this is the only place
      // that value gets written while a parent is selected. Clearing the
      // parent (root account) leaves accountClass as-is for the user to
      // pick explicitly.
      if (name === "parentId") {
        const parent = rows.find((r) => String(r.id) === String(val));
        if (parent) {
          next = applyAccountClass(next, parent.accountClass);
        }
      }

      // UX FIX (2026-09-04): as the code is typed, auto-select the parent
      // it structurally implies (getSuggestedParent), the same way the
      // user's legacy SIEWIN system does it -- typing "4205" auto-picks
      // "42" as the parent instead of leaving the user to find it in a
      // flat list. If no exact ancestor exists yet at the implied level
      // but the CURRENTLY selected parent is still a valid prefix of the
      // new code, it's left alone (e.g. typing on past "4135" while "41"
      // is selected). Only cleared when it's neither the suggested match
      // NOR still a valid prefix -- i.e. the code was edited into a shape
      // the previously-picked parent no longer fits, which is exactly the
      // "413595 hung off 1105" scenario this whole feature exists to
      // prevent.
      if (name === "code") {
        const suggested = getSuggestedParent(val, rows);
        const currentParent = rows.find((r) => String(r.id) === String(next.parentId));
        const currentParentStillValid = !!currentParent && val.startsWith(currentParent.code);

        if (suggested && String(suggested.id) !== String(next.parentId)) {
          next = { ...next, parentId: String(suggested.id) };
          next = applyAccountClass(next, suggested.accountClass);
        } else if (!suggested && !currentParentStillValid && next.parentId !== "") {
          next = { ...next, parentId: "" };
        }
      }

      if (name === "accountClass") {
        next = applyAccountClass(next, val);
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

              {/* UX FIX (2026-09-04): moved above Clase/Naturaleza -- picking
                  the parent FIRST is what drives everything below it now
                  (Clase is inherited, Naturaleza/Estado Financiero follow
                  from Clase), so the form now reads in the order the user
                  actually decides things: "this account lives under X" ->
                  the rest falls out of that. */}
              <Field label={t.parent}>
                <select
                  name="parentId"
                  value={form.parentId}
                  onChange={handleChange}
                  className={inputCls()}
                >
                  <option value="">{t.noParent}</option>
                  {parentCandidates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                </select>
                {/* UX FIX (2026-09-04): tells the user WHY the list looks
                    short/pre-filled -- either the dropdown was narrowed to
                    only the accounts consistent with the code they typed,
                    or (when there's an exact structural match) the parent
                    was already picked for them. Without this the
                    auto-behavior could look like a bug ("why can't I see
                    all my accounts?"). */}
                {!editingIdRef.current && form.code.trim() && (
                  parentCandidates.length < availableParents.length ? (
                    <span className="text-[10px] text-slate-400">{t.parentFilteredHint}</span>
                  ) : null
                )}
                {!editingIdRef.current &&
                  getSuggestedParent(form.code.trim(), rows)?.id != null &&
                  String(getSuggestedParent(form.code.trim(), rows).id) === String(form.parentId) && (
                    <span className="text-[10px] text-emerald-600">{t.parentAutoSelectedHint}</span>
                  )}
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

              {/* UX FIX: locked (read-only) once a parent is selected --
                  the backend requires every child to share its parent's
                  Clase exactly (PARENT_CLASS_MISMATCH), so there is no
                  legitimate way for the user to pick anything else here.
                  Only free to choose when defining a brand-new root
                  branch (no parent). */}
              <Field label={t.accountClass} error={errors.accountClass}>
                <select
                  name="accountClass"
                  value={form.accountClass}
                  onChange={handleChange}
                  className={`${inputCls(errors.accountClass)} ${form.parentId ? "opacity-60 cursor-not-allowed" : ""}`}
                  disabled={loadingMetadata || !!form.parentId}
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
                {form.parentId && (
                  <span className="text-[10px] text-amber-600">{t.classInheritedHint}</span>
                )}
              </Field>

              {/* UX FIX: Naturaleza now follows Clase (see
                  DEFAULT_NATURE_BY_CLASS) -- pre-filled the moment a Clase
                  is set (directly, or inherited from the parent above),
                  but stays fully editable: contra-accounts (e.g.
                  "Depreciación Acumulada", an ASSET with Crédito nature)
                  are a legitimate, deliberate exception the backend does
                  not forbid. */}
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
                {form.accountClass && (
                  <span className="text-[10px] text-slate-400">{t.natureSuggestedHint}</span>
                )}
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

              {/* UX FIX: always locked, driven entirely by Clase
                  (FINANCIAL_STATEMENT_BY_CLASS mirrors
                  FinancialStatement.fromAccountClass() exactly, a strict
                  1:1 mapping with zero exceptions in the backend) -- this
                  is exactly the field whose mismatch with Clase produced
                  the raw "Financial statement BALANCE_SHEET does not
                  match account class REVENUE" error the user hit
                  creating account 4205. Removing the free choice removes
                  the error, not just its translation. */}
              <div className="md:col-span-2">
                <Field label={t.financialStatement} error={errors.financialStatement}>
                  <select
                    name="financialStatement"
                    value={form.financialStatement}
                    onChange={handleChange}
                    className={`${inputCls(errors.financialStatement)} opacity-60 cursor-not-allowed`}
                    disabled
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
                  <span className="text-[10px] text-amber-600">{t.financialStatementAutoHint}</span>
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
