// AmountInput.jsx — campo de monto con separadores en vivo (UI 2026-11-10).
//
// Mientras el digitador escribe, el campo va mostrando la puntuación
// colombiana: punto para miles/millones y coma para centavos.
//     1234567     ->  1.234.567
//     1234567,5   ->  1.234.567,5
//
// Reglas de digitación (pensadas para no tener que pensar):
//  - Los separadores de miles NUNCA se digitan: los pone el campo.
//  - La coma O el punto (incluido el del teclado numérico) = centavos.
//    Solo se acepta uno; máximo 2 decimales.
//  - Pegar "1.234.567,89", "1,234,567.89" o "$ 1234567" también funciona.
//  - Al entrar al campo se selecciona su contenido: digitar reemplaza.
//
// El valor que recibe/entrega el padre es el MISMO de antes: un string
// canónico ("1234567.5" o ""), así toNumber()/parseFloat y el backend no
// cambian. Solo cambia lo que se ve.
import { forwardRef, useLayoutEffect, useRef } from "react";
import PropTypes from "prop-types";

import { GROUP_SEP, DECIMAL_SEP, formatAmountTyping } from "../../utils/amountFormat";

const MAX_INT_DIGITS = 15; // por encima, los doubles de JS pierden precisión

// Texto del campo (con puntos de miles y coma decimal) -> canónico.
function parseDisplayed(text) {
  let int = "";
  let dec = null;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") {
      if (dec === null) int += ch;
      else if (dec.length < 2) dec += ch;
    } else if (ch === DECIMAL_SEP && dec === null) {
      dec = "";
    }
  }
  int = int.replace(/^0+(?=\d)/, "").slice(0, MAX_INT_DIGITS);
  if (int === "" && dec === null) return "";
  return dec === null ? int : `${int || "0"}.${dec}`;
}

// Texto pegado de cualquier origen -> canónico. El ÚLTIMO separador es el
// decimal si le siguen 1 o 2 dígitos; si no, todos son de miles.
function parsePasted(text) {
  const clean = String(text).replace(/[^\d.,]/g, "");
  const lastSep = Math.max(clean.lastIndexOf("."), clean.lastIndexOf(","));
  if (lastSep === -1) return parseDisplayed(clean);
  const after = clean.slice(lastSep + 1);
  const isDecimal = /^\d{1,2}$/.test(after);
  const intPart = clean.slice(0, isDecimal ? lastSep : clean.length).replace(/[.,]/g, "");
  return parseDisplayed(isDecimal ? `${intPart}${DECIMAL_SEP}${after}` : intPart);
}

// Cuántos caracteres "con significado" (dígitos y coma) hay antes de pos.
const significantBefore = (text, pos) =>
  [...text.slice(0, pos)].filter((c) => (c >= "0" && c <= "9") || c === DECIMAL_SEP).length;

const caretForSignificant = (text, count) => {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ((c >= "0" && c <= "9") || c === DECIMAL_SEP) seen += 1;
    if (seen === count) return i + 1;
  }
  return text.length;
};

const AmountInput = forwardRef(function AmountInput(
  { value, onChange, onKeyDown, onFocus, className = "", placeholder = "0,00", ...rest },
  forwardedRef
) {
  const inputRef = useRef(null);
  const pendingCaret = useRef(null);
  const display = formatAmountTyping(value);

  const setRefs = (el) => {
    inputRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  // Tras re-formatear, el cursor vuelve a quedar después del mismo dígito.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && pendingCaret.current !== null && document.activeElement === el) {
      const pos = caretForSignificant(el.value, pendingCaret.current);
      el.setSelectionRange(pos, pos);
    }
    pendingCaret.current = null;
  });

  const commit = (canonical, significantCount) => {
    pendingCaret.current = significantCount;
    onChange(canonical);
  };

  const handleChange = (e) => {
    const el = e.target;
    commit(parseDisplayed(el.value), significantBefore(el.value, el.selectionStart ?? el.value.length));
  };

  const handleKeyDown = (e) => {
    // "." o "," (o el decimal del teclado numérico) = coma de centavos.
    if ((e.key === "." || e.key === "," || e.key === "Decimal") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const text = el.value;
      const hasDecimal = text.includes(DECIMAL_SEP) && !text.slice(start, end).includes(DECIMAL_SEP);
      if (hasDecimal) {
        // Ya hay coma: saltar a los centavos en vez de crear otra.
        const pos = text.indexOf(DECIMAL_SEP) + 1;
        el.setSelectionRange(pos, pos);
      } else {
        const next = `${text.slice(0, start)}${DECIMAL_SEP}${text.slice(end)}`;
        commit(parseDisplayed(next), significantBefore(next, start + 1));
      }
      return;
    }
    // Retroceso sobre un punto de miles: borrar el dígito anterior a él.
    if (e.key === "Backspace" && !e.ctrlKey) {
      const el = e.currentTarget;
      const start = el.selectionStart;
      if (start === el.selectionEnd && start > 0 && el.value[start - 1] === GROUP_SEP) {
        e.preventDefault();
        const next = el.value.slice(0, start - 2) + el.value.slice(start);
        commit(parseDisplayed(next), significantBefore(next, start - 2));
        return;
      }
    }
    onKeyDown?.(e);
  };

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData("text");
    if (text == null) return;
    e.preventDefault();
    const canonical = parsePasted(text);
    pendingCaret.current = Infinity;
    onChange(canonical);
  };

  return (
    <input
      {...rest}
      ref={setRefs}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      placeholder={placeholder}
      className={`${className} text-right tabular-nums`}
    />
  );
});

AmountInput.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func.isRequired,
  onKeyDown: PropTypes.func,
  onFocus: PropTypes.func,
  className: PropTypes.string,
  placeholder: PropTypes.string,
};

export default AmountInput;
