// keyboard.js — uso 100% con teclado para formularios y tablas (UI 2026-11-10).
//
// Un contador captura cientos de registros al día: cada vez que tiene que
// soltar el teclado para tomar el mouse pierde ritmo. Estas utilidades
// llevan a TODOS los paneles de creación/edición el mismo contrato que ya
// tenía la captura de comprobantes (2026-10-19):
//
//   Enter            -> siguiente campo (en el último, va al botón Guardar)
//   Shift+Enter      -> campo anterior
//   Ctrl+Enter / Ctrl+S -> guardar desde cualquier campo
//   Esc              -> cerrar (pide confirmación si hay cambios sin guardar)
//   Tab              -> queda atrapado dentro del panel (no se "escapa" a la
//                       tabla de atrás) y al cerrar el foco vuelve a donde estaba
//
// Y en las tablas de listado (ver rowNavKeyDown / tableKit.jsx):
//   / o F3           -> ir a la búsqueda      ↓ desde la búsqueda -> 1ª fila
//   ↑ ↓ Inicio Fin   -> moverse entre filas    Enter -> editar (o ver)
//   Supr             -> desactivar (con su confirmación de siempre)
//   ← →              -> contraer / expandir grupos (Plan de Cuentas)
import { useEffect, useRef } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Campos a los que avanza Enter (no botones, no campos de solo lectura).
const FIELD =
  'input:not([disabled]):not([readonly]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([readonly]):not([tabindex="-1"])';

const ENTER_ADVANCE_TYPES = new Set([
  "text", "number", "date", "email", "tel", "search", "password", "checkbox", "radio", "month", "url", "",
]);

// Historial mínimo de foco: un modal con autoFocus ya movió el foco ANTES
// de que corra su efecto, así que "el elemento enfocado al abrir" sería el
// propio campo del modal. Guardamos el anterior para poder devolverlo.
let focusPrev = null;
let focusCurr = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    if (e.target === focusCurr) return;
    focusPrev = focusCurr;
    focusCurr = e.target;
  }, true);
}

const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

const fieldsIn = (container) => [...container.querySelectorAll(FIELD)].filter(isVisible);

// Mueve el foco al campo siguiente/anterior dentro de container. En el
// último campo hacia adelante, enfoca el botón submit del formulario.
export function focusNextField(container, from, backwards = false, onLastField) {
  const fields = fieldsIn(container);
  const i = fields.indexOf(from);
  const next = backwards ? fields[i - 1] : fields[i + 1];
  if (next) {
    next.focus();
    if (next.select && next.type !== "date" && next.tagName === "INPUT") {
      try { next.select(); } catch { /* algunos tipos no soportan select() */ }
    }
    return true;
  }
  if (!backwards && onLastField?.()) return true;
  if (!backwards) {
    const submit = container.querySelector('button[type="submit"]:not([disabled])');
    if (submit) { submit.focus(); return true; }
  }
  return false;
}

// Tras un intento de guardar que la validación rechazó, lleva el foco al
// primer campo marcado con error (borde rojo o aria-invalid) en vez de
// dejarlo en el botón Guardar. Si los campos con error están en otra
// pestaña, la página ya la activa (p. ej. Terceros); esperamos a que pinte.
export function focusFirstInvalidSoon(container) {
  const atSubmit = document.activeElement;
  setTimeout(() => {
    if (!container?.isConnected) return;
    const active = document.activeElement;
    // Si el usuario ya se movió a otro campo, no le robamos el foco.
    const stillHere = !active || active === document.body || active === atSubmit;
    if (!stillHere) return;
    const bad = fieldsIn(container).find(
      (el) => el.getAttribute("aria-invalid") === "true" || /(^|\s)border-red-\d+/.test(el.className)
    );
    if (bad && bad !== active) bad.focus();
  }, 150);
}

// El evento viene de un diálogo DISTINTO (p. ej. un modal de creación
// rápida abierto encima del panel)? Entonces no es asunto de este panel.
const belongsTo = (container, target) => {
  if (!container || !(target instanceof Node)) return false;
  if (target === document.body) return true;
  if (!container.contains(target)) return false;
  const ownerDialog = target instanceof Element ? target.closest('[aria-modal="true"]') : null;
  return !ownerDialog || ownerDialog === container;
};

