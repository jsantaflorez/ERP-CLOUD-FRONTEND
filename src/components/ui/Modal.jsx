// Modal.jsx — diálogo accesible: role="dialog", aria-modal, título
// enlazado, Escape para cerrar, foco atrapado dentro y devuelto al
// elemento que lo abrió al cerrar.
import { useEffect, useId, useRef } from "react";
import PropTypes from "prop-types";
import { IconClose } from "./Icons";

const SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Modal({ title, subtitle, onClose, size = "md", footer, children, closeLabel = "Cerrar", dismissible = true }) {
  const titleId = useId();
  const panelRef = useRef(null);
  // onClose suele llegar como función en línea; se guarda en una ref para
  // que el efecto corra una sola vez y no robe el foco en cada render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    // Respeta un autoFocus que ya haya puesto el contenido.
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector("[autofocus]") || panel.querySelector(FOCUSABLE) || panel).focus();
    }
    const onKey = (e) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onCloseRef.current?.();
      } else if (e.key === "Tab" && panel) {
        const items = [...panel.querySelectorAll(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [dismissible]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[85vh] w-full flex-col rounded-xl bg-white shadow-2xl outline-none ${SIZES[size] || SIZES.md}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="-mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <IconClose className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

Modal.propTypes = {
  title: PropTypes.node.isRequired,
  subtitle: PropTypes.node,
  onClose: PropTypes.func,
  size: PropTypes.oneOf(["sm", "md", "lg", "xl"]),
  footer: PropTypes.node,
  children: PropTypes.node,
  closeLabel: PropTypes.string,
  dismissible: PropTypes.bool,
};

export default Modal;
