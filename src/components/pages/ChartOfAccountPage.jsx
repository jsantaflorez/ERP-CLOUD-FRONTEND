import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
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

// NEW (2026-10-31, user request): compact toggle pill for the Plan de
// Cuentas quick-filter bar (Naturaleza / Tipo de Cuenta / Requerimientos).
// Button.jsx's own variants are all sized for primary actions, too
// visually heavy for a row of several small on/off filters.
function FilterChip({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-blue-500 bg-blue-500 text-white"
          : "border-gray-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
      }`}
    >
      {children}
    </button>
  );
}

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

// NEW (2026-09-10): looks up an account-name suggestion for the code
// currently being typed, from the company's optional PUC template
// (see chartTemplate / templateEntriesMap in the component). This is an
// EXACT match on the code as typed -- the reference templates already
// carry an entry at every valid PUC level, so as soon as the code lands
// on a real level ("61", "110505", ...) its name is right there, exactly
// like the user's legacy SIEWIN system. Deliberately never used to
// auto-fill the Name field (see the "usar sugerencia" hint in the JSX) --
// the user was explicit that this must never impose a value.
const getTemplateNameSuggestion = (code, templateEntriesMap) => {
  if (!code || !templateEntriesMap) return null;
  return templateEntriesMap[code] || null;
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
  // NEW (2026-10-31, user request): quick filters above the table.
  // natureFilter: "ALL" | "D" | "C". accountTypeFilter: "ALL" |
  // "POSTING" (imputables) | "GROUP" (contenedoras). The two
  // requirement filters are independent on/off toggles, not mutually
  // exclusive with each other or with the above.
  const [natureFilter, setNatureFilter]           = useState("ALL");
  const [accountTypeFilter, setAccountTypeFilter] = useState("ALL");
  const [requireThirdPartyOnly, setRequireThirdPartyOnly] = useState(false);
  const [requireCostCenterOnly, setRequireCostCenterOnly] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [toast, setToast]           = useState(null);
  // NEW (2026-10-23, user request): tracks which row+flag's inline toggle
  // (see handleToggleRequiresFlag below) currently has a PUT in flight, as
  // `${id}:${field}`, so that one badge shows a disabled/loading state
  // without blocking every other badge on the page.
  const [togglingKey, setTogglingKey] = useState(null);

  // NEW (2026-09-25): "+"/"-" tree toggle per account group, requested
  // while the user was reviewing the Cost Center report fix (2026-09-22
  // note in pendientes.md). Every account with children gets its own
  // independent toggle (not just the top level) -- collapsing a group
  // hides ALL of its descendants, not just its direct children, via
  // isCodeHiddenByCollapse below walking up the parentCode chain. Starts
  // fully expanded (empty set = nothing collapsed) and is plain component
  // state on purpose -- the user confirmed this should NOT persist across
  // reloads or between visits to the screen.
  const [collapsedCodes, setCollapsedCodes] = useState(() => new Set());

  const toggleCollapse = (code) => {
    setCollapsedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // NEW (2026-09-12): lets the user keep the create form open after saving,
  // instead of always closing it (openCreatePanel -> Guardar -> closed ->
  // find the "Nuevo" button again -- tedious when entering many accounts
  // in a row, e.g. seeding a PUC template). Opt-in per session: reset to
  // false by the full resetForm(), so it never surprises a later, unrelated
  // single-account creation.
  // NEW (2026-10-13, user request): defaults to ON -- most of the time
  // the user opening this screen is about to type several sibling
  // accounts in a row, not just one, so starting checked saves the
  // manual toggle every single time instead of saving it only after the
  // first one.
  const [keepCreatingAfterSave, setKeepCreatingAfterSave] = useState(true);

  // Snapshot of `code` at the moment editing started. Used as a
  // defense-in-depth guard in handleSave: even though the field is
  // rendered readOnly while editing, this ensures the payload can never
  // carry a different value than what was actually loaded, regardless of
  // any client-side tampering with the DOM/readOnly attribute — mirrors
  // the backend's own immutability rule on `code`.
  const originalCodeRef = useRef(null);

  // Lets resetFormForNextAccount() return keyboard focus to the Code field
  // so the user can keep typing the next account without touching the mouse.
  const codeInputRef = useRef(null);

  // NEW: dynamically loaded from GET /v1/chart-of-accounts/metadata,
  // replacing the old hardcoded ACCOUNT_CLASS_OPTIONS/ACCOUNT_CATEGORY_OPTIONS/
  // FINANCIAL_STATEMENT_OPTIONS + their *_LABELS dictionaries. Each entry
  // has the shape { value, displayName, displayNameEs }.
  const [accountClasses, setAccountClasses]           = useState([]);
  const [accountCategories, setAccountCategories]     = useState([]);
  const [financialStatements, setFinancialStatements] = useState([]);
  const [loadingMetadata, setLoadingMetadata]         = useState(false);

  // NEW (2026-09-10): optional per-company PUC template used to suggest an
  // account name while the user types a code, replicating a feature from
  // the user's legacy SIEWIN system. chartTemplate is null unless the
  // company explicitly configured one (see Company.chartTemplate /
  // ChartTemplateType on the backend) -- a cooperative using its own
  // numbering, for example, simply never sees suggestions. templateEntriesMap
  // is a { code: name } lookup built once from GET /chart-account-templates
  // when a template is configured.
  const [chartTemplate, setChartTemplate]         = useState(null);
  const [templateEntriesMap, setTemplateEntriesMap] = useState({});

  // NEW (Fase 4, Importar PUC Estandar): lets an empty Plan de Cuentas be
  // populated in one step instead of account by account. importChoice is
  // only used when the company has no chartTemplate configured yet.
  const [showImportModal, setShowImportModal] = useState(false);
  const [importChoice, setImportChoice]       = useState("");
  const [importing, setImporting]             = useState(false);

  // NEW (2026-10-31, SIEWIN legacy importer): a completely separate,
  // one-off migration path from the "Importar PUC Estandar" flow above --
  // the frontend only parses the uploaded file (xlsx/csv) into the known
  // t_puc_maestro26 columns; every transformation (code re-derivation,
  // category/nature resolution, fail-fast validation) happens in
  // SiewinPucImportService. siewinIssues holds the structured violation
  // lists from a SIEWIN_IMPORT_INTEGRITY_GAP response (details), shown
  // as-is instead of through the generic getApiErrorMessage() path, since
  // those lists are the entire point of the fail-fast design.
  const [showSiewinModal, setShowSiewinModal]   = useState(false);
  const [siewinFileName, setSiewinFileName]     = useState("");
  const [siewinRows, setSiewinRows]             = useState(null);
  const [siewinImporting, setSiewinImporting]   = useState(false);
  const [siewinIssues, setSiewinIssues]         = useState(null);
  const [siewinSuccessResult, setSiewinSuccessResult] = useState(null);
  const [siewinParseError, setSiewinParseError] = useState("");
  const siewinFileInputRef = useRef(null);
  const [siewinDragOver, setSiewinDragOver] = useState(false);

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
      // NEW (2026-10-31, user request): quick filter bar above the
      // table -- Naturaleza / Tipo de Cuenta / Requerimientos.
      filterAll: "Todas",
      filterAccountTypeLabel: "Tipo de Cuenta",
      filterPostingOnly: "Imputables",
      filterPostingOnlyTitle: "Solo cuentas de movimiento (Imputables)",
      filterGroupOnly: "Contenedoras",
      filterGroupOnlyTitle: "Solo cuentas de grupo (Contenedoras)",
      filterRequirementsLabel: "Requerimientos",
      filterClear: "Limpiar filtros",
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
      codeAlreadyExists: "Ya existe una cuenta con este código.",
      toggleRequiresHint: "Clic para activar/desactivar sin abrir el panel de edición.",
      postingToggleBlockedHint: "No se puede cambiar: esta cuenta tiene subcuentas asociadas.",
      expectedCodeLengthHint: "Se espera un código de",
      expectedCodeLengthHintDigits: "dígitos.",
      postingBlockedByChildren: "No puede ser cuenta de movimiento porque tiene subcuentas asociadas.",
      parentIsPostingWarning: "Esta cuenta padre es de movimiento. Debes desmarcar \"Cuenta de Movimiento\" en ella antes de guardar, o el backend rechazará el cambio.",
      classInheritedHint: "Heredada de la cuenta padre — toda subcuenta debe compartir la clase de su padre.",
      financialStatementAutoHint: "Se determina automáticamente según la Clase contable elegida.",
      natureSuggestedHint: "Sugerida según la Clase — cámbiela si esta cuenta es una contra-cuenta.",
      parentFilteredHint: "Mostrando solo cuentas compatibles con el código ingresado.",
      parentAutoSelectedHint: "Padre seleccionado automáticamente según el código — puede cambiarlo.",
      templateSuggestionHint: "Sugerencia según plantilla PUC:",
      useSuggestion: "usar sugerencia",
      keepCreatingLabel: "Seguir creando cuentas",
      keepCreatingHint: "Al guardar, se abre un formulario nuevo con el mismo padre seleccionado.",
      newShortcutHint: "(tecla Insert)",
      expandGroup: "Expandir grupo",
      collapseGroup: "Contraer grupo",
      importPucTitle: "Importar PUC Estándar",
      importPucHint: "El Plan de Cuentas está vacío. Puedes construirlo cuenta por cuenta, o importar el PUC estándar completo (grupos, cuentas y subcuentas) en un solo paso.",
      importPucSelectTemplate: "Selecciona una plantilla:",
      importPucComercial: "PUC Comercial",
      importPucSolidario: "PUC Sector Solidario",
      importPucButton: "Importar PUC Estándar",
      importPucConfirmTitle: "¿Importar el PUC estándar?",
      importPucConfirmBody: "Se crearán automáticamente todos los grupos, cuentas y subcuentas de esta plantilla. Esta acción solo está disponible mientras el Plan de Cuentas esté vacío.",
      importPucCancel: "Cancelar",
      importPucImporting: "Importando...",
      importPucSuccess: "¡PUC importado!",
      importPucAccountsSuffix: "cuentas creadas.",
      importPucChooseTemplateTitle: "Elige la plantilla a importar",
      importPucLockedPrefix: "Esta empresa ya tiene configurada la plantilla ",
      importPucLockedSuffix: ". Puedes dejarla o elegir otra mientras el Plan de Cuentas esté vacío.",
      importPucCurrentTemplateLabel: "Plantilla actual: ",
      importPucNoTemplateYet: "Sin plantilla asignada todavía.",
      importPucOpenButton: "Seleccionar Plantilla e Importar",
      // NEW (2026-10-31): migracion de PUC legado desde SIEWIN --
      // flujo totalmente separado del selector Comercial/Solidario de
      // arriba (ver propuesta-importador-puc-siewin-2026-10-31.md).
      siewinOpenLink: "¿Vienes de otro sistema? Migrar PUC legado (SIEWIN)",
      siewinModalTitle: "Migrar Plan de Cuentas desde SIEWIN",
      siewinModalBody: "Selecciona el archivo exportado de SIEWIN (.xlsx o .csv). Se analiza aquí mismo antes de enviarlo; nada se importa todavía.",
      siewinFileReadyPrefix: "Archivo leído: ",
      siewinRowsSuffix: "filas",
      siewinDropHint: "Arrastra tu archivo aquí o haz clic para seleccionarlo",
      siewinChooseFileButton: "Elegir archivo",
      siewinChangeFileButton: "Cambiar archivo",
      siewinParseEmpty: "El archivo no tiene filas para importar.",
      siewinParseError: "No se pudo leer el archivo. Verifica que sea un .xlsx o .csv válido exportado de SIEWIN.",
      siewinIssuesTitle: "El archivo tiene problemas que impiden la importación:",
      siewinIssueOutOfRange: "Niveles fuera de rango (más de 2 dígitos)",
      siewinIssueLevelSkip: "Niveles con un hueco de jerarquía",
      siewinIssueDuplicate: "Códigos duplicados tras reconstruir el código",
      siewinIssueOrphan: "Códigos sin su grupo padre",
      siewinIssuePostingHasChildren: "Cuentas de movimiento que resultaron ser padre de otra cuenta",
      siewinIssueMissingName: "Filas sin nombre de cuenta",
      siewinIssueUnmappedGroup: "Grupos sin categoría configurada (contacta a soporte)",
      siewinIssueMore: "... y más (revisa el archivo completo)",
      siewinImportButton: "Migrar Plan de Cuentas",
      siewinSuccess: "¡PUC migrado desde SIEWIN!",
      siewinTruncatedWarningSuffix: "Nombres que parecen truncados en el origen, revísalos:",
      siewinCloseButton: "Cerrar",
      siewinTruncatedListTitle: "Nombres que parecen truncados en el origen -- revísalos y complétalos a mano si hace falta:",
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
      // NEW (2026-10-31, user request): quick filter bar above the
      // table -- Nature / Account Type / Requirements.
      filterAll: "All",
      filterAccountTypeLabel: "Account Type",
      filterPostingOnly: "Posting",
      filterPostingOnlyTitle: "Posting accounts only (movement accounts)",
      filterGroupOnly: "Group",
      filterGroupOnlyTitle: "Group accounts only (container accounts)",
      filterRequirementsLabel: "Requirements",
      filterClear: "Clear filters",
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
      codeAlreadyExists: "An account with this code already exists.",
      toggleRequiresHint: "Click to toggle without opening the edit panel.",
      postingToggleBlockedHint: "Can't change: this account has sub-accounts.",
      expectedCodeLengthHint: "Expected code length:",
      expectedCodeLengthHintDigits: "digits.",
      postingBlockedByChildren: "Can't be a posting account because it has sub-accounts.",
      parentIsPostingWarning: "This parent account is a posting account. You must uncheck \"Posting Account\" on it before saving, or the backend will reject the change.",
      classInheritedHint: "Inherited from the parent account — every sub-account must share its parent's class.",
      financialStatementAutoHint: "Determined automatically from the selected account Class.",
      natureSuggestedHint: "Suggested based on Class — change it if this is a contra-account.",
      parentFilteredHint: "Showing only accounts consistent with the code entered.",
      parentAutoSelectedHint: "Parent auto-selected based on the code — you can still change it.",
      templateSuggestionHint: "Suggestion from PUC template:",
      useSuggestion: "use suggestion",
      keepCreatingLabel: "Keep creating accounts",
      keepCreatingHint: "On save, a new form opens with the same parent selected.",
      newShortcutHint: "(Insert key)",
      expandGroup: "Expand group",
      collapseGroup: "Collapse group",
      importPucTitle: "Import Standard Chart of Accounts",
      importPucHint: "The Chart of Accounts is empty. You can build it account by account, or import the full standard chart (groups, accounts and sub-accounts) in one step.",
      importPucSelectTemplate: "Select a template:",
      importPucComercial: "Commercial Chart of Accounts",
      importPucSolidario: "Solidarity-sector Chart of Accounts",
      importPucButton: "Import Standard Chart of Accounts",
      importPucConfirmTitle: "Import the standard chart of accounts?",
      importPucConfirmBody: "Every group, account and sub-account from this template will be created automatically. This action is only available while the Chart of Accounts is empty.",
      importPucCancel: "Cancel",
      importPucImporting: "Importing...",
      importPucSuccess: "Chart of accounts imported!",
      importPucAccountsSuffix: "accounts created.",
      importPucChooseTemplateTitle: "Choose the template to import",
      importPucLockedPrefix: "This company already has the ",
      importPucLockedSuffix: " template configured. You can keep it or pick a different one while the Chart of Accounts is still empty.",
      importPucCurrentTemplateLabel: "Current template: ",
      importPucNoTemplateYet: "No template assigned yet.",
      importPucOpenButton: "Select Template & Import",
      // NEW (2026-10-31): legacy PUC migration from SIEWIN -- fully
      // separate flow from the Comercial/Solidario selector above.
      siewinOpenLink: "Coming from another system? Migrate legacy PUC (SIEWIN)",
      siewinModalTitle: "Migrate Chart of Accounts from SIEWIN",
      siewinModalBody: "Select the file exported from SIEWIN (.xlsx or .csv). It is analyzed right here before sending; nothing is imported yet.",
      siewinFileReadyPrefix: "File read: ",
      siewinRowsSuffix: "rows",
      siewinDropHint: "Drag your file here or click to select it",
      siewinChooseFileButton: "Choose file",
      siewinChangeFileButton: "Change file",
      siewinParseEmpty: "The file has no rows to import.",
      siewinParseError: "Could not read the file. Check that it is a valid .xlsx or .csv exported from SIEWIN.",
      siewinIssuesTitle: "The file has problems that prevent importing:",
      siewinIssueOutOfRange: "Levels out of range (more than 2 digits)",
      siewinIssueLevelSkip: "Levels with a hierarchy gap",
      siewinIssueDuplicate: "Duplicate codes after rebuilding the code",
      siewinIssueOrphan: "Codes missing their parent group",
      siewinIssuePostingHasChildren: "Posting accounts that turned out to be another account's parent",
      siewinIssueMissingName: "Rows with no account name",
      siewinIssueUnmappedGroup: "Groups with no category configured (contact support)",
      siewinIssueMore: "... and more (review the full file)",
      siewinImportButton: "Migrate Chart of Accounts",
      siewinSuccess: "Chart of accounts migrated from SIEWIN!",
      siewinTruncatedWarningSuffix: "Names that look truncated at the source, review them:",
      siewinCloseButton: "Close",
      siewinTruncatedListTitle: "Names that look truncated at the source -- review and complete them by hand if needed:",
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

  /**
   * NEW (2026-09-10): loads the current company's optional chart-of-accounts
   * template (Company.chartTemplate on the backend, null by default). This
   * is a pure UX nicety -- account-name suggestions -- so failures here are
   * swallowed silently rather than shown as a page-level error; worst case
   * is simply no suggestions, same as a company with no template configured.
   */
  const loadCompanyChartTemplate = async () => {
    try {
      const response = await api.get("/v1/companies/me");
      if (response.data && response.data.success) {
        setChartTemplate(response.data.data?.chartTemplate || null);
      }
    } catch {
      // Non-critical -- see comment above.
    }
  };

  // NEW (Fase 4): clones the standard reference PUC into real accounts for
  // this company in one call -- only ever offered while rows.length === 0
  // (see the render below), matching the backend guard.
  const handleImportTemplate = async () => {
    setImporting(true);
    try {
      const response = await api.post("/v1/chart-of-accounts/import-template", {
        templateType: importChoice,
      });
      if (response.data && response.data.success) {
        const result = response.data.data || {};
        setShowImportModal(false);
        if (result.templateType) setChartTemplate(result.templateType);
        showToast(`${t.importPucSuccess} ${result.accountsCreated ?? ""} ${t.importPucAccountsSuffix}`.trim());
        await loadAccounts();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setImporting(false);
    }
  };

  // NEW (2026-10-31): reads the uploaded SIEWIN export client-side and
  // extracts only the raw t_puc_maestro26 columns this importer needs --
  // no business logic here, see the state comment above. Accepts .xlsx
  // (SheetJS parses it natively) and .csv (SheetJS also reads CSV text
  // directly via XLSX.read with type "string").
  const processSiewinFile = async (file) => {
    if (!file) return;
    setSiewinParseError("");
    setSiewinIssues(null);
    setSiewinFileName(file.name);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      let workbook;
      if (isCsv) {
        const text = await file.text();
        workbook = XLSX.read(text, { type: "string" });
      } else {
        const buffer = await file.arrayBuffer();
        workbook = XLSX.read(buffer, { type: "array" });
      }
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: null });

      const toInt = (v) => {
        if (v === null || v === undefined || v === "") return 0;
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? 0 : n;
      };

      const parsedRows = raw.map((r) => ({
        nivel1: toInt(r.pucm_nivel1),
        nivel2: toInt(r.pucm_nivel2),
        nivel3: toInt(r.pucm_nivel3),
        nivel4: toInt(r.pucm_nivel4),
        nivel5: toInt(r.pucm_nivel5),
        nivel6: toInt(r.pucm_nivel6),
        nombre: r.pucm_nombre == null ? "" : String(r.pucm_nombre).trim(),
        imputable: toInt(r.pucm_imputable),
        bare: toInt(r.pucm_bare),
        ceco: toInt(r.pucm_ceco),
      }));

      if (parsedRows.length === 0) {
        setSiewinParseError(t.siewinParseEmpty);
        setSiewinRows(null);
        return;
      }
      setSiewinRows(parsedRows);
    } catch {
      setSiewinParseError(t.siewinParseError);
      setSiewinRows(null);
    }
  };

  // Thin wrapper for the hidden <input type="file">. Resets the input's
  // own value afterwards so picking the exact same file a second time
  // (e.g. after fixing it and re-exporting under the same name) still
  // fires onChange.
  const handleSiewinFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) processSiewinFile(file);
  };

  // Drag-and-drop onto the dropzone -- same processSiewinFile() as the
  // click-to-pick path, just a different source for the File object.
  const handleSiewinDrop = (e) => {
    e.preventDefault();
    setSiewinDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processSiewinFile(file);
  };

  // NEW (2026-10-31): posts the already-parsed rows to the backend. On a
  // SIEWIN_IMPORT_INTEGRITY_GAP rejection, the structured violation lists
  // ride in error.response.data.data (ApiResponse.data -- see
  // GlobalExceptionHandler.handleInvalidOperation) and are shown directly
  // in the modal, not through getApiErrorMessage()'s single-line
  // translation, since the whole point of this error is the per-row detail.
  const handleImportSiewin = async () => {
    if (!siewinRows || siewinRows.length === 0) return;
    setSiewinImporting(true);
    setSiewinIssues(null);
    try {
      const response = await api.post("/v1/chart-of-accounts/import-siewin", { rows: siewinRows });
      if (response.data && response.data.success) {
        const result = response.data.data || {};
        // Keep the modal open on success, showing the full result --
        // including the truncated-name list, which used to only ever
        // appear as a bare count in a toast that disappears in a few
        // seconds (reported by the user: the names themselves were never
        // actually visible anywhere).
        setSiewinSuccessResult(result);
        setSiewinRows(null);
        showToast(`${t.siewinSuccess} ${result.accountsCreated ?? ""} ${t.importPucAccountsSuffix}`.trim());
        await loadAccounts();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      const details = error?.response?.data?.data;
      if (error?.response?.data?.message === "SIEWIN_IMPORT_INTEGRITY_GAP" && details) {
        setSiewinIssues(details);
      } else {
        showToast(getApiErrorMessage(error, language, t.errorConn), "error");
      }
    } finally {
      setSiewinImporting(false);
    }
  };

  useEffect(() => {
    loadAccounts();
    loadMetadata();
    loadCompanyChartTemplate();
  }, []);

  // NEW (2026-09-10): fetches the full set of code/name entries for the
  // company's configured template exactly once (whenever chartTemplate
  // changes, which in practice is just once per page load), and builds a
  // { code: name } map for O(1) lookups as the user types. Nothing fetched
  // or shown at all while chartTemplate is null.
  useEffect(() => {
    if (!chartTemplate) {
      setTemplateEntriesMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get("/v1/chart-account-templates", {
          params: { type: chartTemplate },
        });
        if (!cancelled && response.data && response.data.success) {
          const map = {};
          for (const entry of response.data.data || []) {
            map[entry.code] = entry.name;
          }
          setTemplateEntriesMap(map);
        }
      } catch {
        // Non-critical -- see loadCompanyChartTemplate comment above.
      }
    })();
    return () => { cancelled = true; };
  }, [chartTemplate]);

  // NEW (2026-10-31, user request): natureFilter/accountTypeFilter/
  // requireThirdPartyOnly/requireCostCenterOnly are evaluated alongside
  // the existing text search, not as a separate pass -- a row has to
  // satisfy every active filter at once.
  const hasActiveQuickFilter =
    natureFilter !== "ALL" ||
    accountTypeFilter !== "ALL" ||
    requireThirdPartyOnly ||
    requireCostCenterOnly;

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();

    return rows.filter((r) => {
      if (term) {
        const matchesSearch =
          r.code?.toLowerCase().includes(term) ||
          r.name?.toLowerCase().includes(term) ||
          r.accountCategory?.toLowerCase().includes(term) ||
          r.accountCategoryDisplay?.toLowerCase().includes(term) ||
          r.accountClass?.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }
      if (natureFilter !== "ALL" && r.nature !== natureFilter) return false;
      if (accountTypeFilter === "POSTING" && !r.postingAccount) return false;
      if (accountTypeFilter === "GROUP" && r.postingAccount) return false;
      if (requireThirdPartyOnly && !r.requiresThirdParty) return false;
      if (requireCostCenterOnly && !r.requiresCostCenter) return false;
      return true;
    });
  }, [rows, searchTerm, natureFilter, accountTypeFilter, requireThirdPartyOnly, requireCostCenterOnly]);

  // Lookup by code, used to walk up the parentCode chain when deciding
  // whether a row is hidden by a collapsed ancestor (see visibleRows).
  const rowsByCode = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => map.set(r.code, r));
    return map;
  }, [rows]);

  const isCodeHiddenByCollapse = (row) => {
    let parentCode = row.parentCode;
    while (parentCode) {
      if (collapsedCodes.has(parentCode)) return true;
      parentCode = rowsByCode.get(parentCode)?.parentCode;
    }
    return false;
  };

  // While actively searching, show the flat matching results uncollapsed
  // (same behavior as before this feature existed) -- collapsing a group
  // that contains a search match would hide the very thing being looked
  // for. Collapse only applies when browsing the full tree.
  const visibleRows = useMemo(() => {
    if (searchTerm.trim() || hasActiveQuickFilter) return filteredRows;
    return filteredRows.filter((r) => !isCodeHiddenByCollapse(r));
  }, [filteredRows, searchTerm, hasActiveQuickFilter, collapsedCodes, rowsByCode]);

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
    // Full reset (panel closing, or opening fresh for a new account) always
    // starts "keep creating" CHECKED again (2026-10-13, user request) --
    // it's the default for a fresh create session, not a sticky global
    // preference remembered across unrelated visits to this screen; the
    // user turns it off by hand only once they're done with their batch.
    setKeepCreatingAfterSave(true);
  };

  // NEW (2026-09-12): partial reset used after a successful create when
  // "Seguir creando cuentas" is checked -- unlike resetForm(), this keeps
  // the form open (no setOpen(false)) and deliberately keeps parentId (and
  // everything the parent forces: accountClass/nature/financialStatement via
  // applyAccountClass, plus accountCategory when it's still valid for that
  // class) so entering several sibling accounts in a row -- the whole point
  // of this feature -- doesn't mean re-picking the same parent every time.
  // Code/name and the per-account flags (postingAccount, requiresThirdParty,
  // requiresCostCenter) reset to their defaults since those legitimately
  // vary account to account.
  const resetFormForNextAccount = () => {
    setForm((prev) => {
      if (!prev.parentId) return initialForm;
      const next = { ...initialForm, parentId: prev.parentId, accountCategory: prev.accountCategory };
      return applyAccountClass(next, prev.accountClass);
    });
    setErrors({});
    // Stays in create mode -- editingId/editingIdRef/originalCodeRef were
    // already null and remain untouched.
  };

  const openCreatePanel = () => {
    resetForm();
    setOpen(true);
  };

  // NEW (2026-09-14): keyboard shortcut for "Nuevo" -- Plan de Cuentas can
  // get very long, and this is the exact screen used to seed the PUC
  // template, so requiring a scroll back to the top every time was
  // tedious. Insert opens the create panel from anywhere on the page.
  // Guarded on !open so it never interrupts an in-progress create/edit
  // (it would otherwise wipe out whatever was already typed).
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Insert" || open) return;
      e.preventDefault();
      openCreatePanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

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

    // NEW (2026-10-23, user request): clears a stale "ya existe" (or any
    // other) code error the moment the user edits the field again --
    // without this, an error set by handleCodeBlur below (or by a failed
    // submit) would sit there unchanged until the next blur/submit, even
    // after the user had already typed a different code.
    if (name === "code") {
      setErrors((prev) => (prev.code ? { ...prev, code: undefined } : prev));
    }

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

  // NEW (2026-10-23, user request): previously a duplicate code was only
  // caught by the backend after the whole form was filled in and
  // submitted (DuplicateResourceException on POST), wasting all the typing
  // in between. Checked on blur against `rows` -- already the full chart
  // of accounts loaded for this page's own parent-selector/code-structure
  // validation above, so this needs no extra request. Create mode only:
  // the code field is locked/read-only once editingIdRef.current is set,
  // so there's nothing to check while editing.
  const handleCodeBlur = () => {
    if (editingIdRef.current) return;
    const trimmed = form.code.trim();
    if (!trimmed) return; // the required-field error already covers this on submit
    const isDuplicate = rows.some((r) => r.code === trimmed);
    if (isDuplicate) {
      setErrors((prev) => ({ ...prev, code: t.codeAlreadyExists }));
    }
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
        // NEW (2026-10-23, user request): the plain "¡Cuenta creada!"
        // toast didn't say WHICH account, so a user creating several
        // accounts in a row (via "Seguir creando cuentas" -- the panel
        // resets to blank immediately after each save) had no clear,
        // lasting confirmation of what had actually just been saved
        // beyond a generic 3-second banner. Appending the saved account's
        // own code/name (straight from the backend's response, not the
        // form -- authoritative for a brand-new account's generated
        // state) makes each success unmistakable.
        const savedAccount = response.data.data;
        const accountLabel = savedAccount ? ` ${savedAccount.code} — ${savedAccount.name}` : "";
        showToast(`${currentId ? t.successUpdate : t.successCreate}${accountLabel}`);
        // NEW (2026-09-12): "Seguir creando cuentas" only applies to create
        // (currentId == null) -- editing an existing account always closes
        // the panel as before, since there's no "next sibling" concept there.
        if (!currentId && keepCreatingAfterSave) {
          resetFormForNextAccount();
          codeInputRef.current?.focus();
        } else {
          closePanel();
        }
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

  // NEW (2026-10-23, user request): "edición in situ" for the three
  // boolean flags editable straight from the table -- requiresThirdParty,
  // requiresCostCenter, and (per the user's follow-up) postingAccount --
  // with no need to open the full edit panel at all. Reuses the exact
  // same PUT endpoint and the same payload shape handleSave() above
  // posts, just built from the row (`item`, already loaded in `rows`)
  // instead of `form` -- so this is a completely ordinary update as far
  // as the backend is concerned, with every one of
  // ChartOfAccountService.update()'s existing rules still applying:
  // HAS_CHILDREN_CANNOT_POST / POSTING_ACCOUNT_HAS_MOVEMENTS for
  // postingAccount (the children case is also blocked client-side below,
  // same as the edit panel's own disabled Toggle), and the new
  // REQUIRES_THIRD_PARTY_HAS_MOVEMENTS / REQUIRES_COST_CENTER_HAS_MOVEMENTS
  // guards (added per this same follow-up) for the other two -- turning
  // either requirement OFF once the account has real movements is now
  // rejected server-side, surfacing as a toast exactly like the
  // pre-existing posting-account guard does.
  const buildUpdatePayloadFromRow = (item) => {
    const parentMatch = rows.find((r) => r.code === item.parentCode);
    return {
      code:               item.code,
      name:               item.name,
      nature:             item.nature,
      accountClass:       item.accountClass,
      accountCategory:    item.accountCategory,
      financialStatement: item.financialStatement,
      postingAccount:     hasChildren(item.code, rows) ? false : Boolean(item.postingAccount),
      requiresThirdParty: Boolean(item.requiresThirdParty),
      requiresCostCenter: Boolean(item.requiresCostCenter),
      active:             Boolean(item.active),
      parentId:           parentMatch?.id ?? null,
    };
  };

  const handleToggleRequiresFlag = async (item, field) => {
    const key = `${item.id}:${field}`;
    setTogglingKey(key);
    const payload = { ...buildUpdatePayloadFromRow(item), [field]: !item[field] };

    try {
      const response = await api.put(`/v1/chart-of-accounts/${item.id}`, payload);
      if (response.data && response.data.success) {
        showToast(t.successUpdate);
        loadAccounts();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setTogglingKey(null);
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

      {showImportModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/20"
            onClick={() => {
              if (importing) return;
              setShowImportModal(false);
              setImportChoice("");
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800">{t.importPucConfirmTitle}</h3>
            <p className="mt-2 text-sm text-slate-600">{t.importPucConfirmBody}</p>

            {/* FIX (2026-10-30, revised same day on explicit user direction):
                the template choice is ALWAYS editable here, every time,
                regardless of Company.chartTemplate -- that field is not a
                lock, having a real account is. The backend enforces the
                same rule (ChartAccountTemplateImportService.importTemplate):
                it only ever rejects this call once the Plan de Cuentas has
                at least one account, never because of a pre-set
                chartTemplate. A company whose chartTemplate was already
                set (e.g. directly in the database when its row was
                created, before any accounts exist) must stay free to pick
                either template, or a typo'd NIT at company creation would
                permanently strand it on the wrong one with nothing to show
                for it yet. If there's a current value, it's shown as a
                plain, non-blocking note and used to prefill the selector
                (see the banner's onClick) -- a convenience, not a lock. */}
            {chartTemplate && (
              <p className="mt-4 text-xs text-indigo-700">
                {t.importPucLockedPrefix}
                <strong>{chartTemplate === "COMERCIAL" ? t.importPucComercial : t.importPucSolidario}</strong>
                {t.importPucLockedSuffix}
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              <span className="text-sm font-medium text-indigo-900">{t.importPucChooseTemplateTitle}</span>
              <select
                value={importChoice}
                onChange={(e) => setImportChoice(e.target.value)}
                autoFocus
                className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
              >
                <option value="">{t.selectOption}</option>
                <option value="COMERCIAL">{t.importPucComercial}</option>
                <option value="SOLIDARIO">{t.importPucSolidario}</option>
              </select>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                disabled={importing}
                onClick={() => {
                  setShowImportModal(false);
                  setImportChoice("");
                }}
              >
                {t.importPucCancel}
              </Button>
              <Button
                variant="primary"
                loading={importing}
                disabled={!importChoice}
                onClick={handleImportTemplate}
              >
                {importing ? t.importPucImporting : t.importPucButton}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* NEW (2026-10-31): SIEWIN legacy-PUC migration modal -- fully
          separate from the COMERCIAL/SOLIDARIO modal above. See
          handleSiewinFileChange/handleImportSiewin and
          propuesta-importador-puc-siewin-2026-10-31.md. */}
      {showSiewinModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/20"
            onClick={() => {
              if (siewinImporting) return;
              setShowSiewinModal(false);
            }}
          />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-800">{t.siewinModalTitle}</h3>
            <p className="mt-2 text-sm text-slate-600">{t.siewinModalBody}</p>

            {!siewinSuccessResult && (
              <div className="mt-4">
                <input
                  ref={siewinFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleSiewinFileChange}
                  className="hidden"
                />
                {/* NEW: styled, clickable + drag-and-drop dropzone instead
                    of the bare native <input type="file"> -- that control
                    renders as unlabeled browser chrome ("Seleccionar
                    archivo / Ningún archivo seleccionado") with no visual
                    affordance that it belongs to this modal. The input
                    itself stays mounted (hidden) and is only ever opened
                    programmatically via siewinFileInputRef. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => siewinFileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      siewinFileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setSiewinDragOver(true);
                  }}
                  onDragLeave={() => setSiewinDragOver(false)}
                  onDrop={handleSiewinDrop}
                  className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                    siewinDragOver
                      ? "border-indigo-400 bg-indigo-100"
                      : siewinFileName && !siewinParseError
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-indigo-200 bg-indigo-50/60 hover:border-indigo-400 hover:bg-indigo-50"
                  }`}
                >
                  <svg
                    className={`h-7 w-7 ${siewinFileName && !siewinParseError ? "text-emerald-500" : "text-indigo-400"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5"
                    />
                  </svg>

                  {siewinFileName && !siewinParseError ? (
                    <>
                      <p className="text-sm font-medium text-emerald-800">{siewinFileName}</p>
                      <p className="text-xs text-emerald-700">
                        {siewinRows ? `${siewinRows.length} ${t.siewinRowsSuffix}` : ""}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          siewinFileInputRef.current?.click();
                        }}
                      >
                        {t.siewinChangeFileButton}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-slate-500">{t.siewinDropHint}</p>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          siewinFileInputRef.current?.click();
                        }}
                      >
                        {t.siewinChooseFileButton}
                      </Button>
                    </>
                  )}
                </div>
                {siewinParseError && (
                  <p className="mt-2 text-xs text-red-600">{siewinParseError}</p>
                )}
              </div>
            )}

            {!siewinSuccessResult && siewinIssues && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-2">
                <p className="font-semibold">{t.siewinIssuesTitle}</p>
                {[
                  ["outOfRangeLevels", t.siewinIssueOutOfRange],
                  ["levelSkipGaps", t.siewinIssueLevelSkip],
                  ["duplicateCodes", t.siewinIssueDuplicate],
                  ["orphanCodes", t.siewinIssueOrphan],
                  ["postingAccountHasChildren", t.siewinIssuePostingHasChildren],
                  ["missingNames", t.siewinIssueMissingName],
                  ["unmappedGroups", t.siewinIssueUnmappedGroup],
                ].map(([key, label]) =>
                  Array.isArray(siewinIssues[key]) && siewinIssues[key].length > 0 ? (
                    <div key={key}>
                      <p className="font-medium">{label} ({siewinIssues[key].length}):</p>
                      <ul className="ml-4 list-disc">
                        {siewinIssues[key].slice(0, 20).map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                        {siewinIssues[key].length > 20 && <li>{t.siewinIssueMore}</li>}
                      </ul>
                    </div>
                  ) : null
                )}
              </div>
            )}

            {/* NEW: the result's truncatedNameWarnings used to only ever
                surface as a bare count inside the success toast -- the
                actual account codes/names were never shown anywhere. This
                panel lists them directly, same visual language as the
                validation-issues panel above, and stays on screen (the
                modal no longer auto-closes on success) until the user
                dismisses it with "Cerrar". */}
            {siewinSuccessResult && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-2">
                <p className="font-semibold">
                  {t.siewinSuccess} {siewinSuccessResult.accountsCreated ?? ""} {t.importPucAccountsSuffix}
                </p>
                {Array.isArray(siewinSuccessResult.truncatedNameWarnings) &&
                  siewinSuccessResult.truncatedNameWarnings.length > 0 && (
                    <div>
                      <p className="font-medium">
                        {t.siewinTruncatedListTitle} ({siewinSuccessResult.truncatedNameWarnings.length}):
                      </p>
                      <ul className="ml-4 list-disc">
                        {siewinSuccessResult.truncatedNameWarnings.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              {siewinSuccessResult ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowSiewinModal(false);
                    setSiewinSuccessResult(null);
                    setSiewinFileName("");
                    setSiewinRows(null);
                  }}
                >
                  {t.siewinCloseButton}
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    disabled={siewinImporting}
                    onClick={() => setShowSiewinModal(false)}
                  >
                    {t.importPucCancel}
                  </Button>
                  <Button
                    variant="primary"
                    loading={siewinImporting}
                    disabled={!siewinRows || siewinRows.length === 0}
                    onClick={handleImportSiewin}
                  >
                    {siewinImporting ? t.importPucImporting : t.siewinImportButton}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <AppHeader
        title={t.title}
        subtitle={t.subtitle}
        tenantId={activeTenantId}
        actions={
          <>
            {/* NEW (2026-09-14): the list can get very long (this is the
                exact screen used to seed the PUC template), so scrolling
                back up to click "Nuevo" every time is tedious. Insert opens
                the create panel from anywhere on the page -- see the
                keydown effect below. Shown here so it's discoverable. */}
            <span className="hidden text-[11px] text-slate-400 sm:inline">{t.newShortcutHint}</span>
            <Button variant="primary" onClick={openCreatePanel} title={`${t.new} ${t.newShortcutHint}`}>
              + {t.new}
            </Button>
          </>
        }
      />

      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={t.search}
        className="w-full md:max-w-md rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none shadow-sm focus:border-blue-500 transition-all"
      />

      {/* NEW (2026-10-31, user request): quick filters -- Naturaleza,
          Tipo de Cuenta, Requerimientos. Combine with each other and
          with the text search above (see filteredRows); any filter
          being active also bypasses group-collapse, same reasoning as
          the text search already had (a collapsed group could hide the
          very rows a filter is meant to surface). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.nature}</span>
          <div className="flex gap-1">
            <FilterChip active={natureFilter === "ALL"} onClick={() => setNatureFilter("ALL")}>
              {t.filterAll}
            </FilterChip>
            <FilterChip active={natureFilter === "D"} onClick={() => setNatureFilter("D")}>
              {t.debit}
            </FilterChip>
            <FilterChip active={natureFilter === "C"} onClick={() => setNatureFilter("C")}>
              {t.credit}
            </FilterChip>
          </div>
        </div>

        <div className="hidden h-5 w-px bg-gray-200 sm:block" />

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.filterAccountTypeLabel}</span>
          <div className="flex gap-1">
            <FilterChip active={accountTypeFilter === "ALL"} onClick={() => setAccountTypeFilter("ALL")}>
              {t.filterAll}
            </FilterChip>
            <FilterChip
              active={accountTypeFilter === "POSTING"}
              onClick={() => setAccountTypeFilter("POSTING")}
              title={t.filterPostingOnlyTitle}
            >
              {t.filterPostingOnly}
            </FilterChip>
            <FilterChip
              active={accountTypeFilter === "GROUP"}
              onClick={() => setAccountTypeFilter("GROUP")}
              title={t.filterGroupOnlyTitle}
            >
              {t.filterGroupOnly}
            </FilterChip>
          </div>
        </div>

        <div className="hidden h-5 w-px bg-gray-200 sm:block" />

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.filterRequirementsLabel}</span>
          <div className="flex gap-1">
            <FilterChip active={requireThirdPartyOnly} onClick={() => setRequireThirdPartyOnly((v) => !v)}>
              {t.requiresThirdParty}
            </FilterChip>
            <FilterChip active={requireCostCenterOnly} onClick={() => setRequireCostCenterOnly((v) => !v)}>
              {t.requiresCostCenter}
            </FilterChip>
          </div>
        </div>

        {hasActiveQuickFilter && (
          <button
            type="button"
            className="ml-auto text-xs font-medium text-slate-400 underline hover:text-slate-600"
            onClick={() => {
              setNatureFilter("ALL");
              setAccountTypeFilter("ALL");
              setRequireThirdPartyOnly(false);
              setRequireCostCenterOnly(false);
            }}
          >
            {t.filterClear}
          </button>
        )}
      </div>

      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6 flex flex-col gap-3">
          <p className="text-sm font-semibold text-indigo-900">{t.importPucTitle}</p>
          <p className="text-sm text-indigo-700">{t.importPucHint}</p>
          {/* NEW (2026-10-30): dynamic label so the current (or still
              unset) template is visible at a glance, not only once the
              modal is open -- the user asked for this explicitly after
              the previous round only surfaced it inside the modal. */}
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
            {chartTemplate
              ? `${t.importPucCurrentTemplateLabel}${chartTemplate === "COMERCIAL" ? t.importPucComercial : t.importPucSolidario}`
              : t.importPucNoTemplateYet}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {/* FIX (2026-10-30): template choice moved into the modal
                itself (see showImportModal below) so it's always explicit,
                whether or not the company already has a chartTemplate.
                Renamed (same day) from "Importar PUC Estandar" to make it
                clear up front that clicking opens a choice between
                Comercial/Solidario before anything runs -- the modal's own
                confirm button keeps the original wording, since by then
                the template is already picked and that click is the one
                that actually executes the import. */}
            <Button
              variant="primary"
              onClick={() => {
                setImportChoice(chartTemplate || "");
                setShowImportModal(true);
              }}
            >
              {t.importPucOpenButton}
            </Button>
            {/* NEW (2026-10-31): completely separate migration path for a
                client coming from the legacy SIEWIN system -- see
                propuesta-importador-puc-siewin-2026-10-31.md. Deliberately
                a plain text link, not a second primary Button, so the
                COMERCIAL/SOLIDARIO choice above stays the obvious default
                action for the vast majority of companies. */}
            <button
              type="button"
              className="text-xs font-medium text-indigo-600 underline hover:text-indigo-800"
              onClick={() => {
                setSiewinIssues(null);
                setSiewinSuccessResult(null);
                setSiewinParseError("");
                setSiewinRows(null);
                setSiewinFileName("");
                setShowSiewinModal(true);
              }}
            >
              {t.siewinOpenLink}
            </button>
          </div>
        </div>
      )}

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
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-16 text-center text-slate-400">
                    {t.noResults}
                  </td>
                </tr>
              ) : (
                visibleRows.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-4 font-bold text-slate-700">
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{ paddingLeft: `${((item.level || 1) - 1) * 16}px` }}
                      >
                        {hasChildren(item.code, rows) ? (
                          <button
                            type="button"
                            onClick={() => toggleCollapse(item.code)}
                            title={collapsedCodes.has(item.code) ? t.expandGroup : t.collapseGroup}
                            aria-label={collapsedCodes.has(item.code) ? t.expandGroup : t.collapseGroup}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 text-[10px] font-black leading-none text-slate-500 transition-colors hover:bg-slate-100"
                          >
                            {collapsedCodes.has(item.code) ? "+" : "\u2212"}
                          </button>
                        ) : (
                          <span className="inline-block h-4 w-4 shrink-0" aria-hidden="true" />
                        )}
                        {item.code}
                      </span>
                    </td>
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
                      {/* NEW (2026-10-23, user request): same inline toggle
                          as Tercero/Centro de Costo below, but only when
                          this account has no sub-accounts -- mirrors the
                          edit panel's own disabled Toggle for the exact
                          same reason (itemHasChildren above). Turning it
                          OFF while it already has movements is still
                          rejected by the backend's existing
                          POSTING_ACCOUNT_HAS_MOVEMENTS guard, same as
                          before this change. */}
                      <Badge
                        active={item.postingAccount}
                        labelOn={t.postingAccount}
                        labelOff={t.noPostingAccount}
                        colorOn="blue"
                        onClick={
                          hasChildren(item.code, rows)
                            ? undefined
                            : () => handleToggleRequiresFlag(item, "postingAccount")
                        }
                        disabled={togglingKey === `${item.id}:postingAccount`}
                        title={hasChildren(item.code, rows) ? t.postingToggleBlockedHint : t.toggleRequiresHint}
                      />
                    </td>

                    <td className="px-5 py-4">
                      {/* NEW (2026-10-23, user request): clicking the badge
                          toggles it directly -- no need to open the edit
                          panel just to fix a missing Tercero/Centro de
                          Costo requirement. */}
                      <Badge
                        active={item.requiresThirdParty}
                        labelOn={t.requiresThirdParty}
                        labelOff={t.noRequiresThirdParty}
                        colorOn="blue"
                        onClick={() => handleToggleRequiresFlag(item, "requiresThirdParty")}
                        disabled={togglingKey === `${item.id}:requiresThirdParty`}
                        title={t.toggleRequiresHint}
                      />
                    </td>

                    <td className="px-5 py-4">
                      <Badge
                        active={item.requiresCostCenter}
                        labelOn={t.requiresCostCenter}
                        labelOff={t.noRequiresCostCenter}
                        colorOn="blue"
                        onClick={() => handleToggleRequiresFlag(item, "requiresCostCenter")}
                        disabled={togglingKey === `${item.id}:requiresCostCenter`}
                        title={t.toggleRequiresHint}
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
          <div className="absolute inset-0 bg-slate-900/20" onClick={closePanel} />
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
                  ref={codeInputRef}
                  name="code"
                  value={form.code}
                  onChange={handleChange}
                  onBlur={handleCodeBlur}
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
                {/* NEW (2026-09-10): optional PUC-template name suggestion.
                    Only in create mode, only while a template is configured
                    for this company, and only when the suggestion differs
                    from what's already typed -- shown as a clickable hint,
                    NEVER auto-filled into the field, per the user's explicit
                    requirement that this "nunca debe imponerse". */}
                {!editingIdRef.current && chartTemplate && (() => {
                  const suggestion = getTemplateNameSuggestion(form.code.trim(), templateEntriesMap);
                  if (!suggestion || suggestion === form.name?.trim()) return null;
                  return (
                    <span className="text-[10px] text-slate-500">
                      {t.templateSuggestionHint} "{suggestion}" —{" "}
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, name: suggestion }))}
                        className="underline text-emerald-600 hover:text-emerald-700"
                      >
                        {t.useSuggestion}
                      </button>
                    </span>
                  );
                })()}
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

              {/* NEW (2026-09-12): create mode only -- see
                  resetFormForNextAccount() for what's kept vs. reset.
                  "Cancelar" below still exits without creating another,
                  whether or not this is checked. On by default since
                  2026-10-13 (user request) -- the user turns it off by
                  hand once their batch of accounts is done. */}
              {!editingIdRef.current && (
                <div className="md:col-span-2 flex flex-col gap-1">
                  <Toggle
                    name="keepCreatingAfterSave"
                    checked={keepCreatingAfterSave}
                    onChange={(e) => setKeepCreatingAfterSave(e.target.checked)}
                    label={t.keepCreatingLabel}
                    color="emerald"
                  />
                  <p className="text-[10px] text-slate-400">{t.keepCreatingHint}</p>
                </div>
              )}

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

// NEW (2026-10-23, user request): optional onClick turns this into an
// inline toggle button instead of a plain static label -- used by the
// requiresThirdParty/requiresCostCenter columns above so the user can fix
// a missing flag directly from the table (see handleToggleRequiresFlag).
// Every other Badge usage on this page omits onClick and renders exactly
// as before, as a plain non-interactive <span>.
function Badge({ active, labelOn, labelOff, colorOn, onClick, disabled, title }) {
  const colors = {
    green: "bg-green-100 text-green-700",
    blue: "bg-blue-100 text-blue-700",
  };

  const className = `rounded-full px-3 py-1 text-[10px] font-bold uppercase transition ${
    active ? colors[colorOn] : "bg-gray-100 text-gray-500"
  } ${onClick ? (disabled ? "opacity-50 cursor-wait" : "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-300") : ""}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} title={title} className={className}>
        {active ? labelOn : labelOff}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {active ? labelOn : labelOff}
    </span>
  );
}

export default ChartOfAccountsPage;
