// MenuButton.jsx — botón con menú desplegable (UI 2026-11-10).
// Agrupa acciones secundarias del mismo tipo bajo un solo botón, p. ej.
// "Exportar ▾" -> Excel / PDF, para no llenar el encabezado de botones.
//
//   <MenuButton label="Exportar" items={[
//     { label: "Excel", onClick: exportExcel },
//     { label: "PDF",   onClick: exportPdf },
//   ]} />
//
// Teclado: Enter/Espacio abre, flechas recorren, Escape cierra y devuelve
// el foco al botón. Clic fuera también cierra.
import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { colors, sizes, radius } from "./tokens";

function MenuButton({ label, items, variant = "secondary", size = "sm", align = "right", disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    itemRefs.current[0]?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onMenuKeyDown = (e) => {
    const list = itemRefs.current.filter(Boolean);
    const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${radius} ${colors[variant]} ${sizes[size]}`}
      >
        {label}
        <svg className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          onKeyDown={onMenuKeyDown}
          className={`absolute top-full z-30 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => (itemRefs.current[i] = el)}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

MenuButton.propTypes = {
  label:   PropTypes.node.isRequired,
  items:   PropTypes.arrayOf(PropTypes.shape({ label: PropTypes.string.isRequired, onClick: PropTypes.func.isRequired })).isRequired,
  variant: PropTypes.oneOf(["primary", "secondary", "ghost"]),
  size:    PropTypes.oneOf(["xs", "sm", "md", "lg"]),
  align:   PropTypes.oneOf(["left", "right"]),
  disabled: PropTypes.bool,
};

export default MenuButton;
