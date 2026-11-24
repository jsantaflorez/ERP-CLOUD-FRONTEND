// src/components/ui/PeriodPresetSelect.jsx
//
// UI 2026-11-24 (pedido del usuario): atajos de período en los reportes --
// "Este mes", "Mes anterior", "Este año", "Año anterior"... -- en vez de
// digitar dos fechas cada vez. Se monta JUNTO a los campos Desde/Hasta que
// ya tiene cada reporte; no los reemplaza:
//  - Elegir un atajo llena las dos fechas (el reporte se sigue generando con
//    su botón, como siempre).
//  - Si el usuario cambia una fecha a mano, el selector pasa solo a
//    "Personalizado": no guarda estado propio, deduce el atajo comparando
//    las fechas actuales con cada rango.
//  - Los rangos del período en curso terminan HOY, no a fin de mes/año: los
//    reportes rechazan fechas futuras y "hasta hoy" es lo que se quiere ver.
//
// AsOfPresetSelect es lo mismo para los reportes con una sola fecha de
// corte (Balance General, Balance de Comprobación).
import { todayLocalIso } from "../../utils/reportExport";

const LABELS = {
  es: {
    period: "Período",
    asOf: "Corte",
    thisMonth: "Este mes",
    lastMonth: "Mes anterior",
    thisBimester: "Bimestre actual (IVA)",
    lastBimester: "Bimestre anterior (IVA)",
    thisYear: "Este año",
    lastYear: "Año anterior",
    all: "Todo",
    custom: "Personalizado",
    today: "Hoy",
    endOfLastMonth: "Fin del mes anterior",
    endOfLastYear: "Cierre del año anterior",
  },
  en: {
    period: "Period",
    asOf: "As of",
    thisMonth: "This month",
    lastMonth: "Last month",
    thisBimester: "Current two-month period (VAT)",
    lastBimester: "Previous two-month period (VAT)",
    thisYear: "This year",
    lastYear: "Last year",
    all: "All",
    custom: "Custom",
    today: "Today",
    endOfLastMonth: "End of last month",
    endOfLastYear: "End of last year",
  },
};

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Inclusive [start, end] of a preset, as ISO dates. Current-period presets
// end today; past ones are complete.
function presetRange(key, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = todayLocalIso();
  // Colombian VAT two-month periods: Jan-Feb, Mar-Apr, ... Nov-Dec.
  const bStart = m - (m % 2);
  switch (key) {
    case "thisMonth": return [iso(new Date(y, m, 1)), today];
    case "lastMonth": return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "thisBimester": return [iso(new Date(y, bStart, 1)), today];
    case "lastBimester": return [iso(new Date(y, bStart - 2, 1)), iso(new Date(y, bStart, 0))];
    case "thisYear": return [`${y}-01-01`, today];
    case "lastYear": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case "all": return ["", ""];
    default: return null;
  }
}

function asOfPresetDate(key, now = new Date()) {
  switch (key) {
    case "today": return todayLocalIso();
    case "endOfLastMonth": return iso(new Date(now.getFullYear(), now.getMonth(), 0));
    case "endOfLastYear": return `${now.getFullYear() - 1}-12-31`;
    default: return null;
  }
}

const selectCls =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500";
const labelCls = "text-[10px] font-black text-slate-500 uppercase tracking-widest";

export function PeriodPresetSelect({ startDate, endDate, onChange, language = "es", bimesters = false, allowAll = false }) {
  const t = LABELS[language] || LABELS.es;
  const keys = [
    "thisMonth",
    "lastMonth",
    ...(bimesters ? ["thisBimester", "lastBimester"] : []),
    "thisYear",
    "lastYear",
    ...(allowAll ? ["all"] : []),
  ];
  const current = keys.find((k) => {
    const [s, e] = presetRange(k);
    return s === (startDate || "") && e === (endDate || "");
  }) || "custom";

  return (
    <div className="flex flex-col gap-1">
      <label className={labelCls} htmlFor="period-preset">{t.period}</label>
      <select
        id="period-preset"
        value={current}
        onChange={(e) => {
          const range = presetRange(e.target.value);
          if (range) onChange(range[0], range[1]);
        }}
        className={selectCls}
      >
        {keys.map((k) => <option key={k} value={k}>{t[k]}</option>)}
        <option value="custom">{t.custom}</option>
      </select>
    </div>
  );
}

export function AsOfPresetSelect({ asOfDate, onChange, language = "es" }) {
  const t = LABELS[language] || LABELS.es;
  const keys = ["today", "endOfLastMonth", "endOfLastYear"];
  const current = keys.find((k) => asOfPresetDate(k) === asOfDate) || "custom";

  return (
    <div className="flex flex-col gap-1">
      <label className={labelCls} htmlFor="asof-preset">{t.asOf}</label>
      <select
        id="asof-preset"
        value={current}
        onChange={(e) => {
          const date = asOfPresetDate(e.target.value);
          if (date) onChange(date);
        }}
        className={selectCls}
      >
        {keys.map((k) => <option key={k} value={k}>{t[k]}</option>)}
        <option value="custom">{t.custom}</option>
      </select>
    </div>
  );
}
