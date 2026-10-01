import { useEffect, useMemo, useState } from "react";
import api from "../../services/api";
import Button from "../ui/Button";
import { getApiErrorMessage, API_ERROR_LABELS } from "../../constants/apiErrors";

// NEW (2026-10-01): lets a journal entry line create the account it needs
// without leaving the comprobante being typed (see pendientes.md). This is
// a DELIBERATE, SCOPED re-implementation of ChartOfAccountPage.jsx's
// creation panel -- not a shared/extracted component -- so that page's
// well-tested behavior is never touched. The validation rules below mirror
// it exactly (same pure logic, same backend endpoints) so the two forms
// can never disagree about what a valid account looks like; only left out
// on purpose, since they're not needed for a one-shot quick-create: the
// "seguir creando cuentas" toggle (this modal always closes after one
// save) and the collapsible account tree (irrelevant here). The optional
// PUC-template name-suggestion WAS initially left out too, but the user
// flagged it while testing (2026-10-01) -- it's genuinely useful here,
// not just in Plan de Cuentas, so it was added below (see
// getTemplateNameSuggestion / templateEntriesMap).

const initialForm = {
  code: "",
  name: "",
  nature: "D",
  accountClass: "",
  accountCategory: "",
  financialStatement: "",
  // Defaults to true (unlike ChartOfAccountPage's own blank default) --
  // the entire point of this modal is to create an account that can be
  // posted to immediately in the line that triggered it, so a header
  // account would be a dead end 99% of the time. Still togglable, for the
  // rare case of wanting a header account instead.
  postingAccount: true,
  requiresThirdParty: false,
  requiresCostCenter: false,
  active: true,
  parentId: "",
};

