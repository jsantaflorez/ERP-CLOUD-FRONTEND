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
