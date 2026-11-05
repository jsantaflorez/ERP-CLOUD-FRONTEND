// Field.jsx — etiqueta + control + ayuda/error, enlazados para lectores
// de pantalla: <label htmlFor>, aria-invalid y aria-describedby se
// agregan solos al único hijo (input, select o textarea).
import { Children, cloneElement, isValidElement, useId } from "react";
import PropTypes from "prop-types";
import { labelClass, hintClass } from "./tokens";
import { IconError } from "./Icons";

function Field({ label, error, hint, required = false, children, className = "" }) {
  const autoId = useId();
  const controls = Children.toArray(children);
  const first = controls.find(isValidElement);
  const id = first?.props?.id || `f${autoId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [first?.props?.["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  const enhanced = controls.map((child) =>
    child === first
      ? cloneElement(child, {
          id,
          "aria-invalid": error ? true : child.props["aria-invalid"],
          "aria-describedby": describedBy,
          "aria-required": required || child.props["aria-required"],
        })
      : child,
  );

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label htmlFor={id} className={labelClass}>
          {label}
          {required && <span className="ml-0.5 text-red-700" aria-hidden="true">*</span>}
        </label>
      )}
      {enhanced}
      {hint && !error && <span id={hintId} className={hintClass}>{hint}</span>}
      {error && (
        <span id={errorId} className="flex items-center gap-1 text-xs font-medium text-red-700">
          <IconError className="h-3.5 w-3.5 shrink-0" />
          {error}
        </span>
      )}
    </div>
  );
}

Field.propTypes = {
  label: PropTypes.node,
  error: PropTypes.node,
  hint: PropTypes.node,
  required: PropTypes.bool,
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
};

export default Field;
