// LoadingState.jsx — estado de carga anunciado a lectores de pantalla.
import PropTypes from "prop-types";

function LoadingState({ label = "Cargando…", className = "py-16" }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-2 text-sm text-slate-600 ${className}`}>
      <svg className="h-4 w-4 animate-spin text-blue-700" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

LoadingState.propTypes = { label: PropTypes.node, className: PropTypes.string };

export default LoadingState;
