// usePaging.js — paginación del lado del cliente para listados que ya
// tienen todas sus filas en memoria (Plan de Cuentas, Terceros). 2026-11-17.
//
// - El usuario elige cuántas filas ver por página (25/50/100/200/Todas) y
//   la elección se recuerda por pantalla en localStorage (storageKey).
// - resetKey: cualquier valor que cambie cuando cambian la búsqueda o los
//   filtros; al cambiar, se vuelve a la página 1 (sin useEffect: la página
//   guardada se asocia a su resetKey y deja de valer si este cambia).
// - Si la lista se achica (p. ej. al plegar grupos), la página se ajusta
//   sola a la última que exista.
import { useMemo, useState } from "react";

export const PAGE_SIZE_ALL = 0;
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, PAGE_SIZE_ALL];

function readSavedSize(storageKey, fallback) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw !== null && PAGE_SIZE_OPTIONS.includes(Number(raw))) return Number(raw);
  } catch { /* sin almacenamiento disponible */ }
  return fallback;
}

export function usePaging(items, { storageKey, resetKey = "", defaultSize = 50 }) {
  const [pageSize, setPageSizeState] = useState(() => readSavedSize(storageKey, defaultSize));
  const [pageState, setPageState] = useState({ key: resetKey, page: 0 });

  const total = items.length;
  const totalPages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const requested = pageState.key === resetKey ? pageState.page : 0;
  const page = Math.min(requested, totalPages - 1);

  const pageItems = useMemo(
    () => (pageSize ? items.slice(page * pageSize, page * pageSize + pageSize) : items),
    [items, page, pageSize]
  );

  const setPage = (next) =>
    setPageState({ key: resetKey, page: Math.max(0, Math.min(next, totalPages - 1)) });

  const setPageSize = (size) => {
    setPageSizeState(size);
    setPageState({ key: resetKey, page: 0 });
    try { localStorage.setItem(storageKey, String(size)); } catch { /* sin almacenamiento */ }
  };

  const from = total === 0 ? 0 : (pageSize ? page * pageSize + 1 : 1);
  const to = pageSize ? Math.min(total, (page + 1) * pageSize) : total;

  return { page, setPage, pageSize, setPageSize, totalPages, total, pageItems, from, to };
}