/**
 * Teclado de un panel/modal de formulario.
 * @param {object}   o
 * @param {boolean}  o.active        panel abierto
 * @param {object}   o.containerRef  ref al elemento con role="dialog" aria-modal="true"
 * @param {Function} o.onClose       cierra el panel
 * @param {Function} [o.getSnapshot] devuelve un string del estado del formulario;
 *                                   si cambió desde que se abrió, Esc pide confirmación
 * @param {string}   [o.discardMessage]
 * @param {Function} [o.onLastField]  Enter en el último campo visible: devolver true si
 *                                   la página lo resolvió (p. ej. pasar a la pestaña siguiente)
 */
export function useFormKeyboard({ active, containerRef, onClose, getSnapshot, discardMessage, onLastField }) {
  const latest = useRef({});
  useEffect(() => {
    latest.current = { onClose, getSnapshot, discardMessage, onLastField };
  });
  const snapshotRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    // La ventana de atajos (F1) usa esto para mostrar primero lo de aquí.
    if (!container.dataset.kbdContext) container.dataset.kbdContext = "form";
    const previouslyFocused = container.contains(document.activeElement) ? focusPrev : document.activeElement;
    const previousRowIndex = rowIndexOf(previouslyFocused);

    // Foco inicial + foto del estado, un frame después para que React ya
    // haya pintado los valores del registro que se está editando.
    const raf = requestAnimationFrame(() => {
      snapshotRef.current = latest.current.getSnapshot?.() ?? null;
      if (container.contains(document.activeElement)) return; // respeta autoFocus
      const first = container.querySelector("[autofocus]") || fieldsIn(container)[0];
      (first || container).focus();
    });

    const onKeyDown = (e) => {
      if (!belongsTo(container, e.target)) return;
      const t = e.target;
      const tag = t.tagName;

      // Guardar
      if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "s" || e.key === "S")) {
        e.preventDefault();
        const form = container.querySelector("form");
        const submit = form?.querySelector('button[type="submit"]');
        if (form && !submit?.disabled) form.requestSubmit();
        return;
      }

      // Cerrar
      if (e.key === "Escape") {
        if (e.defaultPrevented) return; // p. ej. una lista de sugerencias abierta
        e.preventDefault();
        const { getSnapshot: snap, discardMessage: msg, onClose: close } = latest.current;
        const dirty = snap && snapshotRef.current !== null && snap() !== snapshotRef.current;
        if (dirty && !window.confirm(msg || "¿Descartar los cambios sin guardar?")) return;
        close?.();
        return;
      }

      // Enter = siguiente campo (Shift+Enter = anterior)
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.defaultPrevented || e.isComposing) return;
        if (t.getAttribute?.("aria-expanded") === "true" || t.dataset?.enter === "native") return;
        const advance =
          (tag === "INPUT" && ENTER_ADVANCE_TYPES.has(t.type)) || tag === "SELECT";
        if (!advance) return; // textarea y botones conservan su Enter
        e.preventDefault();
        focusNextField(container, t, e.shiftKey, latest.current.onLastField);
        return;
      }

      // Campo fecha: Tab sale del campo como Enter (el navegador por defecto
      // recorre día/mes/año con Tab, lo que se siente "desordenado").
      if (e.key === "Tab" && tag === "INPUT" && t.type === "date" && !e.ctrlKey && !e.altKey) {
        if (focusNextField(container, t, e.shiftKey, e.shiftKey ? undefined : latest.current.onLastField)) {
          e.preventDefault();
        }
        return;
      }

      // Trampa de foco
      if (e.key === "Tab") {
        const items = [...container.querySelectorAll(FOCUSABLE)].filter(isVisible);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (t === first || t === container)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && t === last) { e.preventDefault(); first.focus(); }
      }
    };

    const onSubmit = () => focusFirstInvalidSoon(container);
    document.addEventListener("keydown", onKeyDown);
    container.addEventListener("submit", onSubmit, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("submit", onSubmit, true);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
      // Si la lista se recargó (guardar), la fila original ya no existe.
      refocusRowSoon(previousRowIndex);
    };
  }, [active, containerRef]);
}

