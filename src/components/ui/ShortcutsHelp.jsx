// ShortcutsHelp.jsx — ventana de atajos de teclado (UI 2026-11-10).
// Se abre con F1 (en cualquier parte, también dentro de un campo), con "?"
// (fuera de un campo de texto) o con el botón "Atajos" del encabezado.
// Muestra PRIMERO los atajos del contexto actual (listado, formulario,
// captura de comprobantes) y debajo el resto. Todo sale de SHORTCUTS en
// keyboard.js: no hay una segunda lista escrita a mano que pueda quedar
// desactualizada.
//
// Esc cierra SOLO esta ventana: el formulario o comprobante de atrás sigue
// abierto y el foco vuelve al campo donde estaba (Modal.jsx + belongsTo()
// de keyboard.js, que ignora eventos de otros diálogos).
import { useEffect } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";
import { SHORTCUTS } from "./keyboard";

const TEXT = {
  es: {
    title: "Atajos de teclado",
    subtitle: "Trabaja sin soltar el teclado. Abre esta ayuda con F1 o ?.",
    here: "En esta pantalla",
    print: "Imprimir",
    close: "Cerrar",
    or: "o",
    printTitle: "ERP Cloud — Atajos de teclado",
  },
  en: {
    title: "Keyboard shortcuts",
    subtitle: "Work without leaving the keyboard. Open this help with F1 or ?.",
    here: "On this screen",
    print: "Print",
    close: "Close",
    or: "or",
    printTitle: "ERP Cloud — Keyboard shortcuts",
  },
};

function Combo({ combo }) {
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {combo.split("+").map((k, i) => (
        <span key={k} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="text-slate-400" aria-hidden="true">+</span>}
          <kbd className="min-w-[1.5rem] rounded-md border border-slate-300 border-b-2 bg-white px-1.5 py-0.5 text-center font-sans text-xs font-semibold text-slate-700">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}
Combo.propTypes = { combo: PropTypes.string.isRequired };

function Keys({ keys, orLabel }) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {keys.map((combo, i) => (
        <span key={combo} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-slate-500">{orLabel}</span>}
          <Combo combo={combo} />
        </span>
      ))}
    </span>
  );
}
Keys.propTypes = { keys: PropTypes.arrayOf(PropTypes.string).isRequired, orLabel: PropTypes.string };

function Section({ section, lang, highlight, hereLabel, orLabel }) {
  return (
    <section
      className={`break-inside-avoid rounded-xl border p-4 ${highlight ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-white"}`}
      aria-labelledby={`kbd-sec-${section.id}`}
    >
      <h3 id={`kbd-sec-${section.id}`} className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
        {section.title[lang]}
        {highlight && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">
            {hereLabel}
          </span>
        )}
      </h3>
      <dl className="divide-y divide-slate-100">
        {section.items.map((it) => (
          <div key={it.keys.join("|") + it.es} className="flex items-start justify-between gap-4 py-1.5">
            <dt className="text-sm text-slate-700">{it[lang]}</dt>
            <dd className="shrink-0"><Keys keys={it.keys} orLabel={orLabel} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
Section.propTypes = {
  section: PropTypes.object.isRequired,
  lang: PropTypes.string.isRequired,
  highlight: PropTypes.bool,
  hereLabel: PropTypes.string,
  orLabel: PropTypes.string,
};

// Hoja para imprimir: todas las secciones, en el orden del registro, sin
// la interfaz alrededor (ver reglas @media print de index.css).
function PrintSheet({ lang, tx }) {
  return createPortal(
    <div className="kbd-print-sheet">
      <h1 className="mb-1 text-xl font-bold">{tx.printTitle}</h1>
      <p className="mb-4 text-sm">{tx.subtitle}</p>
      <div className="columns-2 gap-4">
        {SHORTCUTS.map((s) => (
          <Section key={s.id} section={s} lang={lang} orLabel={tx.or} />
        ))}
      </div>
    </div>,
    document.body
  );
}

function ShortcutsHelp({ onClose, language = "es", context = null }) {
  const lang = language === "en" ? "en" : "es";
  const tx = TEXT[lang];
  const ordered = [
    ...SHORTCUTS.filter((s) => s.id === context),
    ...SHORTCUTS.filter((s) => s.id === "global" && s.id !== context),
    ...SHORTCUTS.filter((s) => s.id !== context && s.id !== "global"),
  ];

  // La impresión muestra solo la hoja de atajos (clase en <body>).
  useEffect(() => {
    const done = () => document.body.classList.remove("kbd-printing");
    window.addEventListener("afterprint", done);
    return () => { window.removeEventListener("afterprint", done); done(); };
  }, []);
  const print = () => {
    document.body.classList.add("kbd-printing");
    window.print();
  };

  return (
    <>
      <Modal
        title={tx.title}
        subtitle={tx.subtitle}
        onClose={onClose}
        size="xl"
        layer="z-[90]"
        closeLabel={`${tx.close} (Esc)`}
        footer={
          <>
            <Button variant="secondary" onClick={print}>{tx.print}</Button>
            <Button variant="primary" onClick={onClose}>{tx.close}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ordered.map((s, i) => (
            <div key={s.id} className={i === 0 && s.id === context ? "lg:col-span-2" : ""}>
              <Section section={s} lang={lang} highlight={s.id === context} hereLabel={tx.here} orLabel={tx.or} />
            </div>
          ))}
        </div>
      </Modal>
      <PrintSheet lang={lang} tx={tx} />
    </>
  );
}

ShortcutsHelp.propTypes = {
  onClose: PropTypes.func.isRequired,
  language: PropTypes.string,
  context: PropTypes.string,
};

export default ShortcutsHelp;
