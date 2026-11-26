// src/components/ui/CatalogComboBox.jsx
//
// Fase 4 (2026-11-24, auditoría F1-25): combobox de cuenta / tercero que
// busca en el servidor (utils/catalogLookup) en lugar de filtrar un catálogo
// entero cargado en memoria. Reemplaza a AccountComboBox y ThirdPartyComboBox
// de JournalEntryPage y a los <select> de cuenta/tercero de los reportes.
//
// Conserva el comportamiento de teclado ya probado en el documento contable:
// - Ranking: código exacto → empieza por código → empieza por nombre →
//   contiene (el servidor ordena igual, así el corte de 50 trae los mejores).
// - Al entrar al campo se siembra la búsqueda con el código del valor ya
//   elegido; pasar por el campo sin escribir (Enter/Tab) lo conserva tal cual.
// - Enter = Tab: toma la sugerencia resaltada y avanza (onSelected).
//   Shift+Enter / Shift+Tab: campo anterior (onRetreat). ↑/↓ recorren.
//   Esc cierra la lista sin perder el foco. Con la lista cerrada, Enter/Tab
//   avanzan con el valor actual y ↓ la vuelve a abrir.
// - Si se presiona Enter antes de que llegue la respuesta de lo último que
//   se escribió, espera esa respuesta y toma el primer resultado (nunca
//   elige con resultados de una búsqueda anterior).
// - allowClear (filtros de reportes): borrar el texto y Enter/Tab = "todos".
// - Sin onSelected/onRetreat (formularios y filtros), Enter/Tab pasan al
//   campo siguiente/anterior del formulario, como cualquier otro campo.
//
// 2026-11-26 (pedido del usuario: scroll corto y parámetros "a ciegas"):
// - La lista se dibuja en un portal (encima de la página): la tabla de líneas
//   del documento tiene overflow-x-auto y recortaba la lista. Se abre hacia
//   arriba si abajo no hay espacio, y sigue al campo al desplazarse.
// - Más alta (hasta ~28rem) y ancha (hasta 560 px); la fila resaltada siempre
//   queda a la vista; RePág/AvPág saltan 10.
// - Cada fila muestra etiquetas con lo que la cuenta pide (tercero, centro de
//   costo, impuesto/base, naturaleza) y su grupo padre; al pie, la ficha de la
//   fila resaltada (cambia con flechas o al pasar el mouse).
// - `describe(record)` permite a la pantalla añadir datos propios (el
//   documento contable pasa el impuesto vinculado a la cuenta).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CATALOG_KINDS, describeRecord, lookupCatalog, rankRecords } from "../../utils/catalogLookup";
import { inputClass } from "./tokens";
import { focusNextField } from "./keyboard";

const DEBOUNCE_MS = 200;

const LABELS = {
  es: { searching: "Buscando…", error: "No se pudo buscar. Intenta de nuevo.", more: "Se muestran los primeros 50: escribe más para afinar.", card: "Ficha de" },
  en: { searching: "Searching…", error: "Search failed. Try again.", more: "Showing the first 50: keep typing to narrow down.", card: "Details of" },
};

const PANEL_MAX_WIDTH = 560;
const PANEL_MAX_HEIGHT = 448; // ~28rem
const PANEL_MIN_BELOW = 260;  // con menos espacio abajo, se abre hacia arriba
const PAGE_JUMP = 10;

const CHIP_TONES = {
  thirdParty: "bg-violet-50 text-violet-700",
  costCenter: "bg-teal-50 text-teal-700",
  tax: "bg-amber-50 text-amber-800",
  neutral: "bg-slate-100 text-slate-600",
  warn: "bg-red-50 text-red-700",
};

