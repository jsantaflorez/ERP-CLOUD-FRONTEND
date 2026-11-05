// Toast.jsx — aviso flotante. Recibe el mismo objeto { type, msg } que
// ya usan las páginas. Ícono + texto; error se anuncia con role="alert".
import PropTypes from "prop-types";
import { IconError, IconSuccess } from "./Icons";

function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === "error";
  const Icon = isError ? IconError : IconSuccess;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`fixed bottom-6 right-6 z-[100] flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-xl ${
        isError ? "bg-red-700" : "bg-emerald-700"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{toast.msg}</span>
    </div>
  );
}

Toast.propTypes = {
  toast: PropTypes.shape({ type: PropTypes.string, msg: PropTypes.node }),
};

export default Toast;
