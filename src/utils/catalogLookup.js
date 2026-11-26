// src/utils/catalogLookup.js
//
// Fase 4 (2026-11-24, auditoría F1-25): los selectores de cuenta y tercero
// ya no cargan el catálogo entero (antes size=1000/500, que dejaba por fuera
// las cuentas o terceros de más). Buscan en el servidor:
//   GET /v1/chart-of-accounts/lookup?q=&postingOnly=&activeOnly=&limit=50
//   GET /v1/third-parties/lookup?q=&activeOnly=&limit=50
// y resuelven por id los valores ya seleccionados (?ids=1,2,3).
//
// El servidor ya devuelve los resultados ordenados con el mismo ranking que
// el combobox; rankRecords() lo vuelve a aplicar en el navegador para mezclar
// con registros locales (el seleccionado, terceros inactivos que ya estaban
// en el documento, los recién creados con F2).
import api from "../services/api";

export const CATALOG_KINDS = {
  account: {
    endpoint: "/v1/chart-of-accounts/lookup",
    key: (r) => r.code || "",
    name: (r) => r.name || "",
    label: (r) => `${r.code} - ${r.name}`,
  },
  thirdParty: {
    endpoint: "/v1/third-parties/lookup",
    key: (r) => r.documentNumber || "",
    name: (r) => r.legalDisplayName || "",
    label: (r) => `${r.documentNumber} - ${r.legalDisplayName}`,
  },
};

export const LOOKUP_LIMIT = 50;
const MAX_IDS_PER_CALL = 200;

const unwrap = (response) => {
  const data = response?.data?.data;
  return Array.isArray(data) ? data : [];
};

/** Búsqueda en el servidor (top 50, ya ordenada). */
export async function lookupCatalog(kind, query, params = {}, { signal } = {}) {
  const cfg = CATALOG_KINDS[kind];
  const response = await api.get(cfg.endpoint, {
    params: { q: query || "", limit: LOOKUP_LIMIT, ...params },
    signal,
  });
  return unwrap(response);
}

/** Resuelve registros por id (activos o no), en bloques de 200. */
export async function fetchCatalogByIds(kind, ids) {
  const cfg = CATALOG_KINDS[kind];
  const unique = [...new Set((ids || []).map(String).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += MAX_IDS_PER_CALL) {
    const chunk = unique.slice(i, i + MAX_IDS_PER_CALL);
    const response = await api.get(cfg.endpoint, {
      params: { ids: chunk.join(",") },
    });
    out.push(...unwrap(response));
  }
  return out;
}

/**
 * Rango de un registro para el texto buscado (menor = mejor):
 * 0 código exacto, 1 código empieza, 2 nombre empieza, 3 código contiene,
 * 4 nombre contiene, null = no coincide en código ni nombre.
 */
export function rankOf(kind, record, q) {
  const cfg = CATALOG_KINDS[kind];
  const key = cfg.key(record).toLowerCase();
  const name = cfg.name(record).toLowerCase();
  if (!q) return 1;
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (key.includes(q)) return 3;
  if (name.includes(q)) return 4;
  return null;
}

/**
 * Mezcla resultados del servidor con registros locales y los ordena.
 * Los del servidor que no coinciden en código/nombre (p. ej. hallados por
 * nombre comercial) se conservan al final en el orden del servidor; los
 * locales que no coinciden se descartan.
 */
export function rankRecords(kind, serverRecords, localRecords, query) {
  const cfg = CATALOG_KINDS[kind];
  const q = (query || "").trim().toLowerCase();
  const seen = new Set();
  const scored = [];
  let order = 0;
  const push = (record, fromServer) => {
    if (!record || record.id == null) return;
    const id = String(record.id);
    if (seen.has(id)) return;
    const rank = rankOf(kind, record, q);
    if (rank === null && !fromServer) return;
    seen.add(id);
    scored.push({ record, rank: rank === null ? 5 : rank, order: order++ });
  };
  (localRecords || []).forEach((r) => push(r, false));
  (serverRecords || []).forEach((r) => push(r, true));
  scored.sort((a, b) =>
    a.rank - b.rank
    || (a.rank === 5 ? a.order - b.order : cfg.key(a.record).localeCompare(cfg.key(b.record)))
  );
  return scored.map((s) => s.record);
}

// ─────────────────────────────────────────────────────────────────────────
// 2026-11-26 (pedido del usuario): parámetros de la cuenta / tercero a la
// vista dentro del selector, para no salir del documento a revisarlos.
// describeRecord() devuelve:
//   chips:    etiquetas cortas, solo las que aplican (tercero, centro de
//             costo, impuesto/base, naturaleza)
//   subtitle: línea gris (grupo padre / tipo de documento)
//   details:  filas [etiqueta, valor, tono] para la ficha de la resaltada
// Tonos: "thirdParty" | "costCenter" | "tax" | "neutral" | "yes" | "warn".
// ─────────────────────────────────────────────────────────────────────────
const CLASS_LABELS = {
  es: { ASSET: "Activo", LIABILITY: "Pasivo", EQUITY: "Patrimonio", REVENUE: "Ingreso", EXPENSE: "Gasto", COST: "Costo" },
  en: { ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", REVENUE: "Revenue", EXPENSE: "Expense", COST: "Cost" },
};

const DESCRIBE_LABELS = {
  es: {
    thirdParty: "Tercero", costCenter: "C. costo", base: "Base", nature: "Naturaleza", debit: "Débito", credit: "Crédito",
    accountClass: "Clase", thirdPartyRow: "Tercero", costCenterRow: "Centro de costo", requires: "Exige", notRequired: "No pide",
    tax: "Impuesto", none: "Ninguno", asksBase: "pide base", minimumBase: "Base mínima", posting: "Movimiento",
    postingYes: "Sí, de movimiento", postingNo: "No (cuenta de grupo)", inactive: "Inactiva", status: "Estado",
    document: "Documento", inactiveTp: "Inactivo", active: "Activo", regime: "Régimen", city: "Ciudad",
  },
  en: {
    thirdParty: "Third party", costCenter: "Cost ctr.", base: "Base", nature: "Nature", debit: "Debit", credit: "Credit",
    accountClass: "Class", thirdPartyRow: "Third party", costCenterRow: "Cost center", requires: "Required", notRequired: "Not required",
    tax: "Tax", none: "None", asksBase: "asks for base", minimumBase: "Minimum base", posting: "Posting",
    postingYes: "Yes, posting account", postingNo: "No (group account)", inactive: "Inactive", status: "Status",
    document: "Document", inactiveTp: "Inactive", active: "Active", regime: "Regime", city: "City",
  },
};

function formatRate(rate, language) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return "";
  return `${n.toLocaleString(language === "en" ? "en-US" : "es-CO", { maximumFractionDigits: 4 })}%`;
}

function formatMoney(value, language) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `$ ${n.toLocaleString(language === "en" ? "en-US" : "es-CO", { maximumFractionDigits: 2 })}`;
}

