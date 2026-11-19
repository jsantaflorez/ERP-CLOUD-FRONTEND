import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Modal from "../ui/Modal";
import { inputClass } from "../ui/tokens";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";

// NEW (2026-11-12, user request): punto único de entrada "Migración desde
// SIEWIN". Agrupa los tres importadores que ya existían en pantallas
// distintas (PUC en Plan de Cuentas, Terceros en Terceros, Saldos en su
// propia pantalla) y los presenta en el orden obligatorio:
//   1. PUC  ->  2. Terceros  ->  3. Saldos de apertura
// (los saldos se cruzan contra el PUC y los terceros ya migrados).
// Esta pantalla NO duplica ningún importador: solo cuenta lo que la
// compañía ya tiene y lleva a la pantalla correspondiente, abriendo el
// modal de SIEWIN automáticamente (props autoOpenSiewin de
// ChartOfAccountPage / ThirdPartyPage).
// El paso 1 se muestra siempre. UPDATE 2026-11-17: si la compañía ya
// tiene cuentas, ofrece "agregar cuentas nuevas" (vuelve a subir el PUC
// actual y solo crea las que faltan) en vez de quedar bloqueado.

const T = {
  es: {
    title: "Migración desde SIEWIN",
    subtitle: "Trae a esta compañía la información del sistema anterior, en tres pasos y en este orden.",
    orderNote: "Los saldos de apertura se cruzan contra el plan de cuentas y los terceros ya migrados: completa los pasos 1 y 2 antes del 3.",
    step: "Paso",
    pucTitle: "Plan de cuentas (PUC)",
    pucDesc: "Importa el PUC exportado de SIEWIN con sus cuentas, naturaleza y requisitos de tercero/centro de costo.",
    pucCount: (n) => `${n} cuenta${n === 1 ? "" : "s"} en esta compañía`,
    pucAddMissingNote: "Esta compañía ya tiene plan de cuentas. Si el PUC cambió en SIEWIN después de la primera migración (por ejemplo, el balance reporta cuentas que no existen), sube el PUC actual: solo se agregan las cuentas que faltan y ninguna existente se modifica.",
    pucButton: "Importar PUC",
    pucAddMissingButton: "Agregar cuentas nuevas del PUC",
    resetButton: "Borrar plan de cuentas…",
    resetHint: "¿Migraste un PUC equivocado o desactualizado? Mientras no haya comprobantes puedes borrarlo e importarlo de nuevo.",
    resetTitle: "Borrar el plan de cuentas",
    resetChecking: "Revisando si se puede borrar…",
    resetBlockedTitle: "No se puede borrar: ya hay información registrada con estas cuentas.",
    resetWarningTitle: (n) => `Se borrarán las ${n} cuentas del plan de cuentas de esta compañía. No se puede deshacer.`,
    resetAlsoTitle: "También se hará esto (tendrás que configurarlo de nuevo después de importar):",
    resetDocTypes: (n) => `Se quitará la cuenta por defecto de ${n} tipo(s) de documento.`,
    resetClosingAccounts: "Se quitarán las cuentas de ganancia y pérdida de la compañía (Configuración de la empresa).",
    resetTaxes: (list) => `Se eliminarán ${list.length} impuesto(s): ${list.join(", ")}.`,
    resetTypeToConfirm: "Escribe BORRAR para confirmar",
    resetConfirm: "Borrar plan de cuentas",
    resetCancel: "Cancelar",
    resetClose: "Cerrar",
    resetDone: (r) => `Plan de cuentas borrado: ${r.accountsDeleted} cuentas eliminadas. Ya puedes importar el PUC de nuevo (paso 1).`,
    tpTitle: "Terceros",
    tpDesc: "Importa clientes, proveedores y demás terceros. Puede repetirse: los ya existentes se reportan, no se duplican.",
    tpCount: (n) => `${n} tercero${n === 1 ? "" : "s"} en esta compañía`,
    tpButton: "Importar terceros",
    balTitle: "Saldos de apertura",
    balDesc: "Importa el Libro de Inventario y Balance de cierre de SIEWIN y genera el comprobante de saldos iniciales.",
    balNeedsPuc: "Primero necesitas el plan de cuentas (paso 1).",
    balButton: "Ir a migración de saldos",
    done: "Listo",
    pending: "Pendiente",
    loading: "Consultando…",
    countError: "No se pudo consultar",
  },
  en: {
    title: "Migration from SIEWIN",
    subtitle: "Bring this company's data over from the previous system, in three steps and in this order.",
    orderNote: "Opening balances are matched against the already migrated chart of accounts and third parties: finish steps 1 and 2 before step 3.",
    step: "Step",
    pucTitle: "Chart of accounts (PUC)",
    pucDesc: "Imports the PUC exported from SIEWIN with its accounts, nature and third-party/cost-center requirements.",
    pucCount: (n) => `${n} account${n === 1 ? "" : "s"} in this company`,
    pucAddMissingNote: "This company already has a chart of accounts. If the PUC changed in SIEWIN after the first migration (for example, the balance reports accounts that don't exist), upload the current PUC: only missing accounts are added and no existing one is modified.",
    pucButton: "Import PUC",
    pucAddMissingButton: "Add new PUC accounts",
    resetButton: "Delete chart of accounts…",
    resetHint: "Migrated a wrong or outdated PUC? While there are no entries you can delete it and import it again.",
    resetTitle: "Delete the chart of accounts",
    resetChecking: "Checking whether it can be deleted…",
    resetBlockedTitle: "Can't delete: information is already recorded with these accounts.",
    resetWarningTitle: (n) => `All ${n} accounts of this company's chart of accounts will be deleted. This can't be undone.`,
    resetAlsoTitle: "This will also happen (you'll need to configure it again after importing):",
    resetDocTypes: (n) => `The default account will be removed from ${n} document type(s).`,
    resetClosingAccounts: "The company's gain and loss accounts will be removed (Company settings).",
    resetTaxes: (list) => `${list.length} tax(es) will be deleted: ${list.join(", ")}.`,
    resetTypeToConfirm: "Type BORRAR to confirm",
    resetConfirm: "Delete chart of accounts",
    resetCancel: "Cancel",
    resetClose: "Close",
    resetDone: (r) => `Chart of accounts deleted: ${r.accountsDeleted} accounts removed. You can import the PUC again (step 1).`,
    tpTitle: "Third parties",
    tpDesc: "Imports customers, suppliers and other third parties. It can be repeated: existing ones are reported, not duplicated.",
    tpCount: (n) => `${n} third part${n === 1 ? "y" : "ies"} in this company`,
    tpButton: "Import third parties",
    balTitle: "Opening balances",
    balDesc: "Imports SIEWIN's closing Inventory and Balance book and creates the opening balance entry.",
    balNeedsPuc: "You need the chart of accounts first (step 1).",
    balButton: "Go to balance migration",
    done: "Done",
    pending: "Pending",
    loading: "Checking…",
    countError: "Could not check",
  },
};

