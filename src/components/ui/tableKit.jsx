// tableKit.jsx — piezas compartidas de las pantallas de listado (UI 2026-11-10).
// Nació en el Plan de Cuentas y se generalizó a Terceros, Tipos de
// Documento, Centros de Costo, Impuestos, Usuarios y Períodos. Reglas:
//  1. Densidad: filas de ~40px (TD = py-2), encabezado sticky (THEAD).
//  2. Marcar la EXCEPCIÓN, no el valor por defecto: nada de una píldora
//     "ACTIVO" en cada fila; solo <InactiveTag/> en las inactivas, y
//     <FlagCell/> (✓ / —) para columnas booleanas.
//  3. Acciones de fila en una línea (<RowActions/>); "Desactivar" es un
//     ícono gris que se pone rojo al pasar el cursor, nunca un botón rojo
//     repetido en cada fila. La confirmación la sigue haciendo cada página.
//  4. El único azul sólido de la vista es la acción primaria ("+ Nuevo").
import { useRef } from "react";
import PropTypes from "prop-types";
import Button from "./Button";
import MenuButton from "./MenuButton";
import { focusFirstRow, useSearchShortcut } from "./keyboard";

// ---------- Clases de tabla ----------
export const TABLE_WRAP = "max-h-[calc(100vh-15rem)] min-h-[16rem] overflow-auto";
export const THEAD = "sticky top-0 z-[2] bg-slate-50";
export const THEAD_ROW = "text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
export const TH = "whitespace-nowrap border-b border-slate-200 px-3 py-2.5";
export const TBODY = "divide-y divide-slate-100";
// Filas navegables con ↑/↓ (ver keyboard.js): la fila enfocada se resalta.
export const TR =
  "group transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-blue-50 focus-visible:shadow-[inset_3px_0_0_#1d4ed8]";
export const TD = "px-3 py-2 align-middle";
// Columna de acciones fija a la derecha (visible aunque haya scroll horizontal).
export const TH_ACTIONS = `${TH} sticky right-0 bg-slate-50 text-right`;
export const TD_ACTIONS =
  "sticky right-0 bg-white px-2 py-1.5 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)] group-hover:bg-slate-50";
// Tarjeta contenedora de la tabla (lienzo gris + tarjeta blanca).
export const CARD = "rounded-xl border border-slate-200 bg-white";

// ---------- Etiqueta "Inactivo/a" (solo en la excepción) ----------
export function InactiveTag({ children }) {
  return (
    <span className="ml-2 inline-block shrink-0 rounded bg-slate-200 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-slate-700">
      {children}
    </span>
  );
}
InactiveTag.propTypes = { children: PropTypes.node.isRequired };

