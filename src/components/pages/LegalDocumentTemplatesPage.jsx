import { useEffect, useRef, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Field from "../ui/Field";
import Modal from "../ui/Modal";
import { inputClass } from "../ui/tokens";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

// NEW (2026-11-07): admin screen for the "Certificados de Retencion"
// feature -- see claude/propuesta-certificados-retencion-2026-11-07.md.
// Only the normative body text, the footer note and the printed
// document title are editable here; the header (emisor/receptor data),
// the amounts table and the signature lines stay code-controlled (see
// certificate-skeleton.html on the backend). TEMPLATE_KEY is the one
// key the backend currently knows about -- when a second legal
// document type exists, this screen gains a selector instead of this
// hardcoded constant (service.list()/the GET "" endpoint already
// support more than one row per company).
const TEMPLATE_KEY = "WITHHOLDING_CERTIFICATE";

// Only body/footer accept {{variables}} -- documentTitle is inserted
// into the skeleton as a plain scope value, not re-resolved through
// Mustache, so a {{variable}} typed there would print literally instead
// of being substituted. See WithholdingCertificateService.renderHtml().
const VARIABLES = [
  "company_name",
  "company_nit",
  "company_address",
  "company_city",
  "third_party_name",
  "third_party_nit",
  "nit",
  "tax_year",
  "tax_type_label",
  "total_base",
  "total_withheld",
  "issue_date",
  "issue_city",
];

const EMPTY_FORM = { name: "", documentTitle: "", bodyHtml: "", footerHtml: "" };

function LegalDocumentTemplatesPage({ language = "es" }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const bodyRef = useRef(null);
  const footerRef = useRef(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Plantillas Legales",
      subtitle: "Texto normativo editable de los documentos legales que emite el sistema -- hoy, el Certificado de Retencion",
      sectionLabel: "Certificado de Retencion",
      defaultBadge: "Usando la plantilla por defecto del sistema -- aun no se ha guardado una version propia.",
      savedBadge: "Mostrando la version guardada por tu compania.",
      name: "Nombre (uso interno)",
      documentTitle: "Titulo del documento",
      documentTitleHint: "Se imprime en el PDF tal cual, sin variables.",
      bodyHtml: "Cuerpo normativo",
      bodyHtmlHint: "Texto legal que certifica la retencion. Acepta las variables de abajo.",
      footerHtml: "Pie de pagina",
      footerHtmlHint: "Nota al pie, opcional. Acepta las mismas variables.",
      variablesLabel: "Variables disponibles -- clic para insertar",
      save: "Guardar",
      saving: "Guardando...",
      restoreDefault: "Restaurar plantilla por defecto",
      restoring: "Restaurando...",
      confirmRestoreTitle: "Restaurar plantilla por defecto",
      confirmRestoreBody: "Esto reemplazara el cuerpo, el pie y el titulo que ves en el formulario con el texto por defecto del sistema. El cambio no se guarda todavia -- revisa el resultado y presiona \"Guardar\" para confirmarlo.",
      confirmRestoreButton: "Si, cargar valores por defecto",
      cancelButton: "Cancelar",
      saveSuccess: "Plantilla guardada.",
      loadError: "No se pudo cargar la plantilla.",
      saveError: "No se pudo guardar la plantilla.",
      restoreError: "No se pudo cargar la plantilla por defecto.",
      requiredFields: "Nombre y cuerpo normativo son obligatorios.",
    },
    en: {
      title: "Legal Templates",
      subtitle: "Editable legal text for the documents the system issues -- today, the Withholding Certificate",
      sectionLabel: "Withholding Certificate",
      defaultBadge: "Using the system's built-in default -- no custom version has been saved yet.",
      savedBadge: "Showing your company's saved version.",
      name: "Name (internal use)",
      documentTitle: "Document title",
      documentTitleHint: "Printed on the PDF as-is, variables are not resolved here.",
      bodyHtml: "Normative body",
      bodyHtmlHint: "Legal text certifying the withholding. Accepts the variables below.",
      footerHtml: "Footer note",
      footerHtmlHint: "Optional footer note. Accepts the same variables.",
      variablesLabel: "Available variables -- click to insert",
      save: "Save",
      saving: "Saving...",
      restoreDefault: "Restore default template",
      restoring: "Restoring...",
      confirmRestoreTitle: "Restore default template",
      confirmRestoreBody: "This will replace the body, footer and title shown in the form with the system's default text. The change is not saved yet -- review the result and press \"Save\" to confirm it.",
      confirmRestoreButton: "Yes, load default values",
      cancelButton: "Cancel",
      saveSuccess: "Template saved.",
      loadError: "Could not load the template.",
      saveError: "Could not save the template.",
      restoreError: "Could not load the default template.",
      requiredFields: "Name and normative body are required.",
    },
  }[language];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get(`/v1/legal-document-templates/${TEMPLATE_KEY}`)
      .then((response) => {
        if (cancelled) return;
        const data = response.data?.data;
        if (data) {
          setForm({
            name: data.name || "",
            documentTitle: data.documentTitle || "",
            bodyHtml: data.bodyHtml || "",
            footerHtml: data.footerHtml || "",
          });
          setIsDefault(Boolean(data.isDefault));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err, language, t.loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  // Inserts {{variable}} at the current cursor position of whichever
  // textarea it's bound to, instead of just appending it at the end --
  // same "click a suggestion, it lands where you're typing" pattern
  // already used for PUC/Tax type name suggestions elsewhere in the app.
  const insertVariable = (field, ref, variable) => {
    const token = `{{${variable}}}`;
    const el = ref.current;
    if (!el) {
      setForm((prev) => ({ ...prev, [field]: (prev[field] || "") + token }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setForm((prev) => {
      const current = prev[field] || "";
      const next = current.slice(0, start) + token + current.slice(end);
      return { ...prev, [field]: next };
    });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.name.trim() || !form.bodyHtml.trim()) {
      setError(t.requiredFields);
      return;
    }

    setSaving(true);
    try {
      const response = await api.put(`/v1/legal-document-templates/${TEMPLATE_KEY}`, {
        name: form.name,
        documentTitle: form.documentTitle,
        bodyHtml: form.bodyHtml,
        footerHtml: form.footerHtml,
      });
      const data = response.data?.data;
      if (data) {
        setForm({
          name: data.name || "",
          documentTitle: data.documentTitle || "",
          bodyHtml: data.bodyHtml || "",
          footerHtml: data.footerHtml || "",
        });
        setIsDefault(Boolean(data.isDefault));
      }
      setToast({ type: "success", msg: t.saveSuccess });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.saveError));
    } finally {
      setSaving(false);
    }
  };

  const confirmRestore = async () => {
    setRestoring(true);
    setError(null);
    try {
      const response = await api.get(`/v1/legal-document-templates/${TEMPLATE_KEY}/default`);
      const data = response.data?.data;
      if (data) {
        setForm({
          name: data.name || "",
          documentTitle: data.documentTitle || "",
          bodyHtml: data.bodyHtml || "",
          footerHtml: data.footerHtml || "",
        });
      }
      setConfirmingRestore(false);
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.restoreError));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      <AppHeader title={t.title} subtitle={t.subtitle} tenantId={activeTenantId} language={language} />

      {toast && (
        <Alert tone="success">{toast.msg}</Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">{t.sectionLabel}</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => setConfirmingRestore(true)}
          >
            {t.restoreDefault}
          </Button>
        </div>

        <Alert tone={isDefault ? "info" : "success"} className="mb-4">
          {isDefault ? t.defaultBadge : t.savedBadge}
        </Alert>

        {loading ? (
          <p className="text-sm text-slate-500">...</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.name} required>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange("name")}
                  className={inputClass()}
                />
              </Field>

              <Field label={t.documentTitle} hint={t.documentTitleHint}>
                <input
                  type="text"
                  value={form.documentTitle}
                  onChange={handleChange("documentTitle")}
                  className={inputClass()}
                />
              </Field>
            </div>

            <Field label={t.bodyHtml} hint={t.bodyHtmlHint} required>
              <textarea
                ref={bodyRef}
                rows={12}
                value={form.bodyHtml}
                onChange={handleChange("bodyHtml")}
                className={`${inputClass()} font-mono text-xs leading-relaxed`}
              />
            </Field>

            <div className="flex flex-wrap gap-1.5">
              <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {t.variablesLabel}
              </span>
              {VARIABLES.map((variable) => (
                <button
                  key={`body-${variable}`}
                  type="button"
                  onClick={() => insertVariable("bodyHtml", bodyRef, variable)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>

            <Field label={t.footerHtml} hint={t.footerHtmlHint}>
              <textarea
                ref={footerRef}
                rows={5}
                value={form.footerHtml}
                onChange={handleChange("footerHtml")}
                className={`${inputClass()} font-mono text-xs leading-relaxed`}
              />
            </Field>

            <div className="flex flex-wrap gap-1.5">
              <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {t.variablesLabel}
              </span>
              {VARIABLES.map((variable) => (
                <button
                  key={`footer-${variable}`}
                  type="button"
                  onClick={() => insertVariable("footerHtml", footerRef, variable)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>
                {saving ? t.saving : t.save}
              </Button>
            </div>
          </form>
        )}
      </div>

      {confirmingRestore && (
        <Modal
          title={t.confirmRestoreTitle}
          onClose={() => !restoring && setConfirmingRestore(false)}
          footer={
            <>
              <Button type="button" variant="secondary" disabled={restoring} onClick={() => setConfirmingRestore(false)}>
                {t.cancelButton}
              </Button>
              <Button type="button" variant="danger" loading={restoring} onClick={confirmRestore}>
                {restoring ? t.restoring : t.confirmRestoreButton}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">{t.confirmRestoreBody}</p>
        </Modal>
      )}
    </div>
  );
}

export default LegalDocumentTemplatesPage;