// Total de un listado paginado. /v1/chart-of-accounts responde con el
// sobre ApiResponse ({success, data: Page}); /v1/third-parties responde
// la Page directamente. Se aceptan ambas formas.
function totalFrom(body) {
  const page = body && body.success !== undefined ? body.data : body;
  if (Array.isArray(page)) return page.length;
  if (page && typeof page.totalElements === "number") return page.totalElements;
  return 0;
}

function StepCard({ number, title, description, status, statusLabel, info, children }) {
  const badge =
    status === "done"
      ? "bg-emerald-100 text-emerald-800"
      : "bg-slate-100 text-slate-700";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            status === "done" ? "bg-emerald-600 text-white" : "bg-indigo-600 text-white"
          }`}
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {statusLabel && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>{statusLabel}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
          {info && <p className="mt-1 text-xs text-slate-500">{info}</p>}
          <div className="mt-3 space-y-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

StepCard.propTypes = {
  number: PropTypes.number.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  status: PropTypes.oneOf(["done", "pending", "unknown"]),
  statusLabel: PropTypes.string,
  info: PropTypes.string,
  children: PropTypes.node,
};

function SiewinMigrationPage({ language = "es", onNavigate }) {
  const t = T[language] || T.es;
  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  // null = consultando; número = total; "error" = falló la consulta.
  const [accountCount, setAccountCount] = useState(null);
  const [thirdPartyCount, setThirdPartyCount] = useState(null);
  const [error, setError] = useState("");

  // NEW (2026-11-17): borrar todo el plan de cuentas (solo sin
  // movimientos) para volver a importarlo -- ChartOfAccountResetService.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPreview, setResetPreview] = useState(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetBlockers, setResetBlockers] = useState(null);
  const [resetResult, setResetResult] = useState(null);

  const openReset = async () => {
    setResetOpen(true);
    setResetPreview(null);
    setResetConfirmText("");
    setResetError("");
    setResetBlockers(null);
    try {
      const response = await api.get("/v1/chart-of-accounts/reset-preview");
      setResetPreview(response.data?.data || null);
    } catch (err) {
      setResetError(getApiErrorMessage(err, language, t.countError));
    }
  };

  const closeReset = () => {
    if (resetting) return;
    setResetOpen(false);
  };

  const confirmReset = async () => {
    setResetting(true);
    setResetError("");
    try {
      const response = await api.post("/v1/chart-of-accounts/reset", { confirmation: resetConfirmText });
      setResetResult(response.data?.data || {});
      setResetOpen(false);
      setAccountCount(null);
      setThirdPartyCount(null);
      fetchCounts();
    } catch (err) {
      const details = err?.response?.data?.data;
      if (err?.response?.data?.message === "CHART_OF_ACCOUNTS_RESET_BLOCKED" && Array.isArray(details)) {
        setResetBlockers(details);
      } else {
        setResetError(getApiErrorMessage(err, language, t.countError));
      }
    } finally {
      setResetting(false);
    }
  };

  // Se consulta cada vez que se entra a la pantalla (al volver de un paso
  // el Dashboard la monta de nuevo, así que los conteos quedan al día).
  const fetchCounts = async () => {
    const [acc, tp] = await Promise.allSettled([
      api.get("/v1/chart-of-accounts", { params: { page: 0, size: 1 } }),
      api.get("/v1/third-parties", { params: { page: 0, size: 1 } }),
    ]);
    if (acc.status === "fulfilled") setAccountCount(totalFrom(acc.value.data));
    else setAccountCount("error");
    if (tp.status === "fulfilled") setThirdPartyCount(totalFrom(tp.value.data));
    else setThirdPartyCount("error");
    const failed = [acc, tp].find((r) => r.status === "rejected");
    setError(failed ? getApiErrorMessage(failed.reason, language, t.countError) : "");
  };

  useEffect(() => {
    fetchCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countInfo = (value, fmt) => {
    if (value === null) return t.loading;
    if (value === "error") return t.countError;
    return fmt(value);
  };
  const statusOf = (value) =>
    typeof value === "number" ? (value > 0 ? "done" : "pending") : "unknown";
  const labelOf = (value) =>
    typeof value === "number" ? (value > 0 ? t.done : t.pending) : null;

  const hasAccounts = typeof accountCount === "number" && accountCount > 0;
  const noAccounts = accountCount === 0;

  return (
    <div className="space-y-4">
      <AppHeader
        title={t.title}
        subtitle={t.subtitle}
        tenantId={activeTenantId}
        language={language}
      />

      <Alert tone="info">{t.orderNote}</Alert>
      {error && <Alert tone="error">{error}</Alert>}
      {resetResult && <Alert tone="success">{t.resetDone(resetResult)}</Alert>}

      <ol className="space-y-4">
        <li>
          <StepCard
            number={1}
            title={t.pucTitle}
            description={t.pucDesc}
            status={statusOf(accountCount)}
            statusLabel={labelOf(accountCount)}
            info={countInfo(accountCount, t.pucCount)}
          >
            {/* UPDATE 2026-11-17: con plan ya cargado el paso 1 ya no queda
                bloqueado -- ofrece "agregar cuentas nuevas" (mode
                ADD_MISSING del backend). */}
            {hasAccounts && <Alert tone="info">{t.pucAddMissingNote}</Alert>}
            <Button
              variant={hasAccounts ? "secondary" : "primary"}
              disabled={!noAccounts && !hasAccounts}
              onClick={() => onNavigate("chartOfAccount", { openSiewin: true })}
            >
              {hasAccounts ? t.pucAddMissingButton : t.pucButton}
            </Button>
            {hasAccounts && (
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500">{t.resetHint}</p>
                <Button variant="danger" size="sm" className="mt-2" onClick={openReset}>
                  {t.resetButton}
                </Button>
              </div>
            )}
          </StepCard>
        </li>
        <li>
          <StepCard
            number={2}
            title={t.tpTitle}
            description={t.tpDesc}
            status={statusOf(thirdPartyCount)}
            statusLabel={labelOf(thirdPartyCount)}
            info={countInfo(thirdPartyCount, t.tpCount)}
          >
            <Button
              variant="primary"
              onClick={() => onNavigate("thirdParties", { openSiewin: true })}
            >
              {t.tpButton}
            </Button>
          </StepCard>
        </li>
        <li>
          <StepCard number={3} title={t.balTitle} description={t.balDesc} status="unknown">
            {noAccounts && <Alert tone="warning">{t.balNeedsPuc}</Alert>}
            <Button
              variant="primary"
              disabled={noAccounts}
              onClick={() => onNavigate("openingBalanceImport")}
            >
              {t.balButton}
            </Button>
          </StepCard>
        </li>
      </ol>

      {resetOpen && (
        <Modal
          title={t.resetTitle}
          onClose={closeReset}
          dismissible={!resetting}
          footer={
            <>
              <Button variant="secondary" onClick={closeReset} disabled={resetting}>
                {resetPreview?.allowed && !resetBlockers ? t.resetCancel : t.resetClose}
              </Button>
              {resetPreview?.allowed && !resetBlockers && (
                <Button
                  variant="dangerSolid"
                  loading={resetting}
                  disabled={resetConfirmText !== "BORRAR"}
                  onClick={confirmReset}
                >
                  {t.resetConfirm}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {!resetPreview && !resetError && <p className="text-slate-500">{t.resetChecking}</p>}
            {resetError && <Alert tone="error">{resetError}</Alert>}
            {(resetBlockers || (resetPreview && !resetPreview.allowed)) && (
              <Alert tone="error" title={t.resetBlockedTitle}>
                <ul className="ml-4 list-disc">
                  {(resetBlockers || resetPreview.blockers).map((b) => <li key={b}>{b}</li>)}
                </ul>
              </Alert>
            )}
            {resetPreview?.allowed && !resetBlockers && (
              <>
                <Alert tone="warning" title={t.resetWarningTitle(resetPreview.accountCount)} />
                {(resetPreview.documentTypesWithDefaultAccount > 0 || resetPreview.companyClosingAccountsSet
                  || resetPreview.taxesToDelete?.length > 0) && (
                  <div>
                    <p className="font-medium text-slate-700">{t.resetAlsoTitle}</p>
                    <ul className="ml-4 mt-1 list-disc text-slate-600">
                      {resetPreview.documentTypesWithDefaultAccount > 0 && (
                        <li>{t.resetDocTypes(resetPreview.documentTypesWithDefaultAccount)}</li>
                      )}
                      {resetPreview.companyClosingAccountsSet && <li>{t.resetClosingAccounts}</li>}
                      {resetPreview.taxesToDelete?.length > 0 && <li>{t.resetTaxes(resetPreview.taxesToDelete)}</li>}
                    </ul>
                  </div>
                )}
                <label className="block">
                  <span className="text-slate-700">{t.resetTypeToConfirm}</span>
                  <input
                    type="text"
                    autoComplete="off"
                    className={`mt-1 ${inputClass(false)}`}
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    disabled={resetting}
                  />
                </label>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

SiewinMigrationPage.propTypes = {
  language: PropTypes.string,
  onNavigate: PropTypes.func.isRequired,
};

export default SiewinMigrationPage;
