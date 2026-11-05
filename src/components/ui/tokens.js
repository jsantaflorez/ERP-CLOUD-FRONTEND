// tokens.js — Sistema de diseño centralizado de IntEgraERP
// Si cambias un estilo aquí, cambia en TODA la aplicación.
//
// UI review 2026-11-04: jerarquía de botones explícita, contrastes WCAG AA
// (texto >= 4.5:1, bordes de campos >= 3:1) y clases de tabla compactas
// con cifras tabulares. Ver claude/auditoria-ui-2026-11-04.md en el proyecto.

// ---------- Botones ----------
// Jerarquía (usar UNA acción primary por vista o modal):
//   primary     -> acción principal (Guardar, Generar, Nuevo comprobante)
//   secondary   -> acciones de apoyo (Cancelar, Exportar, Agregar línea)
//   ghost       -> acciones de fila / terciarias (Ver, Editar, Duplicar)
//   danger      -> destructiva como acción secundaria (Desactivar)
//   dangerSolid -> confirmación final de una acción destructiva (en modal)
//   dangerGhost -> destructiva dentro de una fila de tabla (Anular)
export const colors = {
  primary:     "bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white shadow-sm",
  secondary:   "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400",
  ghost:       "text-slate-600 hover:text-slate-900 hover:bg-slate-100",
  danger:      "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  dangerSolid: "bg-red-700 hover:bg-red-800 text-white shadow-sm",
  dangerGhost: "text-red-700 hover:bg-red-50",
};

export const sizes = {
  xs: "px-2 py-1 text-xs",        // acciones dentro de filas de tabla
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
};

export const radius = "rounded-lg";

// ---------- Campos de formulario ----------
// border-field = #848fa2 (3.27:1 sobre blanco), definido en index.css.
export const inputClass = (hasError = false) =>
  [
    "w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900",
    "placeholder:text-slate-500 transition-colors",
    "focus:border-blue-700",
    "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
    hasError ? "border-red-700" : "border-field",
  ].join(" ");

export const labelClass = "text-xs font-semibold text-slate-700";
export const hintClass = "text-xs text-slate-500";

// ---------- Tablas de datos ----------
// Densidad "compacta": filas de ~36px (antes ~53px con py-4).
// Las celdas numéricas usan cifras tabulares para que las columnas alineen.
export const table = {
  wrapper: "overflow-x-auto rounded-xl border border-slate-200 bg-white",
  table:   "w-full text-sm",
  thead:   "sticky top-0 z-[1] bg-slate-50",
  th:      "border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 whitespace-nowrap",
  thNum:   "border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600 whitespace-nowrap",
  tbody:   "divide-y divide-slate-100",
  row:     "group hover:bg-slate-50 transition-colors",
  td:      "px-3 py-2 align-top text-slate-700",
  tdNum:   "px-3 py-2 align-top text-right tabular-nums whitespace-nowrap text-slate-800",
  // Columna de acciones fija a la derecha: siempre visible aunque la tabla
  // tenga scroll horizontal (antes "Anular" quedaba cortado).
  thActions: "sticky right-0 border-b border-slate-200 bg-slate-50 px-3 py-2",
  tdActions: "sticky right-0 bg-white px-2 py-1 align-top shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]",
  tfoot:   "border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900",
  empty:   "py-12 text-center text-slate-500",
};

// ---------- Superficies ----------
export const card = "rounded-xl border border-slate-200 bg-white";
