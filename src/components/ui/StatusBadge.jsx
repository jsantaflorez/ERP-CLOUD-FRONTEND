// StatusBadge.jsx — estado con forma + texto, nunca solo color.
import PropTypes from "prop-types";

const TONES = {
  success: { cls: "bg-emerald-50 text-emerald-800 ring-emerald-600/30", mark: "●" },
  danger:  { cls: "bg-red-50 text-red-800 ring-red-600/30",             mark: "✕" },
  warning: { cls: "bg-amber-50 text-amber-900 ring-amber-600/30",       mark: "!" },
  neutral: { cls: "bg-slate-100 text-slate-700 ring-slate-500/30",      mark: "○" },
};

function StatusBadge({ tone = "neutral", children }) {
  const { cls, mark } = TONES[tone] || TONES.neutral;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      <span aria-hidden="true" className="text-[0.7em] leading-none">{mark}</span>
      {children}
    </span>
  );
}

StatusBadge.propTypes = {
  tone: PropTypes.oneOf(["success", "danger", "warning", "neutral"]),
  children: PropTypes.node.isRequired,
};

export default StatusBadge;
