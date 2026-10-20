import { useEffect, useMemo, useState } from "react";
import api from "../../services/api";
import Button from "../ui/Button";
import { TAX_REGIME_LABELS, TAX_REGIMES_BY_PERSON } from "../../constants/taxRegimes";
import { getApiErrorMessage } from "../../constants/apiErrors";

// NEW (2026-10-20, user request): sibling to AccountQuickCreateModal.jsx /
// CostCenterQuickCreateModal.jsx -- lets a journal entry line create the
// third party (cliente/proveedor) it needs without leaving the comprobante
// being typed. UNLIKE those two siblings, this is DELIBERATELY NOT a full
// copy of ThirdPartyPage.jsx's create form: a Tercero carries several
// genuinely optional fields (trade name, email, billing email, phone,
// mobile, address, default cost center) that only matter for invoicing/
// contact purposes, not for posting a journal line. Replicating all of
// them here would turn a "quick" create into the full screen with extra
// steps -- the opposite of the point. This modal asks ONLY for what the
// backend actually requires to create a valid ThirdParty (documentType,
// documentNumber, personType, taxRegime, cityId, and the legal name --
// businessName or firstName+lastName depending on personType) and nothing
// else; the user finishes the record later from the full Terceros screen
// if they want the optional contact/fiscal-extra fields filled in.
//
// Also deliberately left out, same reasoning as the two siblings: the
// tabbed layout (no point splitting ~6 fields into 3 tabs), the "activo"
// toggle (a brand-new record is always active), and middleName/
// secondLastName (optional even in the full form).

const initialForm = {
  personType: "JURIDICA",
  documentType: "NIT",
  documentNumber: "",
  businessName: "",
  firstName: "",
  lastName: "",
  taxRegime: "CORPORATE",
  cityId: "",
};

// Returns the first (canonical) tax regime option valid for a given
// personType, per TAX_REGIMES_BY_PERSON -- same helper as
// ThirdPartyPage.jsx, copied rather than imported for the same reason the
// other quick-create modals don't import from their full-screen siblings
// (keeps this modal independent of that page's internals).
const getDefaultTaxRegimeForPersonType = (personType) => {
  const options = TAX_REGIMES_BY_PERSON[personType] || [];
  return options[0] || "";
};

// Mirrors ThirdPartyService.calculateDV exactly (Colombian NIT
// verification digit, Modulo 11 algorithm) -- same copy already used by
// ThirdPartyPage.jsx. Purely a live preview; the backend always
// recalculates this itself from documentNumber on save.
const calculateVerificationDigit = (documentNumber) => {
  const primes = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const cleanDoc = (documentNumber || "").replace(/[^0-9]/g, "");

  if (!cleanDoc) return null;
  if (cleanDoc.length > primes.length) return null;

  let sum = 0;
  for (let i = 0; i < cleanDoc.length; i++) {
    const digit = Number(cleanDoc[cleanDoc.length - 1 - i]);
    sum += digit * primes[i];
  }

  const remainder = sum % 11;
  return remainder < 2 ? remainder : 11 - remainder;
};

/**
 * Quick-create modal for a Third Party, opened from a "+" button next to
 * the Tercero picker in the Journal Entry line (currently the only
 * caller). `onCreated(thirdParty)` fires once after a successful save
 * with the backend's full ThirdPartyResponseDTO; `onClose()` fires on
 * cancel or after onCreated, whichever the caller doesn't already handle.
 */