/** Etiquetas cortas de una cuenta/tercero (también se usan bajo el campo de la línea). */
export function CatalogChips({ chips, className = "" }) {
  if (!chips || chips.length === 0) return null;
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {chips.map((c) => (
        <span key={c.key} title={c.title || c.label}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${CHIP_TONES[c.tone] || CHIP_TONES.neutral}`}>
          {c.label}
        </span>
      ))}
    </span>
  );
}

const DETAIL_TONES = { yes: "text-emerald-700 font-semibold", warn: "text-red-700 font-semibold" };

function CatalogComboBox({
  kind,
  value,
  selectedRecord,
  onChange,
  onSelected,
  onRetreat,
  registerRef,
  error,
  placeholder,
  noResultsLabel,
  params,
  extraRecords,
  decorate,
  describe,
  allowClear = false,
  language = "es",
  className,
  inputClassName,
  disabled = false,
  id,
  name,
}) {
  const cfg = CATALOG_KINDS[kind];
  const L = LABELS[language] || LABELS.es;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [results, setResults] = useState([]);
  const [resultsFor, setResultsFor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState(null);
  const blurTimerRef = useRef(null);
  const debounceRef = useRef(null);
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  // Lo que handleFocus puso en la búsqueda (ver Tab/Enter "sin tocar").
  const seedRef = useRef("");
  // Enter/Tab presionado mientras la búsqueda actual seguía en camino.
  const pendingAdvanceRef = useRef(false);

  const paramsKey = JSON.stringify(params || {});
  const normQuery = query.trim().toLowerCase();

  const decorateRecord = useCallback((r) => (r && decorate ? decorate(r) : r), [decorate]);
  const selected = value ? decorateRecord(selectedRecord) || null : null;
  const selectedLabel = selected ? cfg.label(selected) : "";
  const displayValue = open ? query : selectedLabel;

  useEffect(() => () => {
    clearTimeout(blurTimerRef.current);
    clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  const runSearch = useCallback((text) => {
    clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    abortRef.current = controller;
    const seq = ++seqRef.current;
    const normalized = text.trim().toLowerCase();
    setLoading(true);
    setFailed(false);
    lookupCatalog(kind, text.trim(), JSON.parse(paramsKey), { signal: controller?.signal })
      .then((list) => {
        if (seq !== seqRef.current) return;
        setResults(list);
        setResultsFor(normalized);
        setLoading(false);
      })
      .catch((err) => {
        if (seq !== seqRef.current || err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
        setResults([]);
        setResultsFor(normalized);
        setLoading(false);
        setFailed(true);
      });
  }, [kind, paramsKey]);

  // Búsqueda con debounce mientras la lista está abierta.
  useEffect(() => {
    if (!open) return undefined;
    if (resultsFor === normQuery && !failed) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, normQuery, runSearch]);

  // Si cambian los parámetros (p. ej. otro filtro), lo buscado ya no sirve.
  useEffect(() => {
    setResultsFor(null);
  }, [paramsKey]);

  const fresh = resultsFor === normQuery;

  const rankFor = useCallback((serverList) => {
    const locals = [...(extraRecords || [])];
    if (selectedRecord) locals.unshift(selectedRecord);
    return rankRecords(kind, serverList, locals, query).map(decorateRecord);
  }, [kind, extraRecords, selectedRecord, query, decorateRecord]);

  const filtered = useMemo(() => rankFor(results), [rankFor, results]);

  const moveFocus = useCallback((backwards) => {
    const el = inputRef.current;
    if (!el) return;
    focusNextField(el.closest("form") || document.body, el, backwards);
  }, []);

  const advance = useCallback((record) => {
    if (onSelected) onSelected(record);
    else moveFocus(false);
  }, [onSelected, moveFocus]);

  const retreat = useCallback(() => {
    if (onRetreat) onRetreat();
    else moveFocus(true);
  }, [onRetreat, moveFocus]);

  const commitSelection = useCallback((record, { move = true } = {}) => {
    onChange(record ? String(record.id) : "", record || null);
    setQuery("");
    setOpen(false);
    if (move) advance(record || null);
    else onSelected?.(record || null);
  }, [onChange, onSelected, advance]);

  const keepCurrent = useCallback(() => {
    setOpen(false);
    setQuery("");
    advance(selected || null);
  }, [advance, selected]);

  // Enter presionado antes de tiempo: decide en cuanto llega la respuesta.
  useEffect(() => {
    if (!pendingAdvanceRef.current || !fresh || loading) return;
    pendingAdvanceRef.current = false;
    const list = rankFor(results);
    if (list[0]) commitSelection(list[0]);
    else keepCurrent();
  }, [fresh, loading, results, rankFor, commitSelection, keepCurrent]);

  const handleFocus = () => {
    clearTimeout(blurTimerRef.current);
    seedRef.current = selected ? cfg.key(selected) : "";
    setQuery(seedRef.current);
    setHighlight(0);
    setOpen(true);
  };

  const handleBlur = () => {
    // Pequeña espera para que un clic en una opción (onMouseDown) alcance a
    // confirmar antes de que la lista desaparezca.
    blurTimerRef.current = setTimeout(() => {
      pendingAdvanceRef.current = false;
      clearTimeout(debounceRef.current);
      setOpen(false);
      setQuery("");
    }, 150);
  };

  const handleKeyDown = (e) => {
    const isAdvanceKey = (e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (isAdvanceKey && e.shiftKey) {
      e.preventDefault();
      pendingAdvanceRef.current = false;
      setOpen(false);
      setQuery("");
      retreat();
      return;
    }
    if (!open) {
      if (isAdvanceKey) {
        e.preventDefault();
        advance(selected || null);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        handleFocus();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "PageDown" && !e.altKey) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + PAGE_JUMP, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "PageUp" && !e.altKey) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - PAGE_JUMP, 0));
    } else if (isAdvanceKey) {
      e.preventDefault();
      const untouched = selected && query === seedRef.current;
      if (untouched) { keepCurrent(); return; }
      if (!query.trim()) {
        if (allowClear && selected) commitSelection(null);
        else keepCurrent();
        return;
      }
      if (fresh && !loading) {
        if (filtered[highlight]) commitSelection(filtered[highlight]);
        else keepCurrent();
        return;
      }
      // La respuesta de lo último escrito no ha llegado: buscar ya y esperar.
      pendingAdvanceRef.current = true;
      if (!loading || resultsFor !== normQuery) runSearch(query);
    } else if (e.key === "Escape") {
      e.preventDefault();
      pendingAdvanceRef.current = false;
      setOpen(false);
      setQuery("");
    }
  };

  const showMoreHint = fresh && results.length >= 50;

  const describeFn = useCallback(
    (r) => (describe ? describe(r) : describeRecord(kind, r, { language })),
    [describe, kind, language]
  );

  // Posición de la lista (portal, position: fixed) junto al campo; se recalcula
  // al desplazar cualquier contenedor o al cambiar el tamaño de la ventana.
  const placePanel = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(rect.width, PANEL_MAX_WIDTH), vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    const below = vh - rect.bottom - 8;
    const above = rect.top - 8;
    const openUp = below < PANEL_MIN_BELOW && above > below;
    const maxHeight = Math.min(PANEL_MAX_HEIGHT, openUp ? above - 4 : below - 4);
    setPanelStyle(openUp
      ? { position: "fixed", left, width, bottom: vh - rect.top + 4, maxHeight }
      : { position: "fixed", left, width, top: rect.bottom + 4, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    placePanel();
    const onMove = () => placePanel();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, placePanel]);

  // La fila resaltada siempre a la vista al moverse con el teclado.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector(`[data-index="${highlight}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, filtered]);

  const highlighted = filtered[highlight] || null;
  const highlightedInfo = highlighted ? describeFn(highlighted) : null;

  const panel = open && panelStyle ? createPortal(
    <div
      style={panelStyle}
      className="z-[70] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
      // Clic dentro de la lista (también en la ficha) no debe quitar el foco del campo.
      onMouseDown={(e) => e.preventDefault()}
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-xs text-slate-500">
          {loading || !fresh ? L.searching : failed ? L.error : noResultsLabel}
        </div>
      ) : (
        <>
          <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {filtered.map((r, idx) => {
              const info = describeFn(r);
              const active = idx === highlight;
              return (
                <div
                  key={r.id}
                  data-index={idx}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => { e.preventDefault(); commitSelection(r, { move: Boolean(onSelected) }); }}
                  className={`cursor-pointer border-b border-slate-50 px-3 py-1.5 last:border-b-0 ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`min-w-0 truncate text-sm ${active ? "text-blue-700" : "text-slate-800"}`}>{cfg.label(r)}</span>
                    <CatalogChips chips={info.chips} className="shrink-0 justify-end" />
                  </div>
                  {info.subtitle && <div className="truncate text-[11px] text-slate-400">{info.subtitle}</div>}
                </div>
              );
            })}
            {(loading && !fresh) && <div className="px-3 py-1 text-[11px] text-slate-400">{L.searching}</div>}
            {showMoreHint && <div className="px-3 py-1 text-[11px] text-slate-400">{L.more}</div>}
          </div>
          {highlightedInfo && highlightedInfo.details.length > 0 && (
            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-2">
              <div className="mb-1 truncate text-[11px] text-slate-500">{L.card} {cfg.label(highlighted)}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
                {highlightedInfo.details.map(([label, valueText, tone]) => (
                  <div key={label} className="min-w-0 truncate">
                    <span className="text-slate-500">{label}</span>{" "}
                    <span className={DETAIL_TONES[tone] || "text-slate-800"}>{valueText}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div className={className || "relative flex-1 min-w-0"}>
      <input
        id={id}
        name={name}
        ref={(el) => { inputRef.current = el; registerRef?.(el); }}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0); setOpen(true); }}
        onKeyDown={handleKeyDown}
        className={inputClassName || inputClass(Boolean(error))}
        autoComplete="off"
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-invalid={error ? true : undefined}
      />
      {panel}
    </div>
  );
}

export default CatalogComboBox;