// ---------- Columna booleana: ✓ / — (opcionalmente interruptor) ----------
export function FlagCell({ on, label, yes = "Sí", no = "No", onToggle, busy = false, title }) {
  const mark = on ? (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200">
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.58l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
      </svg>
    </span>
  ) : (
    <span className="text-slate-400" aria-hidden="true">—</span>
  );

  if (!onToggle) {
    return (
      <span className="inline-flex h-6 w-8 items-center justify-center" title={title}>
        {mark}
        <span className="sr-only">{`${label}: ${on ? yes : no}`}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={label}
      title={title}
      className="inline-flex h-6 w-8 items-center justify-center rounded-md transition hover:bg-white hover:ring-1 hover:ring-slate-300 disabled:cursor-wait disabled:opacity-50"
    >
      {mark}
    </button>
  );
}
FlagCell.propTypes = {
  on: PropTypes.bool,
  label: PropTypes.string.isRequired,
  yes: PropTypes.string,
  no: PropTypes.string,
  onToggle: PropTypes.func,
  busy: PropTypes.bool,
  title: PropTypes.string,
};

// ---------- Acciones de fila ----------
// labels: { view, edit, deactivate, activate } (textos de la página).
// itemLabel: identifica la fila para lectores de pantalla ("Desactivar FV").
// children: acciones extra de la página (p. ej. "Ajustar consecutivo"),
// se muestran entre Editar y el ícono de desactivar.
export function RowActions({ labels, itemLabel = "", active = true, onView, onEdit, onDeactivate, onActivate, children }) {
  return (
    <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
      {onView && (
        <Button variant="ghost" size="xs" onClick={onView} data-row-primary={onEdit ? undefined : ""}>
          {labels.view}
        </Button>
      )}
      {onEdit && (
        <Button variant="ghost" size="xs" onClick={onEdit} data-row-primary="">
          {labels.edit}
        </Button>
      )}
      {children}
      {active && onDeactivate && (
        <button
          type="button"
          onClick={onDeactivate}
          data-row-delete=""
          title={`${labels.deactivate} (Supr)`}
          aria-label={`${labels.deactivate} ${itemLabel}`.trim()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 2a.75.75 0 01.75.75v7.5a.75.75 0 01-1.5 0v-7.5A.75.75 0 0110 2zM5.4 4.82a.75.75 0 01.02 1.06 6.25 6.25 0 109.16 0 .75.75 0 111.08-1.04 7.75 7.75 0 11-11.32 0 .75.75 0 011.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
      )}
      {!active && onActivate && (
        <Button variant="ghost" size="xs" onClick={onActivate}>
          {labels.activate}
        </Button>
      )}
    </div>
  );
}
RowActions.propTypes = {
  labels: PropTypes.shape({
    view: PropTypes.string,
    edit: PropTypes.string,
    deactivate: PropTypes.string,
    activate: PropTypes.string,
  }).isRequired,
  itemLabel: PropTypes.string,
  active: PropTypes.bool,
  onView: PropTypes.func,
  onEdit: PropTypes.func,
  onDeactivate: PropTypes.func,
  onActivate: PropTypes.func,
  children: PropTypes.node,
};

// ---------- Encabezado: Exportar ▾ y atajo de teclado ----------
export function ExportMenu({ label, onExcel, onPdf, disabled = false }) {
  const items = [];
  if (onExcel) items.push({ label: "Excel (.xlsx)", onClick: onExcel });
  if (onPdf) items.push({ label: "PDF", onClick: onPdf });
  return <MenuButton label={label} items={items} disabled={disabled} />;
}
ExportMenu.propTypes = {
  label: PropTypes.string.isRequired,
  onExcel: PropTypes.func,
  onPdf: PropTypes.func,
  disabled: PropTypes.bool,
};

// Va DENTRO del botón primario: <Button>+ Nuevo <ShortcutKbd>Ins</ShortcutKbd></Button>
export function ShortcutKbd({ children }) {
  return (
    <kbd className="ml-1 hidden rounded border border-white/30 bg-white/10 px-1.5 py-px font-sans text-[10px] font-medium sm:inline">
      {children}
    </kbd>
  );
}
ShortcutKbd.propTypes = { children: PropTypes.node.isRequired };

// ---------- Barra de herramientas: búsqueda + filtros ----------
export function Toolbar({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      {children}
    </div>
  );
}
Toolbar.propTypes = { children: PropTypes.node };

export function ToolbarDivider() {
  return <div className="hidden h-5 w-px bg-slate-200 lg:block" />;
}

// "/" o F3 enfocan la búsqueda; ↓ baja a la primera fila de la tabla.
export function SearchInput({ value, onChange, placeholder }) {
  const ref = useRef(null);
  useSearchShortcut(ref);
  return (
    <div className="relative w-full md:w-80">
      <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.33 3.33a.75.75 0 11-1.06 1.06l-3.33-3.33A7 7 0 012 9z" clipRule="evenodd" />
      </svg>
      <input
        ref={ref}
        type="search"
        data-kbd-search=""
        value={value}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && focusFirstRow(e.currentTarget)) e.preventDefault();
        }}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-field bg-white py-2 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:border-blue-700"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-300 px-1.5 text-[10px] font-medium text-slate-500" aria-hidden="true">
        /
      </kbd>
    </div>
  );
}
SearchInput.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
};

// Etiqueta de grupo de filtros ("NATURALEZA", "TIPO PERSONA").
export function FilterLabel({ children }) {
  return <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</span>;
}
FilterLabel.propTypes = { children: PropTypes.node };

// Chip de filtro: activo en azul claro (el azul sólido es de "+ Nuevo").
export function FilterChip({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-blue-300 bg-blue-50 text-blue-800"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}
FilterChip.propTypes = {
  active: PropTypes.bool,
  onClick: PropTypes.func,
  title: PropTypes.string,
  children: PropTypes.node,
};

// Select compacto para filtros con muchas opciones.
export const FILTER_SELECT =
  "rounded-lg border border-field bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-blue-700";

// ---------- Leyenda de atajos ----------
// items: [["Enter", "siguiente campo"], ["Ctrl+Enter", "guardar"], ...]
export function KeyboardHints({ items, className = "" }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 ${className}`}>
      {items.map(([keys, label]) => (
        <span key={keys} className="inline-flex items-center gap-1">
          {keys.split("+").map((k, i) => (
            <span key={k} className="inline-flex items-center gap-0.5">
              {i > 0 && <span aria-hidden="true">+</span>}
              <kbd className="rounded border border-slate-300 bg-white px-1 font-sans text-[10px] font-medium text-slate-600">{k}</kbd>
            </span>
          ))}
          <span>{label}</span>
        </span>
      ))}
    </p>
  );
}
KeyboardHints.propTypes = {
  items: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.string)).isRequired,
  className: PropTypes.string,
};

