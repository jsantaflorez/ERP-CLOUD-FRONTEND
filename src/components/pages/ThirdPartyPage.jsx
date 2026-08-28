import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api"; // Centralized Axios instance with multi-tenancy context
import { useAuth } from "../../context/AuthContext";
import { TAX_REGIME_LABELS, TAX_REGIMES_BY_PERSON } from "../../constants/taxRegimes";
import { getApiErrorMessage } from "../../constants/apiErrors";

// Initial structure for a blank form setup based on ERP specs
// FIX: taxRegime is now filtered by personType via TAX_REGIMES_BY_PERSON
// (see the accounting tab's <select> and handleChange below). The default
// here must be one of the values valid for the default personType
// ("JURIDICA" → CORPORATE is its first/canonical option).
const initialForm = {
  documentNumber: "",
  documentType: "NIT",
  verificationDigit: "",
  personType: "JURIDICA",
  taxRegime: "CORPORATE",
  firstName: "",
  middleName: "",
  lastName: "",
  secondLastName: "",
  businessName: "",
  tradeName: "",
  email: "",
  billingEmail: "",
  mobile: "",
  phone: "",
  address: "",
  cityId: "",
  defaultCostCenterId: "",
  active: true,
};

// Returns the first (canonical) tax regime option valid for a given
// personType, per TAX_REGIMES_BY_PERSON. Used both to reset the field
// when personType changes, and to repair stale/invalid data on edit.
const getDefaultTaxRegimeForPersonType = (personType) => {
  const options = TAX_REGIMES_BY_PERSON[personType] || [];
  return options[0] || "";
};

// INDIVIDUAL and CORPORATE both display as "Régimen Ordinario" in
// TAX_REGIME_LABELS (they mean the same fiscal concept for different
// person types). Without the person type nearby, the table/View panel
// would show two different regimes as identical text. This appends the
// person type in parentheses ONLY for those ambiguous cases — the other
// regimes (VAT_REGISTERED, etc.) already read unambiguously on their own.
const AMBIGUOUS_REGIMES = ["INDIVIDUAL", "CORPORATE"];

const getRegimeDisplayLabel = (taxRegime, personType, language, t) => {
  const label = TAX_REGIME_LABELS[language]?.[taxRegime] || taxRegime;
  if (AMBIGUOUS_REGIMES.includes(taxRegime)) {
    const suffix = personType === "JURIDICA" ? t.juridica : t.natural;
    return `${label} (${suffix})`;
  }
  return label;
};

// FIX: mirrors ThirdPartyService.calculateDV exactly (Colombian NIT
// verification digit, Modulo 11 algorithm). The backend ALWAYS computes
// this itself from documentNumber for any purely numeric document — it
// never reads whatever the frontend sends for verificationDigit. The old
// form had this as a manually-typed input, disabled unless
// documentType === "NIT" (so it was unusable for Natural persons with a
// numeric CC, even though the backend computes a DV for those too).
// Now computed live here purely for preview — the saved value always
// comes from the backend's own calculation on save/reload.
const calculateVerificationDigit = (documentNumber) => {
  const primes = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const cleanDoc = (documentNumber || "").replace(/[^0-9]/g, "");

  if (!cleanDoc) return null;
  if (cleanDoc.length > primes.length) return null; // matches backend's 15-digit max guard

  let sum = 0;
  for (let i = 0; i < cleanDoc.length; i++) {
    const digit = Number(cleanDoc[cleanDoc.length - 1 - i]);
    sum += digit * primes[i];
  }

  const remainder = sum % 11;
  return remainder < 2 ? remainder : 11 - remainder;
};

// NEW: Maps each validated field to the tab where it lives.
// Used to (a) jump to the first tab containing an error, and
// (b) flag tabs with a red dot when they contain invalid fields.
const FIELD_TAB_MAP = {
  personType: "basic",
  documentType: "basic",
  documentNumber: "basic",
  businessName: "basic",
  firstName: "basic",
  lastName: "basic",
  cityId: "location",
  taxRegime: "accounting",
};

const TAB_ORDER = ["basic", "location", "accounting"];

