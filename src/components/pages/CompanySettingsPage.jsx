import { useEffect, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { inputClass } from "../ui/tokens";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

// NEW (2026-11-09): "Datos de la Empresa" -- see
// claude/progreso-2026-11-09.md. First screen that lets anyone edit
// Company data at all (companies were, until now, "provisioned
// directly in the database" per CompanyService's own class javadoc).
// Deliberately scoped to just the logo and the two signer slots --
// legalName/taxId/address/city stay read-only here as context, editing
// those is a separate, bigger concern this screen doesn't take on.
//
// The logo is stored and sent as a self-contained "data:image/...;
// base64,..." string (never a hosted URL) -- there is no multipart
// upload step and no new storage infrastructure (no bucket, nothing
// to pay for): the whole image just becomes one more field in the
// same JSON PATCH body CompanyService already validates and saves.
//
// UPDATED (2026-11-09): rather than just rejecting a file that's "too
// big", the image is downscaled client-side on an off-screen <canvas>
// before it's ever encoded -- see claude/progreso-2026-11-09.md
// ("DUDA: donde queda almacenado el logo?"). A logo only ever displays
// at a few dozen pixels tall in the certificate header, so there is no
// reason to store/back up/re-embed-into-every-PDF a multi-hundred-KB
// original. Downscaling to MAX_LOGO_DIMENSION_PX on the longest side
// (never upscaling a smaller image) keeps a real logo at a few dozen
// KB, comfortably under the backend's MAX_LOGO_DATA_URL_LENGTH,
// without asking the user to pre-shrink their own file.
const MAX_LOGO_SOURCE_FILE_BYTES = 8_000_000; // sanity cap on the ORIGINAL file so the browser doesn't try to decode something absurd -- unrelated to what ends up stored
const MAX_LOGO_DIMENSION_PX = 480; // longest side after resizing
const MAX_LOGO_RESULT_CHARS = 200_000; // mirrors CompanyService.MAX_LOGO_DATA_URL_LENGTH -- should never actually trigger after resizing, kept as a safety net

function CompanySettingsPage({ language = "es" }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const [company, setCompany] = useState(null);
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const [signers, setSigners] = useState({
    signer1Name: "",
    signer1Role: "",
    signer1IdNumber: "",
    signer1ProfessionalLicense: "",
    signer2Name: "",
    signer2Role: "",
    signer2IdNumber: "",
    signer2ProfessionalLicense: "",
  });

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Datos de la Empresa",
      subtitle: "Logo y firmantes usados en los certificados y demas documentos legales",
      companyData: "Datos de la compania (solo lectura)",
      legalName: "Razon Social",
      nit: "NIT",
      address: "Direccion",
      city: "Ciudad",
      logo: "Logo",
      uploadLogo: "Subir logo...",
      removeLogo: "Quitar logo",
      logoHint: "PNG o JPG. Se redimensiona automaticamente para el encabezado de los certificados.",
      logoTooLarge: "No se pudo procesar la imagen (muy grande o formato no soportado).",
      logoReadError: "No se pudo leer el archivo de imagen.",
      signer1: "Firmante 1 (ej. Representante Legal)",
      signer2: "Firmante 2 (ej. Contador)",
      name: "Nombre",
      role: "Cargo",
      idNumber: "Cedula",
      professionalLicense: "Tarjeta Profesional",
      signerHint: "Deja un firmante completamente vacio para omitirlo del certificado -- se usaran las lineas genericas de firma mientras ninguno este configurado.",
      save: "Guardar",
      saving: "Guardando...",
      saved: "Datos guardados.",
      errorConn: "Error de conexion con el servidor.",
      loadError: "No se pudieron cargar los datos de la empresa.",
    },
    en: {
      title: "Company Data",
      subtitle: "Logo and signers used on withholding certificates and other legal documents",
      companyData: "Company data (read-only)",
      legalName: "Legal Name",
      nit: "Tax ID",
      address: "Address",
      city: "City",
      logo: "Logo",
      uploadLogo: "Upload logo...",
      removeLogo: "Remove logo",
      logoHint: "PNG or JPG. Automatically resized for the certificate header.",
      logoTooLarge: "Could not process the image (too large or unsupported format).",
      logoReadError: "Could not read the image file.",
      signer1: "Signer 1 (e.g. Legal Representative)",
      signer2: "Signer 2 (e.g. Accountant)",
      name: "Name",
      role: "Role",
      idNumber: "ID Number",
      professionalLicense: "Professional License",
      signerHint: "Leave a signer completely blank to omit it from the certificate -- the generic signature lines are used while none is configured.",
      save: "Save",
      saving: "Saving...",
      saved: "Settings saved.",
      errorConn: "Server connection error.",
      loadError: "Could not load the company data.",
    },
  }[language];

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get("/v1/companies/me");
        if (!active) return;
        if (response.data?.success) {
          const data = response.data.data || {};
          setCompany(data);
          setLogoDataUrl(data.logoDataUrl || null);
          setSigners({
            signer1Name: data.signer1Name || "",
            signer1Role: data.signer1Role || "",
            signer1IdNumber: data.signer1IdNumber || "",
            signer1ProfessionalLicense: data.signer1ProfessionalLicense || "",
            signer2Name: data.signer2Name || "",
            signer2Role: data.signer2Role || "",
            signer2IdNumber: data.signer2IdNumber || "",
            signer2ProfessionalLicense: data.signer2ProfessionalLicense || "",
          });
        }
      } catch (err) {
        if (active) setError(getApiErrorMessage(err, language, t.loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // FIX (2026-11-09): PNG is lossless, so a resized-but-still-complex
  // source (gradients, soft shadows, a photo-like logo -- anything
  // beyond flat colors) can still land over MAX_LOGO_RESULT_CHARS even
  // after shrinking to MAX_LOGO_DIMENSION_PX; a real 516 KB PNG hit
  // exactly that and got rejected even though it had already been
  // resized. Falls back to JPEG (adjustable, lossy compression) at
  // decreasing quality, and only then to a smaller canvas, instead of
  // just rejecting. JPEG has no transparency, so white is painted
  // behind it first -- the certificate prints on white paper anyway,
  // so that is visually identical to a transparent background there.
  const encodeLogoWithinLimit = (img, startDimension, maxChars) => {
    let dimension = startDimension;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const scale = Math.min(1, dimension / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const png = canvas.toDataURL("image/png");
      if (png.length <= maxChars) {
        return png;
      }

      for (const quality of [0.9, 0.75, 0.6, 0.45]) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const jpeg = canvas.toDataURL("image/jpeg", quality);
        if (jpeg.length <= maxChars) {
          return jpeg;
        }
      }

      dimension = Math.round(dimension / 2);
    }
    return null;
  };

  const handleLogoFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // always reset, whether accepted or rejected
    if (!file) return;
    setError(null);
    if (file.size > MAX_LOGO_SOURCE_FILE_BYTES) {
      setError(t.logoTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const encoded = encodeLogoWithinLimit(img, MAX_LOGO_DIMENSION_PX, MAX_LOGO_RESULT_CHARS);
        if (!encoded) {
          setError(t.logoTooLarge);
          return;
        }
        setLogoDataUrl(encoded);
      };
      img.onerror = () => setError(t.logoReadError);
      img.src = reader.result;
    };
    reader.onerror = () => setError(t.logoReadError);
    reader.readAsDataURL(file);
  };

  const updateSigner = (field, value) => {
    setSigners((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      const response = await api.patch("/v1/companies/me/signature-settings", {
        logoDataUrl,
        ...signers,
      });
      if (response.data?.success) {
        setSuccess(true);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setSaving(false);
    }
  };

  const signerFields = (prefix, title) => (
    <div className="flex-1 space-y-3 rounded-lg border border-gray-100 p-4">
      <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">{title}</h3>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.name}</label>
        <input
          type="text"
          value={signers[`${prefix}Name`]}
          onChange={(e) => updateSigner(`${prefix}Name`, e.target.value)}
          className={inputClass()}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.role}</label>
        <input
          type="text"
          value={signers[`${prefix}Role`]}
          onChange={(e) => updateSigner(`${prefix}Role`, e.target.value)}
          className={inputClass()}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.idNumber}</label>
        <input
          type="text"
          value={signers[`${prefix}IdNumber`]}
          onChange={(e) => updateSigner(`${prefix}IdNumber`, e.target.value)}
          className={inputClass()}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.professionalLicense}</label>
        <input
          type="text"
          value={signers[`${prefix}ProfessionalLicense`]}
          onChange={(e) => updateSigner(`${prefix}ProfessionalLicense`, e.target.value)}
          className={inputClass()}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-4">
      <AppHeader title={t.title} subtitle={t.subtitle} tenantId={activeTenantId} language={language} />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{t.saved}</Alert>}

      {!loading && company && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">
              {t.companyData}
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.legalName}</div>
                <div className="text-slate-700">{company.legalName}</div>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.nit}</div>
                <div className="text-slate-700">
                  {company.taxId}
                  {company.verificationDigit ? `-${company.verificationDigit}` : ""}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.address}</div>
                <div className="text-slate-700">{company.address || "--"}</div>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.city}</div>
                <div className="text-slate-700">{company.cityName || "--"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">{t.logo}</h3>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-slate-50">
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt={t.logo} className="max-h-14 max-w-36 object-contain" />
                ) : (
                  <span className="text-[10px] text-slate-400">{t.logo}</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="cursor-pointer text-sm font-semibold text-blue-600 hover:text-blue-700">
                  {t.uploadLogo}
                  <input type="file" accept="image/png,image/jpeg" onChange={handleLogoFileChange} className="hidden" />
                </label>
                {logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setLogoDataUrl(null)}
                    className="text-left text-sm font-semibold text-slate-500 hover:text-red-600"
                  >
                    {t.removeLogo}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{t.logoHint}</p>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Firmas</h3>
            <div className="flex flex-wrap gap-4">
              {signerFields("signer1", t.signer1)}
              {signerFields("signer2", t.signer2)}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">{t.signerHint}</p>
          </div>

          <Button type="submit" variant="primary" loading={saving}>
            {saving ? t.saving : t.save}
          </Button>
        </form>
      )}
    </div>
  );
}

export default CompanySettingsPage;
