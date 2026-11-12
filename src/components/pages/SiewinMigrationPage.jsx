import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
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
// El paso 1 se muestra siempre; si la compañía ya tiene cuentas queda
// deshabilitado con el aviso, en vez de desaparecer como pasaba con el
// enlace dentro de Plan de Cuentas.

const T = {
  es: {
    title: "Migración desde SIEWIN",
    subtitle: "Trae a esta compañía la información del sistema anterior, en tres pasos y en este orden.",
    orderNote: "Los saldos de apertura se cruzan contra el plan de cuentas y los terceros ya migrados: completa los pasos 1 y 2 antes del 3.",
    step: "Paso",
    pucTitle: "Plan de cuentas (PUC)",
    pucDesc: "Importa el PUC exportado de SIEWIN con sus cuentas, naturaleza y requisitos de tercero/centro de costo.",
    pucCount: (n) => `${n} cuenta${n === 1 ? "" : "s"} en esta compañía`,
    pucBlocked: "Esta compañía ya tiene plan de cuentas, por eso la importación del PUC está deshabilitada (solo se permite sobre una compañía sin cuentas). Puedes seguir con los pasos 2 y 3.",
    pucButton: "Importar PUC",
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
    reload: "Actualizar",
  },
  en: {
    title: "Migration from SIEWIN",
    subtitle: "Bring this company's data over from the previous system, in three steps and in this order.",
    orderNote: "Opening balances are matched against the already migrated chart of accounts and third parties: finish steps 1 and 2 before step 3.",
    step: "Step",
    pucTitle: "Chart of accounts (PUC)",
    pucDesc: "Imports the PUC exported from SIEWIN with its accounts, nature and third-party/cost-center requirements.",
    pucCount: (n) => `${n} account${n === 1 ? "" : "s"} in this company`,
    pucBlocked: "This company already has a chart of accounts, so PUC import is disabled (it is only allowed on a company with no accounts). You can continue with steps 2 and 3.",
    pucButton: "Import PUC",
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
    reload: "Refresh",
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

  // Solo actualiza estado después de la respuesta (no en el cuerpo del
  // efecto); el botón "Actualizar" limpia antes con reload().
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

  const reload = () => {
    setAccountCount(null);
    setThirdPartyCount(null);
    setError("");
    fetchCounts();
  };

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
        actions={
          <Button variant="secondary" size="sm" onClick={reload}>
            {t.reload}
          </Button>
        }
      />

      <Alert tone="info">{t.orderNote}</Alert>
      {error && <Alert tone="error">{error}</Alert>}

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
            {hasAccounts && <Alert tone="warning">{t.pucBlocked}</Alert>}
            <Button
              variant="primary"
              disabled={!noAccounts}
              onClick={() => onNavigate("chartOfAccount", { openSiewin: true })}
            >
              {t.pucButton}
            </Button>
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
    </div>
  );
}

SiewinMigrationPage.propTypes = {
  language: PropTypes.string,
  onNavigate: PropTypes.func.isRequired,
};

export default SiewinMigrationPage;
