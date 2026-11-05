// Button.jsx — Átomo reutilizable para IntEgraERP
// Uso (ver jerarquía en tokens.js):
//   <Button variant="primary" onClick={fn}>+ Nuevo</Button>
//   <Button variant="secondary" onClick={fn}>Cancelar</Button>
//   <Button variant="danger" onClick={fn}>Desactivar</Button>
//   <Button variant="dangerSolid" onClick={fn}>Sí, anular</Button>
//   <Button variant="ghost" size="xs" onClick={fn}>Editar</Button>
//   <Button variant="primary" size="lg" fullWidth>Guardar</Button>
//   <Button variant="primary" loading>Guardando...</Button>

import PropTypes from "prop-types";
import { colors, sizes, radius } from "./tokens";

function Button({
  children,
  variant  = "primary",
  size     = "md",
  type     = "button",
  fullWidth = false,
  loading   = false,
  disabled  = false,
  onClick,
  className = "",
  title,
  ...rest
}) {
  // El foco visible lo da la regla global :focus-visible de index.css
  // (contorno azul de 2px), igual para botones, campos y enlaces.
  const base = "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  const classes = [
    base,
    radius,
    colors[variant] || colors.primary,
    sizes[size]     || sizes.md,
    fullWidth ? "w-full" : "",
    className,
  ].join(" ");

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      title={title}
      {...rest}
    >
      {/* Spinner visible solo cuando loading=true */}
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      )}
      {children}
    </button>
  );
}

Button.propTypes = {
  children:  PropTypes.node.isRequired,
  variant:   PropTypes.oneOf(["primary", "secondary", "ghost", "danger", "dangerSolid", "dangerGhost"]),
  size:      PropTypes.oneOf(["xs", "sm", "md", "lg"]),
  type:      PropTypes.oneOf(["button", "submit", "reset"]),
  fullWidth: PropTypes.bool,
  loading:   PropTypes.bool,
  disabled:  PropTypes.bool,
  onClick:   PropTypes.func,
  className: PropTypes.string,
  // NEW (2026-09-14): optional native tooltip, e.g. to surface a keyboard
  // shortcut ("Nuevo (Insert)") without adding visible chrome everywhere
  // this button is reused.
  title:     PropTypes.string,
};

export default Button;