function ThirdPartyPage({ language = "es" }) {
  // --- Component States ---
  const [rows, setRows]                         = useState([]);
  const [cities, setCities]                     = useState([]);
  const [costCenters, setCostCenters]           = useState([]);
  const [form, setForm]                         = useState(initialForm);
  const [errors, setErrors]                     = useState({});
  const [open, setOpen]                         = useState(false);
  const [activeTab, setActiveTab]               = useState("basic"); // 'basic', 'location', 'accounting'
  const [editingId, setEditingId]               = useState(null);
  const [searchTerm, setSearchTerm]             = useState("");
  const [loading, setLoading]                   = useState(false);
  const [isSaving, setIsSaving]                 = useState(false);

  const [toast, setToast]                       = useState(null);

  // --- Read-only "View" panel states (separate from the edit form) ---
  const [viewItem, setViewItem]                 = useState(null); // the row being viewed, or null when closed
  const [viewTab, setViewTab]                   = useState("basic");

  // --- Spring Data Pagination States ---
  const [currentPage, setCurrentPage]           = useState(0); // Spring Boot starts at index 0
  const [totalPages, setTotalPages]             = useState(1);

  // Mutable reference tracking current execution ID to bypass stale state closures
  const editingIdRef = useRef(null);

  // Resolve active multi-tenant identifier from AuthContext (reactive —
  // updates automatically if switchCompany() runs), instead of reading
  // localStorage directly, which wouldn't trigger a re-render.
  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  // --- UI Translation Dictionary ---
  const t = {
    es: {
      title: "Terceros",
      subtitle: "Administración de Clientes, Proveedores y Empleados",
      new: "Nuevo Tercero",
      edit: "Editar",
      save: "Guardar",
      update: "Actualizar",
      cancel: "Cancelar",
      search: "Buscar por identificación, nombre, razón social...",
      identity: "Identificación",
      name: "Nombre / Razón Social",
      type: "Tipo Persona",
      regime: "Régimen Fiscal",
      email: "Correo",
      billingEmail: "Correo Facturación Electrónica",
      mobile: "Celular",
      phone: "Teléfono",
      address: "Dirección",
      city: "Ciudad / Municipio",
      costCenter: "Centro de Costo por Defecto",
      active: "Activo",
      inactive: "Inactivo",
      actions: "Acciones",
      required: "Campo obligatorio",
      deactivate: "Desactivar",
      activate: "Activar",
      noResults: "Sin registros",
      loading: "Cargando registros...",
      selectOption: "Seleccione...",
      tabBasic: "1. Datos Básicos",
      tabLocation: "2. Ubicación y Contacto",
      tabAccounting: "3. Clasificación Fiscal/Contable",
      docType: "Tipo Doc.",
      docNum: "Nro. Documento",
      dv: "DV",
      natural: "Natural",
      juridica: "Jurídica",
      businessName: "Razón Social (Casilla 35 RUT)",
      tradeName: "Nombre Comercial (Casilla 36 RUT)",
      firstName: "Primer Nombre",
      middleName: "Otros Nombres",
      lastName: "Primer Apellido",
      secondLastName: "Segundo Apellido",
      confirmDeactivate: "¿Desactivar este tercero?",
      confirmActivate: "¿Activar este tercero?",
      successCreate: "¡Tercero creado exitosamente!",
      successUpdate: "¡Tercero actualizado correctamente!",
      successDeactivate: "Tercero desactivado.",
      successActivate: "Tercero activado.",
      errorConn: "Error de comunicación con el servidor.",
      fixErrors: "Revisa los campos marcados en rojo.",
      view: "Ver",
      viewTitle: "Detalle de Tercero",
      notProvided: "No registrado",
      regimeHint: "Mostrando regímenes aplicables para:",
      yes: "Sí",
      no: "No",
      page: "Página",
      of: "de",
      previous: "Anterior",
      next: "Siguiente"
    },
    en: {
      title: "Third Parties",
      subtitle: "Management of Customers, Vendors, and Employees",
      new: "New Third Party",
      edit: "Edit",
      save: "Save",
      update: "Update",
      cancel: "Cancel",
      search: "Search by ID, name, corporate title...",
      identity: "Identification",
      name: "Name / Business Name",
      type: "Person Type",
      regime: "Tax Regime",
      email: "Email",
      billingEmail: "E-Invoicing Email",
      mobile: "Mobile",
      phone: "Phone",
      address: "Address",
      city: "City",
      costCenter: "Default Cost Center",
      active: "Active",
      inactive: "Inactive",
      actions: "Actions",
      required: "Required field",
      deactivate: "Deactivate",
      activate: "Activate",
      noResults: "No records found",
      loading: "Loading records...",
      selectOption: "Select...",
      tabBasic: "1. Basic Info",
      tabLocation: "2. Location & Contacts",
      tabAccounting: "3. Tax & Accounting",
      docType: "Doc. Type",
      docNum: "Document Number",
      dv: "DV",
      natural: "Natural Person",
      juridica: "Legal Entity",
      businessName: "Corporate Legal Name",
      tradeName: "Trade / Commercial Name",
      firstName: "First Name",
      middleName: "Middle Name",
      lastName: "First Last Name",
      secondLastName: "Second Last Name",
      confirmDeactivate: "Deactivate this third party?",
      confirmActivate: "Activate this third party?",
      successCreate: "Third Party created successfully!",
      successUpdate: "Third Party updated successfully!",
      successDeactivate: "Third Party deactivated.",
      successActivate: "Third Party activated.",
      errorConn: "Server connection error.",
      fixErrors: "Please review the fields highlighted in red.",
      view: "View",
      viewTitle: "Third Party Detail",
      notProvided: "Not provided",
      regimeHint: "Showing regimes applicable to:",
      yes: "Yes",
      no: "No",
      page: "Page",
      of: "of",
      previous: "Previous",
      next: "Next"
    }
  }[language];

  // NEW: maps each validated field to its human-readable label in the
  // active language, so the error toast can list exactly which fields
  // are missing instead of a generic "check the red fields" message.
  const FIELD_LABEL_MAP = {
    documentNumber: t.docNum,
    documentType: t.docType,
    personType: t.type,
    taxRegime: t.regime,
    cityId: t.city,
    businessName: t.businessName,
    firstName: t.firstName,
    lastName: t.lastName,
  };

  // --- Feedback Utilities ---
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- API Communications ---
  const loadThirdParties = async () => {
    setLoading(true);
    try {
      // Fixed: Pass currentPage and size parameters dynamically to Spring Boot backend
      const response = await api.get(`/v1/third-parties?page=${currentPage}&size=10`);
      if (response.data) {
        const dataTarget = response.data.content || response.data.data || response.data;
        setRows(Array.isArray(dataTarget) ? dataTarget : []);

        // Extract total pages metadata sent by Spring Data Pageable
        if (response.data.totalPages !== undefined) {
          setTotalPages(response.data.totalPages || 1);
        }
      } else {
        showToast(t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    } finally {
      setLoading(false);
    }
  };

const loadCatalogs = async () => {
    // Fetch Cities catalog independently to prevent cascading failures
    try {
      const resCities = await api.get("/v1/cities");
      if (resCities.data?.success) {
        setCities(Array.isArray(resCities.data.data) ? resCities.data.data : []);
      } else if (Array.isArray(resCities.data)) {
        setCities(resCities.data);
      }
    } catch (error) {
      console.error("Error loading cities:", error.response?.data || error.message);
      // Fallback to dictionary error message without breaking the tab switching state
      showToast(t.errorConn, "error");
    }

    // Fetch Cost Centers catalog independently
    try {
      const resCostCenters = await api.get("/v1/cost-centers");
      if (resCostCenters.data?.success) {
        const ccData = resCostCenters.data.data;
        setCostCenters(Array.isArray(ccData) ? ccData : (Array.isArray(ccData?.content) ? ccData.content : []));
      } else if (resCostCenters.data?.content) {
        setCostCenters(resCostCenters.data.content);
      } else if (Array.isArray(resCostCenters.data)) {
        setCostCenters(resCostCenters.data);
      }
    } catch (error) {
      console.error("Error loading cost centers:", error.response?.data || error.message);
    }
  };

  // Reload records whenever active page indexes shift
  useEffect(() => {
    loadThirdParties();
  }, [currentPage]);

  useEffect(() => {
    loadCatalogs();
  }, []);

  // --- Filter Evaluation ---
  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        (r.documentNumber || "").toLowerCase().includes(term) ||
        (r.legalDisplayName || "").toLowerCase().includes(term) ||
        (r.tradeName || "").toLowerCase().includes(term) ||
        (r.cityName || "").toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  // --- Form Lifecycle Controls ---
  const resetForm = () => {
    setForm(initialForm);
    setErrors({});
    setEditingId(null);
    editingIdRef.current = null;
    setActiveTab("basic");
  };

  const openCreatePanel = () => {
    resetForm();
    setOpen(true);
  };

  const openEditPanel = (item) => {
    const personType = item.personType || "JURIDICA";

    // Defensive repair: if this record's stored taxRegime isn't a valid
    // option for its personType (e.g. legacy data, or a value that
    // predates the personType-based filtering), fall back to a sensible
    // default instead of loading an invalid combination into the form.
    const validRegimes = TAX_REGIMES_BY_PERSON[personType] || [];
    const resolvedTaxRegime = validRegimes.includes(item.taxRegime)
      ? item.taxRegime
      : getDefaultTaxRegimeForPersonType(personType);

    setForm({
      documentNumber:       item.documentNumber || "",
      documentType:         item.documentType || "NIT",
      verificationDigit:    item.verificationDigit != null ? String(item.verificationDigit) : "",
      personType,
      taxRegime:            resolvedTaxRegime,
      firstName:            item.firstName || "",
      middleName:           item.middleName || "",
      lastName:             item.lastName || "",
      secondLastName:       item.secondLastName || "",
      businessName:         item.businessName || "",
      tradeName:            item.tradeName || "",
      email:                item.email || "",
      billingEmail:         item.billingEmail || "",
      mobile:               item.mobile || "",
      phone:                item.phone || "",
      address:              item.address || "",
      cityId:               item.cityId != null ? String(item.cityId) : "",
      defaultCostCenterId:  item.defaultCostCenterId != null ? String(item.defaultCostCenterId) : "",
      active:               item.active ?? true,
    });
    setErrors({});
    setEditingId(item.id);
    editingIdRef.current = item.id;
    setActiveTab("basic");
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
    resetForm();
  };

  // --- Read-only "View" panel controls ---
  const openViewPanel = (item) => {
    setViewItem(item);
    setViewTab("basic");
  };

  const closeViewPanel = () => {
    setViewItem(null);
    setViewTab("basic");
  };

  const getCityName = (cityId) => {
    if (cityId == null || cityId === "") return null;
    const match = cities.find((c) => String(c.id) === String(cityId));
    return match ? match.name : null;
  };

  const getCostCenterLabel = (ccId) => {
    if (ccId == null || ccId === "") return null;
    const match = costCenters.find((cc) => String(cc.id) === String(ccId));
    return match ? `${match.code} - ${match.name}` : null;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = type === "checkbox" ? checked : value;

    if (name === "documentNumber") val = value.replace(/\s/g, "").slice(0, 20);
    // FIX: verificationDigit is no longer a manually-typed field (see the
    // <input readOnly> below) — it's derived automatically from
    // documentNumber, same as the backend always does. The old
    // `if (name === "verificationDigit")` clamp branch is gone since
    // nothing dispatches onChange for that field anymore.

    setForm((prev) => {
      const next = { ...prev, [name]: val };

      // FIX: auto-calculate the verification digit live as the user
      // types the document number, mirroring calculateVerificationDigit
      // (same Modulo-11 algorithm as the backend). Applies to ANY
      // purely-numeric document (CC, NIT, etc.) — not just NIT — since
      // that's what the backend actually does. Non-numeric documents
      // (e.g. Passport) show no DV, same as the backend's behavior.
      if (name === "documentNumber") {
        const dv = calculateVerificationDigit(val);
        next.verificationDigit = dv != null ? String(dv) : "";
      }

      // FIX: taxRegime options are now filtered by personType (see the
      // accounting tab's <select> below). If personType changes, the
      // previously selected taxRegime may no longer be a valid option for
      // the new type (e.g. CORPORATE while switching to NATURAL) — reset
      // it to a sensible default instead of silently submitting a value
      // that isn't valid for this person type. This is the same class of
      // bug as the earlier stale "COMMON" default.
      if (name === "personType") {
        const validRegimes = TAX_REGIMES_BY_PERSON[val] || [];
        if (!validRegimes.includes(prev.taxRegime)) {
          next.taxRegime = getDefaultTaxRegimeForPersonType(val);
        }
      }

      return next;
    });
  };

  // --- Client Side Validations ---
  // NOTE: returns the error map directly (instead of relying on the errors
  // state, which would still be stale at the point handleSave needs it).
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
    return errs;
  };

  // Helper: does a given tab contain any of the current errors?
  const tabHasError = (tabId) =>
    Object.keys(errors).some((field) => FIELD_TAB_MAP[field] === tabId);

  // --- Data Persist Processing ---
  const handleSave = async (e) => {
    e.preventDefault();
    const errs = validate();

    if (Object.keys(errs).length > 0) {
      // FIX: jump to the first tab (in display order) that actually has an
      // invalid field, instead of silently staying on whichever tab the
      // user happened to be on. This is what made errors "invisible" when
      // the failing field lived in "Ubicación" or "Clasificación Fiscal"
      // while the user was on "Datos Básicos".
      const firstErrorTab = TAB_ORDER.find((tabId) =>
        Object.keys(errs).some((field) => FIELD_TAB_MAP[field] === tabId)
      );
      if (firstErrorTab) setActiveTab(firstErrorTab);

      // FIX: the toast used to just say "check the fields highlighted in
      // red" without naming them — easy to miss on a long form with
      // several tabs, especially when the actual cause is something
      // non-obvious (e.g. the city list failed to load, so cityId can
      // never be satisfied). Now lists the specific field names.
      const missingFieldLabels = Object.keys(errs)
        .map((field) => FIELD_LABEL_MAP[field])
        .filter(Boolean);
      const detail = missingFieldLabels.length > 0 ? `: ${missingFieldLabels.join(", ")}` : "";
      showToast(`${t.fixErrors}${detail}`, "error");
      return;
    }

// We activate the loading state right before the request
    setIsSaving(true);

    const payload = {
      ...form,
      documentNumber:      form.documentNumber.trim(),
      verificationDigit:   form.verificationDigit !== "" ? Number(form.verificationDigit) : null,
      tradeName:           form.tradeName?.trim() || null,
      businessName:        form.personType === "JURIDICA" ? form.businessName.trim() : null,
      firstName:           form.personType === "NATURAL" ? form.firstName.trim() : null,
      middleName:          form.personType === "NATURAL" ? form.middleName.trim() : null,
      lastName:            form.personType === "NATURAL" ? form.lastName.trim() : null,
      secondLastName:      form.personType === "NATURAL" ? form.secondLastName.trim() : null,
      cityId:              Number(form.cityId),
      defaultCostCenterId: form.defaultCostCenterId !== "" ? Number(form.defaultCostCenterId) : null,
    };

    const currentId = editingIdRef.current;
    try {
      let response;
      if (currentId) {
        response = await api.put(`/v1/third-parties/${currentId}`, payload);
      } else {
        response = await api.post("/v1/third-parties", payload);
      }

      if (response.data && response.data.success) {
        showToast(currentId ? t.successUpdate : t.successCreate);
        closePanel();
        loadThirdParties();
      } else {
        showToast(response.data?.message || t.errorConn, "error");
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }finally {
       setIsSaving(false);
    }
  };

  // --- Soft Deletions / State Switches ---
  const handleDeactivate = async (id) => {
    if (!window.confirm(t.confirmDeactivate)) return;
    try {
      const response = await api.patch(`/v1/third-parties/${id}/deactivate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successDeactivate);
        loadThirdParties();
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
    // NOTE: removed a stray `finally { setIsSaving(false) }` that used to be
    // here — this handler never calls setIsSaving(true), so that reset was
    // dead code left over from copy-pasting handleSave's pattern. If you
    // want a loading indicator on Activar/Desactivar too, it should track
    // the specific row being toggled (e.g. a `togglingId` state), not the
    // same `isSaving` flag used by the create/edit form — otherwise toggling
    // one row would visually disable the Save button in an unrelated panel.
  };

  const handleActivate = async (id) => {
    if (!window.confirm(t.confirmActivate)) return;
    try {
      const response = await api.patch(`/v1/third-parties/${id}/activate`);
      if (response.status === 200 || response.data?.success) {
        showToast(t.successActivate);
        loadThirdParties();
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, language, t.errorConn), "error");
    }
  };

  return (
    <div className="space-y-6 p-4">
      {/* Toast Alert Banner */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${toast.type === "error" ? "bg-red-500" : "bg-emerald-500"}`}>
          {toast.msg}
        </div>
      )}

      {/* Main Core View Header */}
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

      {/* Search Input Bar Element */}
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={t.search}
        className="w-full md:max-w-md rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none shadow-sm focus:border-blue-500 transition-all"
      />

      {/* Primary Master Listing Datagrid Container */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
              {t.loading}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-4">{t.identity}</th>
                  <th className="px-5 py-4">{t.name}</th>
                  <th className="px-5 py-4">{t.type}</th>
                  <th className="px-5 py-4">{t.regime}</th>
                  <th className="px-5 py-4">{t.active}</th>
                  <th className="px-5 py-4 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-400">{t.noResults}</td>
                  </tr>
                ) : (
                  filteredRows.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-4 font-mono text-slate-700 font-bold whitespace-nowrap">
                        {item.documentType} {item.documentNumber}
                        {item.verificationDigit != null ? `-${item.verificationDigit}` : ""}
                      </td>
                      <td className="px-5 py-4 text-slate-800 font-medium">
                        {item.legalDisplayName || item.businessName || `${item.firstName || ""} ${item.lastName || ""}`.trim()}
                      </td>
                      <td className="px-5 py-4 text-slate-500 text-xs">
                        {item.personType === "JURIDICA" ? t.juridica : t.natural}
                      </td>
                      <td className="px-5 py-4 text-slate-500 text-xs font-medium">
                          {getRegimeDisplayLabel(item.taxRegime, item.personType, language, t)}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${item.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {item.active ? t.active : t.inactive}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => openViewPanel(item)}>{t.view}</Button>
                          <Button variant="ghost" size="sm" onClick={() => openEditPanel(item)}>{t.edit}</Button>
                          {item.active ? (
                            <Button variant="danger" size="sm" onClick={() => handleDeactivate(item.id)}>{t.deactivate}</Button>
                          ) : (
                            <Button variant="secondary" size="sm" onClick={() => handleActivate(item.id)}>{t.activate}</Button>
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

        {/* FIXED: Dynamic Pagination Footer connected with Spring Boot Pageable */}
        <div className="flex items-center justify-between border-t border-gray-100 bg-slate-50 px-6 py-4">
          <div className="text-xs text-slate-500 font-medium">
            {t.page} <span className="font-bold text-slate-700">{currentPage + 1}</span> {t.of} <span className="font-bold text-slate-700">{totalPages}</span>
          </div>
          <div className="flex gap-2">
           <Button
             variant="secondary"
             size="sm"
             disabled={currentPage === 0}
             onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
           >
             {t.previous}
           </Button>

           <Button
             variant="secondary"
             size="sm"
             disabled={currentPage >= totalPages - 1}
             onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
           >
             {t.next}
           </Button>

          </div>
        </div>
      </div>

      {/* Contextual Side Panel Form Container */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closePanel} />
          <div className="relative h-full w-full max-w-xl bg-white shadow-2xl flex flex-col">

            {/* Modal Heading Context Group */}
            <div className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">
                {editingIdRef.current ? t.edit : t.new}
              </h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-700 text-2xl">×</button>
            </div>

            {/* Horizontal Segmented Navigation Tab Menu */}
            <div className="flex border-b border-slate-100 bg-slate-50 px-8 overflow-x-auto whitespace-nowrap">
              {[
                { id: "basic", label: t.tabBasic },
                { id: "location", label: t.tabLocation },
                { id: "accounting", label: t.tabAccounting }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative border-b-2 px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                    activeTab === tab.id ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {tab.label}
                  {/* NEW: red dot indicator when this tab has an invalid field */}
                  {tabHasError(tab.id) && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                  )}
                </button>
              ))}
            </div>

            {/* Form Fields Scroller Section */}

                        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-8 flex flex-col">
                          {/* Dynamic container with minimum height to prevent layout shifts or collapses  */}
                          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 flex-1 auto-rows-max">

                            {/* TAB SECTION 1: BASIC METADATA DATA */}
                            {activeTab === "basic" && (
                              <>
                                <Field label={t.type} error={errors.personType}>
                                  <select name="personType" value={form.personType} onChange={handleChange} className={inputCls(errors.personType)}>
                                    <option value="JURIDICA">{t.juridica}</option>
                                    <option value="NATURAL">{t.natural}</option>
                                  </select>
                                </Field>

                                <Field label={t.docType} error={errors.documentType}>
                                  <select name="documentType" value={form.documentType} onChange={handleChange} className={inputCls(errors.documentType)}>
                                    <option value="NIT">NIT</option>
                                    <option value="CC">Cédula de Ciudadanía</option>
                                    <option value="CE">Cédula de Extranjería</option>
                                    <option value="PP">Pasaporte</option>
                                  </select>
                                </Field>

                                {/* Document Number & DV Alignment Grid */}
                                <div className="grid grid-cols-3 gap-2 align-bottom md:col-span-2">
                                  <div className="col-span-2">
                                    <Field label={t.docNum} error={errors.documentNumber}>
                                      <input name="documentNumber" value={form.documentNumber} onChange={handleChange} className={inputCls(errors.documentNumber)} placeholder="12345678" />
                                    </Field>
                                  </div>
                                  <div>
                                    <Field label={t.dv}>
                                      {/* FIX: was a manually-typed input,
                                          disabled unless documentType === "NIT"
                                          — meaning it never worked for Natural
                                          persons (default documentType "CC"),
                                          and never actually calculated
                                          anything. Now read-only and
                                          auto-computed from documentNumber
                                          (see handleChange), matching what
                                          the backend always does regardless
                                          of document type. */}
                                      <input
                                        type="text"
                                        name="verificationDigit"
                                        value={form.verificationDigit}
                                        readOnly
                                        className={`${inputCls()} bg-slate-50 cursor-not-allowed`}
                                        placeholder="—"
                                      />
                                    </Field>
                                  </div>
                                </div>

                                {form.personType === "JURIDICA" ? (
                                  <div className="md:col-span-2">
                                    <Field label={t.businessName} error={errors.businessName}>
                                      <input name="businessName" value={form.businessName} onChange={handleChange} className={inputCls(errors.businessName)} placeholder="Empresa S.A.S." />
                                    </Field>
                                  </div>
                                ) : (
                                  <>
                                    <Field label={t.firstName} error={errors.firstName}>
                                      <input name="firstName" value={form.firstName} onChange={handleChange} className={inputCls(errors.firstName)} placeholder="" />
                                    </Field>
                                    <Field label={t.middleName}>
                                      <input name="middleName" value={form.middleName} onChange={handleChange} className={inputCls()} placeholder="" />
                                    </Field>
                                    <Field label={t.lastName} error={errors.lastName}>
                                      <input name="lastName" value={form.lastName} onChange={handleChange} className={inputCls(errors.lastName)} placeholder="" />
                                    </Field>
                                    <Field label={t.secondLastName}>
                                      <input name="secondLastName" value={form.secondLastName} onChange={handleChange} className={inputCls()} placeholder="" />
                                    </Field>
                                  </>
                                )}

                                <div className="md:col-span-2">
                                  <Field label={t.tradeName}>
                                    <input name="tradeName" value={form.tradeName} onChange={handleChange} className={inputCls()} placeholder="" />
                                  </Field>
                                </div>
                              </>
                            )}

                            {/* TAB SECTION 2: GEOGRAPHY, ADDRESS & CONTACTS */}
                            {activeTab === "location" && (
                              <>
                                <div className="md:col-span-2">
                                  <Field label={t.city} error={errors.cityId}>
                                    <select name="cityId" value={form.cityId} onChange={handleChange} className={inputCls(errors.cityId)}>
                                      <option value="">{t.selectOption}</option>
                                      {cities.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                      ))}
                                    </select>
                                  </Field>
                                </div>

                                <div className="md:col-span-2">
                                  <Field label={t.address}>
                                    <input name="address" value={form.address} onChange={handleChange} className={inputCls()} placeholder="" />
                                  </Field>
                                </div>

                                <Field label={t.mobile}>
                                  <input name="mobile" value={form.mobile} onChange={handleChange} className={inputCls()} placeholder="" />
                                </Field>
                                <Field label={t.phone}>
                                  <input name="phone" value={form.phone} onChange={handleChange} className={inputCls()} placeholder="" />
                                </Field>

                                <div className="md:col-span-2">
                                  <Field label={t.email}>
                                    <input type="email" name="email" value={form.email} onChange={handleChange} className={inputCls()} placeholder="Ej.:contacto@correo.com" />
                                  </Field>
                                </div>
                                <div className="md:col-span-2">
                                  <Field label={t.billingEmail}>
                                    <input type="email" name="billingEmail" value={form.billingEmail} onChange={handleChange} className={inputCls()} placeholder="Ej.:facturacion@correo.com" />
                                  </Field>
                                </div>
                              </>
                            )}

                            {/* TAB SECTION 3: FISCAL REGIME & ACCOUNTING LOGIC */}
                           {activeTab === "accounting" && (
                             <>
                               <div className="md:col-span-2">
                                 <Field label={t.regime} error={errors.taxRegime}>
                                   <select
                                     name="taxRegime"
                                     value={form.taxRegime}
                                     onChange={handleChange}
                                     className={inputCls(errors.taxRegime)}
                                   >
                                     {/* FIX: options are filtered by form.personType via
                                         TAX_REGIMES_BY_PERSON (now just an array of valid
                                         codes per person type — no duplicated label field,
                                         to avoid the same translation-drift bug we hit with
                                         AccountCategory). Display text always comes from
                                         TAX_REGIME_LABELS[language], the single bilingual
                                         source of truth also used by the table/View panel. */}
                                     {(TAX_REGIMES_BY_PERSON[form.personType] || []).map((value) => (
                                       <option key={value} value={value}>
                                         {TAX_REGIME_LABELS[language]?.[value] || value}
                                       </option>
                                     ))}
                                   </select>
                                 </Field>
                                 <p className="mt-1 text-[11px] text-slate-400">
                                   {t.regimeHint} <strong>{form.personType === "JURIDICA" ? t.juridica : t.natural}</strong>
                                 </p>
                               </div>

                               <div className="md:col-span-2 pt-2">
                                 <Field label={t.costCenter}>
                                   {/* FIX: was showing ALL cost centers regardless of
                                       allowsMovement, but the backend's
                                       mapRequestToEntity() only accepts cost centers
                                       where allowsMovement === true — a "header" cost
                                       center (one with children) can't be assigned as
                                       a third party's default. Filtered here so a user
                                       can't pick an option that's guaranteed to fail. */}
                                   <select name="defaultCostCenterId" value={form.defaultCostCenterId} onChange={handleChange} className={inputCls()}>
                                     <option value="">{t.selectOption}</option>
                                     {costCenters
                                       .filter((cc) => cc.allowsMovement)
                                       .map((cc) => (
                                         <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>
                                       ))}
                                   </select>
                                 </Field>
                               </div>
                             </>
                           )}
                          </div>

                          {/* Lower Operational Control Buttons Group - Separado con mt-auto e hilos independientes */}
                          <div className="flex gap-3 pt-6 border-t border-slate-100 mt-8">
                            <Button type="submit" variant="primary" size="lg" fullWidth loading={isSaving}>
                              {editingIdRef.current ? t.update : t.save}
                            </Button>
                            <Button type="button" variant="secondary" size="lg" fullWidth onClick={closePanel} disabled={isSaving}>
                              {t.cancel}
                            </Button>
                          </div>
                        </form>
          </div>
        </div>
      )}

      {/* Read-only "View" Side Panel — shows the same 3 tabs as Editar, but no inputs */}
      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeViewPanel} />
          <div className="relative h-full w-full max-w-xl bg-white shadow-2xl flex flex-col">

            <div className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">{t.viewTitle}</h2>
              <button onClick={closeViewPanel} className="text-slate-400 hover:text-slate-700 text-2xl">×</button>
            </div>

            <div className="flex border-b border-slate-100 bg-slate-50 px-8 overflow-x-auto whitespace-nowrap">
              {[
                { id: "basic", label: t.tabBasic },
                { id: "location", label: t.tabLocation },
                { id: "accounting", label: t.tabAccounting }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewTab(tab.id)}
                  className={`border-b-2 px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                    viewTab === tab.id ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-8 flex flex-col">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 flex-1 auto-rows-max">

                {viewTab === "basic" && (
                  <>
                    <DataRow label={t.type} value={viewItem.personType === "JURIDICA" ? t.juridica : t.natural} t={t} />
                    <DataRow label={t.docType} value={viewItem.documentType} t={t} />
                    <DataRow
                      label={t.docNum}
                      value={`${viewItem.documentNumber || ""}${viewItem.verificationDigit != null ? `-${viewItem.verificationDigit}` : ""}`}
                      t={t}
                    />
                    {viewItem.personType === "JURIDICA" ? (
                      <div className="md:col-span-2">
                        <DataRow label={t.businessName} value={viewItem.businessName} t={t} />
                      </div>
                    ) : (
                      <>
                        <DataRow label={t.firstName} value={viewItem.firstName} t={t} />
                        <DataRow label={t.middleName} value={viewItem.middleName} t={t} />
                        <DataRow label={t.lastName} value={viewItem.lastName} t={t} />
                        <DataRow label={t.secondLastName} value={viewItem.secondLastName} t={t} />
                      </>
                    )}
                    <div className="md:col-span-2">
                      <DataRow label={t.tradeName} value={viewItem.tradeName} t={t} />
                    </div>
                    <div className="md:col-span-2">
                      <DataRow label={t.active} value={viewItem.active ? t.yes : t.no} t={t} />
                    </div>
                  </>
                )}

                {viewTab === "location" && (
                  <>
                    <div className="md:col-span-2">
                      <DataRow label={t.city} value={viewItem.cityName || getCityName(viewItem.cityId)} t={t} />
                    </div>
                    <div className="md:col-span-2">
                      <DataRow label={t.address} value={viewItem.address} t={t} />
                    </div>
                    <DataRow label={t.mobile} value={viewItem.mobile} t={t} />
                    <DataRow label={t.phone} value={viewItem.phone} t={t} />
                    <div className="md:col-span-2">
                      <DataRow label={t.email} value={viewItem.email} t={t} />
                    </div>
                    <div className="md:col-span-2">
                      <DataRow label={t.billingEmail} value={viewItem.billingEmail} t={t} />
                    </div>
                  </>
                )}

                {viewTab === "accounting" && (
                  <>
                    <div className="md:col-span-2">
                      {/* FIX: reuse getRegimeDisplayLabel (same source as
                          the table) which appends the person type in
                          parentheses for INDIVIDUAL/CORPORATE — both
                          display as "Régimen Ordinario" otherwise. */}
                      <DataRow
                        label={t.regime}
                        value={getRegimeDisplayLabel(viewItem.taxRegime, viewItem.personType, language, t)}
                        t={t}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <DataRow label={t.costCenter} value={getCostCenterLabel(viewItem.defaultCostCenterId)} t={t} />
                    </div>
                  </>
                )}

              </div>

              <div className="flex gap-3 pt-6 border-t border-slate-100 mt-8">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={() => {
                    closeViewPanel();
                    openEditPanel(viewItem);
                  }}
                >
                  {t.edit}
                </Button>
                <Button type="button" variant="secondary" size="lg" fullWidth onClick={closeViewPanel}>
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

// --- Shared Internal UI Layout Sub-Components ---
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

// Read-only equivalent of <Field>: shows label + value, with a placeholder when empty
function DataRow({ label, value, t }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      <div className="border-b-2 border-gray-100 p-3 text-sm text-slate-700 min-h-[42px]">
        {value ? value : <span className="text-slate-300 italic">{t.notProvided}</span>}
      </div>
    </div>
  );
}

export default ThirdPartyPage;