// ---------- Navegación por filas ----------
// Props para cada <tr> navegable.
export const ROW_KBD = { tabIndex: -1, "data-kbd-row": "" };

const rowsOf = (tbody) => [...tbody.querySelectorAll(":scope > tr[data-kbd-row]")];

// Después de guardar/desactivar la página recarga la lista y la fila que
// tenía el foco desaparece del DOM. Esto devuelve el foco a la fila en la
// MISMA posición en cuanto la tabla vuelve a estar, para que el contador
// siga con ↑/↓ sin tocar el mouse. Se rinde a los 4 s o si el usuario ya
// enfocó otra cosa.
export function refocusRowSoon(index) {
  if (index == null || index < 0) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const active = document.activeElement;
    const idle = !active || active === document.body;
    if (!idle || tries > 40) { clearInterval(timer); return; }
    if (document.querySelector('[aria-modal="true"]')) return;
    const rows = [...document.querySelectorAll("tbody > tr[data-kbd-row]")];
    if (rows.length) {
      rows[Math.min(index, rows.length - 1)].focus();
      clearInterval(timer);
    }
  }, 100);
}

const rowIndexOf = (el) => {
  const row = el?.closest?.("tr[data-kbd-row]");
  if (!row) return -1;
  return [...document.querySelectorAll("tbody > tr[data-kbd-row]")].indexOf(row);
};

export function focusFirstRow(from) {
  const scope = from?.closest?.("[data-kbd-scope]") || document;
  const row = scope.querySelector("tbody > tr[data-kbd-row]");
  if (row) { row.focus(); return true; }
  return false;
}

// onKeyDown del <tbody>. Los atajos de fila solo actúan cuando el foco
// está en la FILA (no dentro de un botón de la fila), salvo ↑/↓ que
// también sirven desde los botones para no quedar "atrapado" en uno.
export function rowNavKeyDown(e) {
  const row = e.target.closest?.("tr[data-kbd-row]");
  if (!row || e.altKey || e.ctrlKey || e.metaKey) return;
  const onRow = e.target === row;
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (inField) return;
  const rows = rowsOf(e.currentTarget);
  const i = rows.indexOf(row);
  const go = (r) => { if (r) { e.preventDefault(); r.focus(); } };

  switch (e.key) {
    case "ArrowDown": go(rows[i + 1]); break;
    case "ArrowUp":
      if (i === 0) {
        const scope = row.closest("[data-kbd-scope]") || document;
        const search = scope.querySelector("[data-kbd-search]");
        if (search) { e.preventDefault(); search.focus(); }
      } else go(rows[i - 1]);
      break;
    case "Home": if (onRow) go(rows[0]); break;
    case "End": if (onRow) go(rows[rows.length - 1]); break;
    case "PageDown": if (onRow) go(rows[Math.min(i + 10, rows.length - 1)]); break;
    case "PageUp": if (onRow) go(rows[Math.max(i - 10, 0)]); break;
    case "Enter":
      if (onRow) { const b = row.querySelector("[data-row-primary]"); if (b) { e.preventDefault(); b.click(); } }
      break;
    case "Delete":
      if (onRow) {
        const b = row.querySelector("[data-row-delete]");
        if (b) { e.preventDefault(); b.click(); refocusRowSoon(i); }
      }
      break;
    case "ArrowRight":
    case "ArrowLeft": {
      if (!onRow) break;
      const tg = row.querySelector("[data-row-toggle]");
      if (!tg) break;
      const expanded = tg.getAttribute("aria-expanded") === "true";
      if ((e.key === "ArrowRight") !== expanded) { e.preventDefault(); tg.click(); requestAnimationFrame(() => row.focus()); }
      break;
    }
    default:
  }
}

// "/" o F3 en cualquier parte de la página (fuera de un campo y sin un
// diálogo abierto) lleva a la búsqueda de la tabla.
export function useSearchShortcut(inputRef) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" && e.key !== "F3") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!inputRef.current?.isConnected) return;
      e.preventDefault();
      inputRef.current.focus();
      inputRef.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputRef]);
}