function ThirdPartyQuickCreateModal({ language = "es", onCreated, onClose }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [cities, setCities] = useState([]);
  const [loadingCities, setLoadingCities] = useState(true);

  const t = {
    es: {
      title: "Nuevo Tercero",
      type: "Tipo de Persona",
      natural: "Natural",
      juridica: "Jurídica",
      docType: "Tipo de Documento",
      docNum: "Nro. Documento",
      dv: "DV",
      businessName: "Razón Social",
      firstName: "Primer Nombre",
      lastName: "Primer Apellido",
      regime: "Régimen Fiscal",
      regimeHint: "Mostrando regímenes aplicables para:",
      city: "Ciudad / Municipio",
      selectOption: "Seleccione...",
      loadingCities: "Cargando ciudades...",
      required: "Campo obligatorio",
      save: "Crear Tercero",
      saving: "Creando...",
      cancel: "Cancelar",
      errorConn: "Error de conexión con el servidor.",
      completeLaterHint: "Datos de contacto, nombre comercial y demás se completan después desde Terceros.",
    },
    en: {
      title: "New Third Party",
      type: "Person Type",
      natural: "Natural Person",
      juridica: "Legal Entity",
      docType: "Document Type",
      docNum: "Document Number",
      dv: "DV",
      businessName: "Business Name",
      firstName: "First Name",
      lastName: "Last Name",
      regime: "Tax Regime",
      regimeHint: "Showing regimes applicable to:",
      city: "City",
      selectOption: "Select...",
      loadingCities: "Loading cities...",
      required: "Required",
      save: "Create Third Party",
      saving: "Creating...",
      cancel: "Cancel",
      errorConn: "Server connection error.",
      completeLaterHint: "Contact info, trade name, etc. can be filled in later from Third Parties.",
    },
  }[language];

  // Own, minimal catalog load (just Cities) -- same approach
  // AccountQuickCreateModal takes for its own metadata, so this modal has
  // no dependency on what the Journal Entry form happens to have loaded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCities(true);
      try {
        const response = await api.get("/v1/cities");
        if (!cancelled) {
          const data = response.data?.success ? response.data.data : response.data;
          setCities(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        if (!cancelled) setErrorMsg(getApiErrorMessage(error, language, t.errorConn));
      } finally {
        if (!cancelled) setLoadingCities(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taxRegimeOptions = useMemo(
    () => TAX_REGIMES_BY_PERSON[form.personType] || [],
    [form.personType]
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    let val = value;
    if (name === "documentNumber") val = value.replace(/\s/g, "").slice(0, 20);

    setForm((prev) => {
      const next = { ...prev, [name]: val };

      if (name === "documentNumber") {
        const dv = calculateVerificationDigit(val);
        next.verificationDigitPreview = dv != null ? String(dv) : "";
      }

      // Same repair as ThirdPartyPage.jsx: a taxRegime valid for the
      // previous personType may not be valid for the new one.
      if (name === "personType") {
        const validRegimes = TAX_REGIMES_BY_PERSON[val] || [];
        if (!validRegimes.includes(prev.taxRegime)) {
          next.taxRegime = getDefaultTaxRegimeForPersonType(val);
        }
      }

      return next;
    });
  };

  const validate = () => {
    const errs = {};
    if (!form.documentNumber?.trim()) errs.documentNumber = t.required;
    if (!form.documentType?.trim()) errs.documentType = t.required;
    if (!form.personType?.trim()) errs.personType = t.required;
    if (!form.taxRegime?.trim()) errs.taxRegime = t.required;
    if (!form.cityId) errs.cityId = t.required;

    if (form.personType === "JURIDICA") {
      if (!form.businessName?.trim()) errs.businessName = t.required;
    } else {
      if (!form.firstName?.trim()) errs.firstName = t.required;
      if (!form.lastName?.trim()) errs.lastName = t.required;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!validate()) return;

    const payload = {
      documentNumber: form.documentNumber.trim(),
      documentType: form.documentType,
      personType: form.personType,
      taxRegime: form.taxRegime,
      cityId: Number(form.cityId),
      businessName: form.personType === "JURIDICA" ? form.businessName.trim() : null,
      firstName: form.personType === "NATURAL" ? form.firstName.trim() : null,
      lastName: form.personType === "NATURAL" ? form.lastName.trim() : null,
      // Left blank on purpose -- optional, filled in later from Terceros
      // if ever needed (see top-of-file note).
      middleName: null,
      secondLastName: null,
      tradeName: null,
      email: null,
      billingEmail: null,
      mobile: null,
      phone: null,
      address: null,
      defaultCostCenterId: null,
    };

    setSaving(true);
    try {
      const response = await api.post("/v1/third-parties", payload);
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
      <div className="absolute inset-0 bg-slate-900/20" onClick={onClose} />
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

          <TpField label={t.type} error={errors.personType}>
            <select name="personType" value={form.personType} onChange={handleChange} className={tpInputCls(errors.personType)} autoFocus>
              <option value="JURIDICA">{t.juridica}</option>
              <option value="NATURAL">{t.natural}</option>
            </select>
          </TpField>

          <TpField label={t.docType} error={errors.documentType}>
            <select name="documentType" value={form.documentType} onChange={handleChange} className={tpInputCls(errors.documentType)}>
              <option value="NIT">NIT</option>
              <option value="CC">Cédula de Ciudadanía</option>
              <option value="CE">Cédula de Extranjería</option>
              <option value="PP">Pasaporte</option>
            </select>
          </TpField>

          <div className="md:col-span-2 grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <TpField label={t.docNum} error={errors.documentNumber}>
                <input
                  name="documentNumber"
                  value={form.documentNumber}
                  onChange={handleChange}
                  maxLength={20}
                  placeholder="12345678"
                  className={tpInputCls(errors.documentNumber)}
                />
              </TpField>
            </div>
            <div>
              <TpField label={t.dv}>
                <input
                  type="text"
                  value={form.verificationDigitPreview || ""}
                  readOnly
                  className={`${tpInputCls()} bg-slate-50 cursor-not-allowed`}
                  placeholder="—"
                />
              </TpField>
            </div>
          </div>

          {form.personType === "JURIDICA" ? (
            <div className="md:col-span-2">
              <TpField label={t.businessName} error={errors.businessName}>
                <input
                  name="businessName"
                  value={form.businessName}
                  onChange={handleChange}
                  maxLength={150}
                  placeholder="Empresa S.A.S."
                  className={tpInputCls(errors.businessName)}
                />
              </TpField>
            </div>
          ) : (
            <>
              <TpField label={t.firstName} error={errors.firstName}>
                <input
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  maxLength={50}
                  className={tpInputCls(errors.firstName)}
                />
              </TpField>
              <TpField label={t.lastName} error={errors.lastName}>
                <input
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  maxLength={50}
                  className={tpInputCls(errors.lastName)}
                />
              </TpField>
            </>
          )}

          <div className="md:col-span-2">
            <TpField label={t.city} error={errors.cityId}>
              <select
                name="cityId"
                value={form.cityId}
                onChange={handleChange}
                className={tpInputCls(errors.cityId)}
                disabled={loadingCities}
              >
                <option value="">{loadingCities ? t.loadingCities : t.selectOption}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </TpField>
          </div>

          <div className="md:col-span-2">
            <TpField label={t.regime} error={errors.taxRegime}>
              <select name="taxRegime" value={form.taxRegime} onChange={handleChange} className={tpInputCls(errors.taxRegime)}>
                {taxRegimeOptions.map((value) => (
                  <option key={value} value={value}>
                    {TAX_REGIME_LABELS[language]?.[value] || value}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-400">
                {t.regimeHint} {form.personType === "JURIDICA" ? t.juridica : t.natural}
              </span>
            </TpField>
          </div>

          <p className="md:col-span-2 text-[10px] text-slate-400">{t.completeLaterHint}</p>

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

const tpInputCls = (err) =>
  `w-full border-b-2 ${err ? "border-red-400" : "border-gray-100"} p-2.5 text-sm outline-none focus:border-blue-500 transition-colors bg-transparent`;

function TpField({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

export default ThirdPartyQuickCreateModal;