/** Descripción de una cuenta; `tax` = impuesto vinculado a la cuenta (opcional). */
export function describeAccount(account, { tax = null, language = "es" } = {}) {
  if (!account) return { chips: [], subtitle: "", details: [] };
  const L = DESCRIBE_LABELS[language] || DESCRIBE_LABELS.es;
  const chips = [];
  if (account.requiresThirdParty) chips.push({ key: "tp", label: L.thirdParty, tone: "thirdParty" });
  if (account.requiresCostCenter) chips.push({ key: "cc", label: L.costCenter, tone: "costCenter" });
  if (tax) {
    const taxText = `${tax.type || tax.code || L.tax} ${formatRate(tax.rate, language)}`.trim();
    chips.push({ key: "tax", label: tax.requiresBase ? `${L.base} · ${taxText}` : taxText, tone: "tax" });
  }
  if (account.nature) chips.push({ key: "nat", label: account.nature, tone: "neutral", title: `${L.nature}: ${account.nature === "D" ? L.debit : L.credit}` });
  if (account.active === false) chips.push({ key: "inact", label: L.inactive, tone: "warn" });

  const subtitle = account.parentCode ? `${account.parentCode} ${account.parentName || ""}`.trim() : "";
  const details = [
    [L.nature, account.nature === "D" ? L.debit : account.nature === "C" ? L.credit : "—"],
    [L.accountClass, (CLASS_LABELS[language] || CLASS_LABELS.es)[account.accountClass] || account.accountClass || "—"],
    [L.thirdPartyRow, account.requiresThirdParty ? L.requires : L.notRequired, account.requiresThirdParty ? "yes" : null],
    [L.costCenterRow, account.requiresCostCenter ? L.requires : L.notRequired, account.requiresCostCenter ? "yes" : null],
    [L.tax, tax ? `${tax.name || tax.type || tax.code} · ${formatRate(tax.rate, language)}${tax.requiresBase ? ` · ${L.asksBase}` : ""}` : L.none],
  ];
  if (tax && tax.requiresBase) details.push([L.minimumBase, formatMoney(tax.minimumBase, language)]);
  if (account.postingAccount === false) details.push([L.posting, L.postingNo, "warn"]);
  return { chips, subtitle, details };
}

const DOC_TYPE_SHORT = { PP: "Pasaporte" }; // el resto se muestra con su código (NIT, CC, CE, TI, RC…)

/** Descripción de un tercero. */
export function describeThirdParty(tp, { language = "es" } = {}) {
  if (!tp) return { chips: [], subtitle: "", details: [] };
  const L = DESCRIBE_LABELS[language] || DESCRIBE_LABELS.es;
  const docType = tp.documentType ? (DOC_TYPE_SHORT[tp.documentType] || tp.documentType) : "";
  const doc = `${docType ? `${docType} ` : ""}${tp.documentNumber || ""}${tp.verificationDigit != null ? `-${tp.verificationDigit}` : ""}`.trim();
  const chips = [];
  if (docType) chips.push({ key: "doc", label: docType, tone: "neutral" });
  if (tp.active === false) chips.push({ key: "inact", label: L.inactiveTp, tone: "warn" });
  const subtitle = [tp.tradeName && tp.tradeName !== tp.businessName ? tp.tradeName : "", tp.cityName || ""].filter(Boolean).join(" · ");
  const details = [
    [L.document, doc || "—"],
    [L.status, tp.active === false ? L.inactiveTp : L.active, tp.active === false ? "warn" : null],
  ];
  if (tp.cityName) details.push([L.city, tp.cityName]);
  return { chips, subtitle, details };
}

/** Descriptor por defecto según el tipo de catálogo. */
export function describeRecord(kind, record, options = {}) {
  return kind === "account" ? describeAccount(record, options) : describeThirdParty(record, options);
}