// Mirrors ChartOfAccountService.validateCodeStructure exactly (PUC --
// Colombian Chart of Accounts structure rules). Copied from
// ChartOfAccountPage.jsx rather than imported, so this file has no
// dependency on that page (see the top-of-file note on why this is a
// deliberate, scoped re-implementation, not a shared extraction).
const getCodeStructureErrorCode = (code, parentId, isPostingAccount, rows) => {
  if (!code) return null;

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
  if (!parent) return null;

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

const getExpectedCodeLength = (parentId, rows) => {
  if (!parentId) return 1;
  const parent = rows.find((r) => String(r.id) === String(parentId));
  if (!parent) return null;
  const parentLength = parent.code.length;
  if (parentLength === 1) return 2;
  if (parentLength === 2) return 4;
  return parentLength + 2;
};

const getExpectedParentCodeLength = (codeLength) => {
  if (codeLength === 2) return 1;
  if (codeLength === 4) return 2;
  if (codeLength >= 6 && codeLength % 2 === 0) return codeLength - 2;
  return null;
};

const getSuggestedParent = (code, rows) => {
  if (!code) return null;
  const parentLength = getExpectedParentCodeLength(code.length);
  if (!parentLength) return null;
  const parentCode = code.slice(0, parentLength);
  return rows.find((r) => r.code === parentCode) || null;
};

// Copied from ChartOfAccountPage.jsx (same exact-match lookup against the
// company's optional PUC template). Deliberately never auto-fills Name --
// shown as a clickable hint only, same as the original screen.
const getTemplateNameSuggestion = (code, templateEntriesMap) => {
  if (!code || !templateEntriesMap) return null;
  return templateEntriesMap[code] || null;
};

const FINANCIAL_STATEMENT_BY_CLASS = {
  ASSET: "BALANCE_SHEET",
  LIABILITY: "BALANCE_SHEET",
  EQUITY: "BALANCE_SHEET",
  REVENUE: "INCOME_STATEMENT",
  EXPENSE: "INCOME_STATEMENT",
  COST: "INCOME_STATEMENT",
};

const DEFAULT_NATURE_BY_CLASS = {
  ASSET: "D",
  EXPENSE: "D",
  COST: "D",
  LIABILITY: "C",
  EQUITY: "C",
  REVENUE: "C",
};

/**
 * Quick-create modal for a Chart of Accounts entry, opened from a "+"
 * button next to an account picker elsewhere in the app (currently just
 * the Journal Entry form). `rows` is the caller's own full accounts list
 * (same shape loaded by ChartOfAccountPage.jsx / JournalEntryPage.jsx's
 * `accounts` state) -- needed for the parent-suggestion/code-structure
 * logic below. `onCreated(account)` fires once after a successful save
 * with the backend's full ChartOfAccountResponseDTO; `onClose()` fires on
 * cancel or after onCreated, whichever the caller doesn't already handle.
 */
function AccountQuickCreateModal({ language = "es", rows, onCreated, onClose }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [accountClasses, setAccountClasses] = useState([]);
  const [accountCategories, setAccountCategories] = useState([]);
  const [financialStatements, setFinancialStatements] = useState([]);
  const [loadingMetadata, setLoadingMetadata] = useState(true);

  // NEW (2026-10-01): optional PUC-template name suggestion, same feature
  // ChartOfAccountPage.jsx has -- added here after the user noticed it was
  // missing while testing this modal. chartTemplate stays null unless the
  // company configured one (Company.chartTemplate); until then no extra
  // call is made and no hint is ever shown, same as the original screen.
  const [chartTemplate, setChartTemplate] = useState(null);
  const [templateEntriesMap, setTemplateEntriesMap] = useState({});

  const t = {
    es: {
      title: "Nueva Cuenta",
      code: "Código",
      name: "Nombre",
      nature: "Naturaleza",
      debit: "Débito",
      credit: "Crédito",
      accountClass: "Clase",
      accountCategory: "Categoría",
      financialStatement: "Estado Financiero",
      postingAccount: "Cuenta de Movimiento",
      requiresThirdParty: "Requiere Tercero",
      requiresCostCenter: "Requiere C. Costo",
      active: "Activa",
      parent: "Cuenta Padre",
      noParent: "— Sin padre —",
      required: "Campo obligatorio",
      save: "Crear Cuenta",
      saving: "Creando...",
      cancel: "Cancelar",
      errorConn: "Error de conexión con el servidor.",
      selectOption: "Seleccione...",
      selectClassFirst: "Seleccione primero una clase",
      loadingMetadata: "Cargando opciones...",
      expectedCodeLengthHint: "Se espera un código de",
      expectedCodeLengthHintDigits: "dígitos.",
      classInheritedHint: "Heredada de la cuenta padre.",
      financialStatementAutoHint: "Se determina automáticamente según la Clase contable elegida.",
      natureSuggestedHint: "Sugerida según la Clase — cámbiela si esta cuenta es una contra-cuenta.",
      parentAutoSelectedHint: "Padre seleccionado automáticamente según el código.",
      parentIsPostingWarning: "Esta cuenta padre es de movimiento. Debes desmarcar \"Cuenta de Movimiento\" en ella (en Plan de Cuentas) antes de guardar, o el backend rechazará el cambio.",
      postingHint: "Desmárquela solo si esta cuenta es un grupo/encabezado, no una cuenta de movimiento. En ese caso no quedará seleccionable en esta línea del comprobante.",
      templateSuggestionHint: "Sugerencia según plantilla PUC:",
      useSuggestion: "usar sugerencia",
    },
    en: {
      title: "New Account",
      code: "Code",
      name: "Name",
      nature: "Nature",
      debit: "Debit",
      credit: "Credit",
      accountClass: "Class",
      accountCategory: "Category",
      financialStatement: "Financial Statement",
      postingAccount: "Posting Account",
      requiresThirdParty: "Requires Third Party",
      requiresCostCenter: "Requires Cost Center",
      active: "Active",
      parent: "Parent Account",
      noParent: "— No parent —",
      required: "Required",
      save: "Create Account",
      saving: "Creating...",
      cancel: "Cancel",
      errorConn: "Server connection error.",
      selectOption: "Select...",
      selectClassFirst: "Select a class first",
      loadingMetadata: "Loading options...",
      expectedCodeLengthHint: "Expected code length:",
      expectedCodeLengthHintDigits: "digits.",
      classInheritedHint: "Inherited from the parent account.",
      financialStatementAutoHint: "Determined automatically from the selected account Class.",
      natureSuggestedHint: "Suggested based on Class — change it if this is a contra-account.",
      parentAutoSelectedHint: "Parent auto-selected based on the code.",
      parentIsPostingWarning: "This parent account is a posting account. You must uncheck \"Posting Account\" on it (in Chart of Accounts) before saving, or the backend will reject the change.",
      postingHint: "Only uncheck this if the account is a header/group, not a posting account. If you do, it won't be selectable on this entry's line.",
      templateSuggestionHint: "Suggestion from PUC template:",
      useSuggestion: "use suggestion",
    },
  }[language];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMetadata(true);
      try {
        const response = await api.get("/v1/chart-of-accounts/metadata");
        if (!cancelled && response.data && response.data.success) {
          const data = response.data.data || {};
          setAccountClasses(Array.isArray(data.accountClasses) ? data.accountClasses : []);
          setAccountCategories(Array.isArray(data.accountCategories) ? data.accountCategories : []);
          setFinancialStatements(Array.isArray(data.financialStatements) ? data.financialStatements : []);
        }
      } catch (error) {
        if (!cancelled) setErrorMsg(getApiErrorMessage(error, language, t.errorConn));
      } finally {
        if (!cancelled) setLoadingMetadata(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copied from ChartOfAccountPage.jsx's loadCompanyChartTemplate(): pure
  // UX nicety, so a failure here is swallowed silently -- worst case is no
  // suggestions, same as a company with no template configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get("/v1/companies/me");
        if (!cancelled && response.data && response.data.success) {
          setChartTemplate(response.data.data?.chartTemplate || null);
        }
      } catch {
        // Non-critical -- see comment above.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetches the full set of code/name entries for the company's configured
  // template exactly once (whenever chartTemplate changes), and builds a
  // { code: name } map -- same as ChartOfAccountPage.jsx's own effect.
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

  const parentCandidates = useMemo(() => {
    const code = form.code.trim();
    if (!code) return rows;
    const prefixMatches = rows.filter((r) => code.startsWith(r.code));
    return prefixMatches.length > 0 ? prefixMatches : rows;
  }, [rows, form.code]);

  const applyAccountClass = (formState, newClass) => {
    const next = { ...formState, accountClass: newClass };
    next.financialStatement = FINANCIAL_STATEMENT_BY_CLASS[newClass] || "";
    if (newClass && DEFAULT_NATURE_BY_CLASS[newClass]) {
      next.nature = DEFAULT_NATURE_BY_CLASS[newClass];
    }
    const categoryStillValid = accountCategories.some(
      (c) => c.value === formState.accountCategory && c.accountClass === newClass
    );
    if (!categoryStillValid) next.accountCategory = "";
    return next;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;
    if (name === "code") val = value.toUpperCase().slice(0, 20);
    if (name === "name") val = value.slice(0, 150);

    setForm((prev) => {
      let next = { ...prev, [name]: val };

      if (name === "parentId") {
        const parent = rows.find((r) => String(r.id) === String(val));
        if (parent) next = applyAccountClass(next, parent.accountClass);
      }

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

      if (name === "accountClass") next = applyAccountClass(next, val);

      return next;
    });
  };

  const validate = () => {
    const errs = {};
    if (!form.code?.trim()) {
      errs.code = t.required;
    } else {
      const structureErrorCode = getCodeStructureErrorCode(
        form.code.trim(), form.parentId, form.postingAccount, rows
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

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!validate()) return;

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      nature: form.nature,
      accountClass: form.accountClass,
      accountCategory: form.accountCategory,
      financialStatement: form.financialStatement,
      postingAccount: Boolean(form.postingAccount),
      requiresThirdParty: Boolean(form.requiresThirdParty),
      requiresCostCenter: Boolean(form.requiresCostCenter),
      active: Boolean(form.active),
      parentId: form.parentId !== "" ? Number(form.parentId) : null,
    };

    setSaving(true);
    try {
      const response = await api.post("/v1/chart-of-accounts", payload);
      if (response.data && response.data.success) {
        onCreated(response.data.data);
      } else {
        setErrorMsg(response.data?.message || t.errorConn);
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
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-800">{t.title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSave} className="px-6 py-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {errorMsg && (
            <p className="md:col-span-2 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          <AqField label={t.code} error={errors.code}>
            <input
              name="code"
              value={form.code}
              onChange={handleChange}
              maxLength={20}
              placeholder="Ej: 110505"
              className={aqInputCls(errors.code)}
              autoFocus
            />
            {!errors.code && (
              <span className="text-[10px] text-slate-400">
                {t.expectedCodeLengthHint} {getExpectedCodeLength(form.parentId, rows) ?? "—"} {t.expectedCodeLengthHintDigits}
              </span>
            )}
          </AqField>

          <AqField label={t.name} error={errors.name}>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              maxLength={150}
              placeholder="Ej: Caja General"
              className={aqInputCls(errors.name)}
            />
            {chartTemplate && (() => {
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
          </AqField>

          <div className="md:col-span-2">
            <AqField label={t.parent}>
              <select name="parentId" value={form.parentId} onChange={handleChange} className={aqInputCls()}>
                <option value="">{t.noParent}</option>
                {parentCandidates.map((r) => (
                  <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
                ))}
              </select>
              {form.code.trim() &&
                getSuggestedParent(form.code.trim(), rows)?.id != null &&
                String(getSuggestedParent(form.code.trim(), rows).id) === String(form.parentId) && (
                  <span className="text-[10px] text-emerald-600">{t.parentAutoSelectedHint}</span>
                )}
            </AqField>
          </div>

          {form.parentId !== "" &&
            rows.find((r) => String(r.id) === String(form.parentId))?.postingAccount && (
              <p className="md:col-span-2 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t.parentIsPostingWarning}
              </p>
            )}

          <AqField label={t.accountClass} error={errors.accountClass}>
            <select
              name="accountClass"
              value={form.accountClass}
              onChange={handleChange}
              className={`${aqInputCls(errors.accountClass)} ${form.parentId ? "opacity-60 cursor-not-allowed" : ""}`}
              disabled={loadingMetadata || !!form.parentId}
            >
              <option value="">{loadingMetadata ? t.loadingMetadata : t.selectOption}</option>
              {accountClasses.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {language === "es" ? opt.displayNameEs : opt.displayName}
                </option>
              ))}
            </select>
            {form.parentId && <span className="text-[10px] text-amber-600">{t.classInheritedHint}</span>}
          </AqField>

          <AqField label={t.nature} error={errors.nature}>
            <select name="nature" value={form.nature} onChange={handleChange} className={aqInputCls(errors.nature)}>
              <option value="D">D - {t.debit}</option>
              <option value="C">C - {t.credit}</option>
            </select>
            {form.accountClass && <span className="text-[10px] text-slate-400">{t.natureSuggestedHint}</span>}
          </AqField>

          <div className="md:col-span-2">
            <AqField label={t.accountCategory} error={errors.accountCategory}>
              <select
                name="accountCategory"
                value={form.accountCategory}
                onChange={handleChange}
                className={aqInputCls(errors.accountCategory)}
                disabled={loadingMetadata || !form.accountClass}
              >
                <option value="">
                  {loadingMetadata ? t.loadingMetadata : !form.accountClass ? t.selectClassFirst : t.selectOption}
                </option>
                {accountCategories
                  .filter((opt) => opt.accountClass === form.accountClass)
                  .map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {language === "es" ? opt.displayNameEs : opt.displayName}
                    </option>
                  ))}
              </select>
            </AqField>
          </div>

          <div className="md:col-span-2">
            <AqField label={t.financialStatement} error={errors.financialStatement}>
              <select
                name="financialStatement"
                value={form.financialStatement}
                onChange={handleChange}
                className={`${aqInputCls(errors.financialStatement)} opacity-60 cursor-not-allowed`}
                disabled
              >
                <option value="">{loadingMetadata ? t.loadingMetadata : t.selectOption}</option>
                {financialStatements.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {language === "es" ? opt.displayNameEs : opt.displayName}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-amber-600">{t.financialStatementAutoHint}</span>
            </AqField>
          </div>

          <div className="md:col-span-2 flex flex-col gap-2">
            <div className="flex flex-wrap gap-6">
              <AqToggle name="active" checked={form.active} onChange={handleChange} label={t.active} color="emerald" />
              <AqToggle name="postingAccount" checked={form.postingAccount} onChange={handleChange} label={t.postingAccount} color="blue" />
              <AqToggle name="requiresThirdParty" checked={form.requiresThirdParty} onChange={handleChange} label={t.requiresThirdParty} color="blue" />
              <AqToggle name="requiresCostCenter" checked={form.requiresCostCenter} onChange={handleChange} label={t.requiresCostCenter} color="blue" />
            </div>
            {!form.postingAccount && (
              <p className="text-[11px] text-amber-600">{t.postingHint}</p>
            )}
          </div>

          <div className="md:col-span-2 flex gap-3 pt-2">
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

const aqInputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-2.5 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent`;

function AqField({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

function AqToggle({ name, checked, onChange, label, color = "blue" }) {
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

export default AccountQuickCreateModal;
