// Alert.jsx — mensaje en línea con ícono + texto.
// error -> role="alert" (se anuncia de inmediato); el resto -> role="status".
import PropTypes from "prop-types";
import { IconError, IconWarning, IconSuccess, IconInfo } from "./Icons";

const TONES = {
  error:   { cls: "border-red-300 bg-red-50 text-red-800",         Icon: IconError },
  warning: { cls: "border-amber-300 bg-amber-50 text-amber-900",   Icon: IconWarning },
  success: { cls: "border-emerald-300 bg-emerald-50 text-emerald-800", Icon: IconSuccess },
  info:    { cls: "border-blue-200 bg-blue-50 text-blue-900",      Icon: IconInfo },
};

function Alert({ tone = "info", title, children, className = "" }) {
  const { cls, Icon } = TONES[tone] || TONES.info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${cls} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

Alert.propTypes = {
  tone: PropTypes.oneOf(["error", "warning", "success", "info"]),
  title: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};

export default Alert;