// ---------- Registro ÚNICO de atajos (UI 2026-11-10) ----------
// Fuente de verdad para: la ventana de ayuda (F1 / ?), las leyendas de los
// paneles (FORM_HINTS) y la leyenda de la captura de comprobantes. Si
// agregas un atajo en el código, agrégalo AQUÍ y aparece en todas partes.
//   keys:  alternativas; cada una es una combinación "Ctrl+Enter"
//   short: etiqueta corta para las leyendas en pantalla (opcional)
// contexto: "global" | "list" | "form" | "journal" | "menu"
export const SHORTCUTS = [
  {
    id: "global",
    title: { es: "En toda la aplicación", en: "Everywhere" },
    items: [
      { keys: ["F1"], es: "Mostrar u ocultar esta ayuda (también dentro de un campo)", en: "Show or hide this help (works inside a field too)" },
      { keys: ["?"], es: "Mostrar esta ayuda (fuera de un campo de texto)", en: "Show this help (outside a text field)" },
      { keys: ["F8"], es: "Nuevo comprobante desde cualquier pantalla (si hay un formulario abierto, primero ciérrelo)", en: "New journal entry from any screen (close any open form first)" },
      { keys: ["Insert"], es: "Crear un registro nuevo en la pantalla actual (catálogos y comprobantes)", en: "Create a new record on the current screen (catalogs and entries)" },
    ],
  },
  {
    id: "list",
    title: { es: "Listados y tablas", en: "Lists and tables" },
    items: [
      { keys: ["/", "F3"], es: "Ir a la búsqueda", en: "Go to search" },
      { keys: ["↓"], es: "Desde la búsqueda, bajar a la primera fila", en: "From search, move to the first row" },
      { keys: ["↑", "↓"], es: "Moverse entre filas", en: "Move between rows" },
      { keys: ["Inicio", "Fin"], es: "Primera / última fila", en: "First / last row" },
      { keys: ["RePág", "AvPág"], es: "Saltar 10 filas", en: "Jump 10 rows" },
      { keys: ["Enter"], es: "Editar la fila (o verla, si no es editable)", en: "Edit the row (or view it if read-only)" },
      { keys: ["Supr"], es: "Desactivar / anular la fila (pide confirmación)", en: "Deactivate / annul the row (asks to confirm)" },
      { keys: ["←", "→"], es: "Contraer / expandir un grupo (Plan de Cuentas)", en: "Collapse / expand a group (Chart of Accounts)" },
    ],
  },
  {
    id: "form",
    title: { es: "Formularios y paneles", en: "Forms and panels" },
    items: [
      { keys: ["Enter"], es: "Siguiente campo; en el último, ir a Guardar (en Terceros pasa a la pestaña siguiente)", en: "Next field; on the last one, go to Save (Third parties: next tab)", short: { es: "siguiente campo", en: "next field" } },
      { keys: ["Shift+Enter"], es: "Campo anterior", en: "Previous field", short: { es: "anterior", en: "previous" } },
      { keys: ["Ctrl+Enter", "Ctrl+S"], es: "Guardar desde cualquier campo", en: "Save from any field", short: { es: "guardar", en: "save" } },
      { keys: ["Esc"], es: "Cerrar (pide confirmación si hay cambios sin guardar)", en: "Close (asks to confirm if there are unsaved changes)", short: { es: "cerrar", en: "close" } },
      { keys: ["Tab", "Shift+Tab"], es: "Recorrer campos y botones sin salir del panel", en: "Cycle through fields and buttons without leaving the panel" },
      { keys: ["Espacio"], es: "Marcar / desmarcar un interruptor Sí/No", en: "Toggle a Yes/No switch" },
    ],
  },
  {
    id: "journal",
    title: { es: "Captura de comprobantes", en: "Journal entry capture" },
    items: [
      { keys: ["Enter", "Tab"], es: "Siguiente campo, siempre en el mismo orden (encabezado incluido); en la última línea crea una nueva; si la última línea está vacía, va a Guardar", en: "Next field, always in the same order (header included); on the last line creates a new one; if the last line is blank, goes to Save", short: { es: "siguiente campo", en: "next field" } },
      { keys: ["Shift+Enter", "Shift+Tab"], es: "Campo anterior (mismo orden, hacia atrás)", en: "Previous field (same order, backwards)", short: { es: "anterior", en: "previous" } },
      { keys: ["↑", "↓"], es: "Recorrer las sugerencias de cuenta y tercero", en: "Browse account and third-party suggestions", short: { es: "sugerencias", en: "suggestions" } },
      { keys: ["F2"], es: "Crear rápido la cuenta, tercero o centro de costo del campo actual", en: "Quick-create the account, third party or cost center of the current field", short: { es: "crear rápido", en: "quick-create" } },
      { keys: ["F4"], es: "Repetir el valor de la línea anterior en este campo", en: "Repeat the previous line's value in this field", short: { es: "repetir anterior", en: "repeat previous" } },
      { keys: [",", "."], es: "En Débito, Crédito y Base: escribir los centavos (los puntos de miles se ponen solos)", en: "In Debit, Credit and Base: start the cents (thousands separators are added automatically)" },
      { keys: ["F9"], es: "Autocuadrar la partida doble", en: "Auto-balance the double entry", short: { es: "autocuadrar", en: "auto-balance" } },
      { keys: ["Alt+Supr"], es: "Eliminar la línea actual", en: "Remove the current line", short: { es: "eliminar línea", en: "remove line" } },
      { keys: ["Ctrl+Enter", "Ctrl+S"], es: "Guardar el comprobante", en: "Save the entry", short: { es: "guardar", en: "save" } },
      { keys: ["Esc"], es: "Cerrar las sugerencias sin salir del campo; fuera de ellas, cancelar (con confirmación)", en: "Close suggestions keeping focus; otherwise cancel (asks to confirm)", short: { es: "cancelar", en: "cancel" } },
    ],
  },
  {
    id: "menu",
    title: { es: "Menús desplegables (Exportar)", en: "Drop-down menus (Export)" },
    items: [
      { keys: ["Enter", "Espacio"], es: "Abrir el menú", en: "Open the menu" },
      { keys: ["↑", "↓"], es: "Moverse entre opciones", en: "Move between options" },
      { keys: ["Esc"], es: "Cerrar y volver al botón", en: "Close and return to the button" },
    ],
  },
];

