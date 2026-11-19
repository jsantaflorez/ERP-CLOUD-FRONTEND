// ListPager.jsx — pie de tabla con "Mostrando x–y de N", selector de filas
// por página y Anterior/Siguiente. Se usa con usePaging() (paginación en el
// cliente). 2026-11-17. Mismo aspecto que el pie de Asientos Contables.
// Atajo: Alt+AvPág / Alt+RePág (ver usePagerShortcut en keyboard.js).
import PropTypes from "prop-types";
import Button from "./Button";
import { PAGE_SIZE_OPTIONS, PAGE_SIZE_ALL } from "./usePaging";
import { usePagerShortcut } from "./keyboard";

const TEXT = {
  es: { showing: "Mostrando", of: "de", perPage: "Por página", all: "Todas", page: "Página", prev: "Anterior", next: "Siguiente" },
  en: { showing: "Showing", of: "of", perPage: "Per page", all: "All", page: "Page", prev: "Previous", next: "Next" },
};

export default function ListPager({ paging, language = "es", itemLabel }) {
  const t = TEXT[language] || TEXT.es;
  const { page, setPage, pageSize, setPageSize, totalPages, total, from, to } = paging;
  const fmt = (n) => n.toLocaleString(language === "es" ? "es-CO" : "en-US");

  usePagerShortcut({
    enabled: totalPages > 1,
    onPrev: () => setPage(page - 1),
    onNext: () => setPage(page + 1),
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
      <span>
        {total > 0 ? (
          <>
            {t.showing}{" "}
            <span className="font-semibold tabular-nums text-slate-800">{fmt(from)}–{fmt(to)}</span>{" "}
            {t.of} <span className="font-semibold tabular-nums text-slate-800">{fmt(total)}</span>{" "}
            {total === 1 ? itemLabel.singular : itemLabel.plural}
          </>
        ) : null}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          {t.perPage}
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-lg border border-field bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-700"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n === PAGE_SIZE_ALL ? t.all : n}</option>
            ))}
          </select>
        </label>
        {totalPages > 1 && (
          <>
            <Button variant="secondary" size="sm" disabled={page <= 0}
              title="Alt+RePág" onClick={() => setPage(page - 1)}>{t.prev}</Button>
            <span className="tabular-nums">{t.page} {page + 1} {t.of} {totalPages}</span>
            <Button variant="secondary" size="sm" disabled={page >= totalPages - 1}
              title="Alt+AvPág" onClick={() => setPage(page + 1)}>{t.next}</Button>
          </>
        )}
      </div>
    </div>
  );
}

ListPager.propTypes = {
  paging: PropTypes.object.isRequired,
  language: PropTypes.string,
  itemLabel: PropTypes.shape({ singular: PropTypes.string, plural: PropTypes.string }).isRequired,
};
