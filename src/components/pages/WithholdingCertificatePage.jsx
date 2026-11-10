import { useEffect, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { inputClass } from "../ui/tokens";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

// NEW (2026-11-07): "Certificado de Retencion" generation screen --
// see claude/propuesta-certificados-retencion-2026-11-07.md. The
// preview and the PDF both come from the SAME backend render
// (WithholdingCertificateService.renderHtml()), so what's shown in the
// iframe below is byte-for-byte what gets printed into the download --
// this screen never reconstructs the document on its own.
//
// Parameters are loaded in two passes, same contract documented on
// WithholdingCertificateParametersDTO: first with just taxYear (to get
// the available tax types), then again with taxType added once the
// accountant picks one (to get the matching third parties).
//
// BULK MODE (2026-11-09, see
// claude/analisis-generacion-masiva-certificados-retencion-2026-11-09.md):
// adds a second mode that reuses the exact same taxYear/taxType
// filters and the exact same `thirdParties` list already loaded above,
// but instead of a single third party it lets the accountant check
// several (default: all of them, same "select all" default already
// proven for this kind of batch screen elsewhere) and downloads one
// .zip with one PDF per selected third party -- /zip on the backend
// streams it progressively, so this screen never has to hold more
// than one response in memory either. There is deliberately no bulk
// preview: previewing dozens of certificates at once isn't practical,
// and the individual mode right next to this one already covers that
// need for any one certificate, before or after a bulk run.
function sanitizeForFilename(value) {
  return (value || "").trim().replace(/[^A-Za-z0-9-]/g, "");
}

// A PDF/ZIP download can fail validation (e.g. no movements for that
// combination) just like any other call, but axios can't parse the
// JSON error body when the request used responseType: "blob" -- the
// server still sends JSON, axios just hands it back as a Blob instead
// of an object. Re-read it as text and parse it by hand so the same
// getApiErrorMessage()/error-code mapping still applies.
async function resolveDownloadError(err, language, fallback) {
  const data = err?.response?.data;
  if (data instanceof Blob && data.type.includes("json")) {
    try {
      const parsed = JSON.parse(await data.text());
      return getApiErrorMessage({ response: { data: parsed } }, language, fallback);
    } catch {
      return fallback;
    }
  }
  return getApiErrorMessage(err, language, fallback);
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function WithholdingCertificatePage({ language = "es" }) {
  const currentYear = new Date().getFullYear();
  const [mode, setMode] = useState("individual"); // "individual" | "masivo"
  const [taxYear, setTaxYear] = useState(String(currentYear));
  const [taxType, setTaxType] = useState("");
  const [thirdPartyDocument, setThirdPartyDocument] = useState("");
  const [selectedDocuments, setSelectedDocuments] = useState([]);

  const [taxTypes, setTaxTypes] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [loadingParams, setLoadingParams] = useState(false);

  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Certificados de Retencion",
      subtitle: "Genera el Certificado de Retencion de un tercero para un ano gravable y tipo de impuesto",
      modeIndividual: "Certificado individual",
      modeBulk: "Generacion masiva",
      taxYear: "Ano Gravable",
      taxType: "Tipo de Impuesto",
      selectTaxType: "-- Selecciona un tipo --",
      thirdParty: "Tercero",
      selectThirdParty: "-- Selecciona un tercero --",
      noThirdParties: "No hay terceros con movimientos de este tipo en este ano.",
      preview: "Vista Previa",
      previewing: "Generando vista previa...",
      downloadPdf: "Descargar PDF",
      downloading: "Generando PDF...",
      taxYearRequired: "Ingresa un ano gravable valido.",
      taxTypeRequired: "Selecciona un tipo de impuesto.",
      thirdPartyRequired: "Selecciona un tercero.",
      selectAtLeastOne: "Selecciona al menos un tercero.",
      errorConn: "Error de conexion con el servidor.",
      previewTitle: "Vista previa del certificado",
      bulkThirdParties: "Terceros con movimientos de este tipo en este ano",
      selectAll: "Seleccionar todos",
      deselectAll: "Deseleccionar todos",
      selectedCount: (n, total) => `${n} de ${total} seleccionados`,
      downloadZip: "Descargar ZIP",
      zipping: "Generando ZIP...",
      bulkHint: "Se genera un PDF por cada tercero marcado, empaquetado en un solo archivo .zip. Para reimprimir uno puntual despues, usa Certificado individual -- no hace falta buscarlo dentro del zip.",
      selectTaxTypeFirst: "Selecciona primero un tipo de impuesto para ver los terceros disponibles.",
    },
    en: {
      title: "Withholding Certificates",
      subtitle: "Generate a third party's Withholding Certificate for a tax year and tax type",
      modeIndividual: "Individual certificate",
      modeBulk: "Bulk generation",
      taxYear: "Tax Year",
      taxType: "Tax Type",
      selectTaxType: "-- Select a type --",
      thirdParty: "Third Party",
      selectThirdParty: "-- Select a third party --",
      noThirdParties: "No third parties with movements of this type in this year.",
      preview: "Preview",
      previewing: "Generating preview...",
      downloadPdf: "Download PDF",
      downloading: "Generating PDF...",
      taxYearRequired: "Enter a valid tax year.",
      taxTypeRequired: "Select a tax type.",
      thirdPartyRequired: "Select a third party.",
      selectAtLeastOne: "Select at least one third party.",
      errorConn: "Server connection error.",
      previewTitle: "Certificate preview",
      bulkThirdParties: "Third parties with movements of this type in this year",
      selectAll: "Select all",
      deselectAll: "Deselect all",
      selectedCount: (n, total) => `${n} of ${total} selected`,
      downloadZip: "Download ZIP",
      zipping: "Generating ZIP...",
      bulkHint: "Generates one PDF per checked third party, packaged into a single .zip file. To reissue one certificate later, use Individual certificate instead -- no need to dig through the zip.",
      selectTaxTypeFirst: "Select a tax type first to see the available third parties.",
    },
  }[language];

  const loadParameters = async (yearValue, typeValue) => {
    if (!yearValue) return;
    setLoadingParams(true);
    try {
      const params = { taxYear: Number(yearValue) };
      if (typeValue) params.taxType = typeValue;
      const response = await api.get("/v1/withholding-certificates/parameters", { params });
      if (response.data?.success) {
        const data = response.data.data || {};
        setTaxTypes(Array.isArray(data.taxTypes) ? data.taxTypes : []);
        setThirdParties(Array.isArray(data.thirdParties) ? data.thirdParties : []);
      }
    } catch (err) {
      // Non-fatal: catalogs just stay empty, same pattern as
      // TaxDetailPage.jsx's loadCatalogs(). Generation itself surfaces
      // its own validation errors through handlePreview/handleDownloadPdf.
      console.error("Failed to load withholding certificate parameters", err);
    } finally {
      setLoadingParams(false);
    }
  };

  useEffect(() => {
    loadParameters(taxYear, taxType);
  }, [taxYear, taxType]);

  // A previously selected third party (or stale preview/selection) may
  // no longer apply once the year/type filters change -- clear
  // whichever mode's selection rather than risk generating against a
  // combination the accountant didn't choose.
  useEffect(() => {
    setThirdPartyDocument("");
    setPreviewHtml(null);
  }, [taxYear, taxType]);

  // Bulk mode defaults to "all selected", same default already proven
  // for this kind of review-then-generate screen elsewhere -- it
  // re-applies whenever the third-party list changes (year/type
  // changed) or the accountant switches into this mode.
  useEffect(() => {
    if (mode === "masivo") {
      setSelectedDocuments(thirdParties.map((tp) => tp.documentNumber));
    }
  }, [thirdParties, mode]);

  const validateCommonFilters = () => {
    const yearNum = Number(taxYear);
    if (!taxYear || Number.isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear) {
      setError(t.taxYearRequired);
      return false;
    }
    if (!taxType) {
      setError(t.taxTypeRequired);
      return false;
    }
    return true;
  };

  const validateSelection = () => {
    if (!validateCommonFilters()) return false;
    if (!thirdPartyDocument) {
      setError(t.thirdPartyRequired);
      return false;
    }
    return true;
  };

  const validateBulkSelection = () => {
    if (!validateCommonFilters()) return false;
    if (selectedDocuments.length === 0) {
      setError(t.selectAtLeastOne);
      return false;
    }
    return true;
  };

  const handlePreview = async (e) => {
    e.preventDefault();
    setError(null);
    if (!validateSelection()) return;

    setPreviewLoading(true);
    setPreviewHtml(null);
    try {
      const response = await api.get("/v1/withholding-certificates/preview", {
        params: { taxYear: Number(taxYear), taxType, thirdPartyDocument },
      });
      setPreviewHtml(typeof response.data === "string" ? response.data : String(response.data));
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    setError(null);
    if (!validateSelection()) return;

    setPdfLoading(true);
    try {
      const response = await api.get("/v1/withholding-certificates/pdf", {
        params: { taxYear: Number(taxYear), taxType, thirdPartyDocument },
        responseType: "blob",
      });
      downloadBlob(
        new Blob([response.data], { type: "application/pdf" }),
        `certificado-retencion-${sanitizeForFilename(thirdPartyDocument)}-${sanitizeForFilename(taxType)}-${taxYear}.pdf`
      );
    } catch (err) {
      setError(await resolveDownloadError(err, language, t.errorConn));
    } finally {
      setPdfLoading(false);
    }
  };

  const toggleDocument = (documentNumber) => {
    setSelectedDocuments((prev) =>
      prev.includes(documentNumber) ? prev.filter((d) => d !== documentNumber) : [...prev, documentNumber]
    );
  };

  const allSelected = thirdParties.length > 0 && selectedDocuments.length === thirdParties.length;
  const toggleSelectAll = () => {
    setSelectedDocuments(allSelected ? [] : thirdParties.map((tp) => tp.documentNumber));
  };

  const handleDownloadZip = async () => {
    setError(null);
    if (!validateBulkSelection()) return;

    setZipLoading(true);
    try {
      // A single comma-separated value, not repeated query keys --
      // Spring's @RequestParam List<String> binds either form, and this
      // one sidesteps relying on axios's array-serialization defaults.
      const response = await api.get("/v1/withholding-certificates/zip", {
        params: {
          taxYear: Number(taxYear),
          taxType,
          thirdPartyDocuments: selectedDocuments.join(","),
        },
        responseType: "blob",
      });
      downloadBlob(
        new Blob([response.data], { type: "application/zip" }),
        `certificados-retencion-${sanitizeForFilename(taxType)}-${taxYear}.zip`
      );
    } catch (err) {
      setError(await resolveDownloadError(err, language, t.errorConn));
    } finally {
      setZipLoading(false);
    }
  };

  const switchMode = (nextMode) => {
    setError(null);
    setMode(nextMode);
  };

  return (
    <div className="space-y-6 p-4">
      <AppHeader title={t.title} subtitle={t.subtitle} tenantId={activeTenantId} language={language} />

      <div className="flex gap-2">
        <Button type="button" variant={mode === "individual" ? "primary" : "secondary"} onClick={() => switchMode("individual")}>
          {t.modeIndividual}
        </Button>
        <Button type="button" variant={mode === "masivo" ? "primary" : "secondary"} onClick={() => switchMode("masivo")}>
          {t.modeBulk}
        </Button>
      </div>

      {mode === "individual" ? (
        <form
          onSubmit={handlePreview}
          className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.taxYear}</label>
            <input
              type="number"
              min={2000}
              max={currentYear}
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              className={`${inputClass()} w-28`}
            />
          </div>

          <div className="flex min-w-[220px] flex-col gap-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.taxType}</label>
            <select
              value={taxType}
              onChange={(e) => setTaxType(e.target.value)}
              disabled={loadingParams}
              className={inputClass()}
            >
              <option value="">{t.selectTaxType}</option>
              {taxTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-[260px] flex-col gap-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.thirdParty}</label>
            <select
              value={thirdPartyDocument}
              onChange={(e) => setThirdPartyDocument(e.target.value)}
              disabled={loadingParams || !taxType}
              className={inputClass()}
            >
              <option value="">{t.selectThirdParty}</option>
              {thirdParties.map((tp) => (
                <option key={tp.documentNumber} value={tp.documentNumber}>
                  {tp.documentNumber} -- {tp.name}
                </option>
              ))}
            </select>
            {taxType && !loadingParams && thirdParties.length === 0 && (
              <span className="text-[11px] text-slate-500">{t.noThirdParties}</span>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={previewLoading}>
              {previewLoading ? t.previewing : t.preview}
            </Button>
            <Button type="button" variant="secondary" loading={pdfLoading} onClick={handleDownloadPdf}>
              {pdfLoading ? t.downloading : t.downloadPdf}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.taxYear}</label>
              <input
                type="number"
                min={2000}
                max={currentYear}
                value={taxYear}
                onChange={(e) => setTaxYear(e.target.value)}
                className={`${inputClass()} w-28`}
              />
            </div>

            <div className="flex min-w-[220px] flex-col gap-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.taxType}</label>
              <select
                value={taxType}
                onChange={(e) => setTaxType(e.target.value)}
                disabled={loadingParams}
                className={inputClass()}
              >
                <option value="">{t.selectTaxType}</option>
                {taxTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <Button type="button" variant="primary" loading={zipLoading} onClick={handleDownloadZip}>
              {zipLoading ? t.zipping : t.downloadZip}
            </Button>
          </div>

          <p className="text-[11px] text-slate-500">{t.bulkHint}</p>

          {!taxType ? (
            <p className="text-[11px] text-slate-500">{t.selectTaxTypeFirst}</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <div className="flex items-center justify-between border-b border-gray-100 bg-slate-50 px-4 py-2">
                <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={thirdParties.length === 0}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {allSelected ? t.deselectAll : t.selectAll}
                </label>
                <span className="text-[11px] text-slate-500">
                  {t.selectedCount(selectedDocuments.length, thirdParties.length)}
                </span>
              </div>

              {thirdParties.length === 0 ? (
                <p className="px-4 py-3 text-[11px] text-slate-500">{loadingParams ? "..." : t.noThirdParties}</p>
              ) : (
                <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
                  {thirdParties.map((tp) => (
                    <li key={tp.documentNumber} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedDocuments.includes(tp.documentNumber)}
                        onChange={() => toggleDocument(tp.documentNumber)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-slate-700">
                        {tp.documentNumber} -- {tp.name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {mode === "individual" && previewHtml && (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <h3 className="border-b border-gray-100 bg-slate-50 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
            {t.previewTitle}
          </h3>
          <iframe
            title={t.previewTitle}
            srcDoc={previewHtml}
            sandbox=""
            className="h-[70vh] w-full bg-white"
          />
        </div>
      )}
    </div>
  );
}

export default WithholdingCertificatePage;