// Leyenda corta [teclas, texto] de un contexto, para <KeyboardHints/>.
export function hintsFor(contextId, language = "es") {
  const section = SHORTCUTS.find((s) => s.id === contextId);
  if (!section) return [];
  const lang = language === "en" ? "en" : "es";
  return section.items
    .filter((it) => it.short)
    .map((it) => [it.keys[0], it.short[lang]])
    .concat([["F1", lang === "en" ? "all shortcuts" : "todos los atajos"]]);
}

// Leyenda estándar de los paneles de formulario (ver <KeyboardHints/>).
export const FORM_HINTS = { es: hintsFor("form", "es"), en: hintsFor("form", "en") };
export const DISCARD_MESSAGE = {
  es: "Hay cambios sin guardar. ¿Desea descartarlos?",
  en: "There are unsaved changes. Discard them?",
};

// ¿En qué contexto está el usuario ahora? Para ordenar la ventana de ayuda.
// Prioridad: el contexto del elemento enfocado (o del diálogo abierto) ->
// "list" si la pantalla tiene una tabla navegable -> null.
export function currentKeyboardContext() {
  const fromFocus = document.activeElement?.closest?.("[data-kbd-context]")?.dataset.kbdContext;
  if (fromFocus) return fromFocus;
  const dialogs = [...document.querySelectorAll('[aria-modal="true"][data-kbd-context]')];
  if (dialogs.length) return dialogs[dialogs.length - 1].dataset.kbdContext;
  if (document.querySelector('[data-kbd-context="journal"]')) return "journal";
  if (document.querySelector("tr[data-kbd-row]")) return "list";
  return null;
}
