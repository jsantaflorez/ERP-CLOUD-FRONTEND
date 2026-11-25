// src/components/ui/useElapsedSeconds.js
//
// Fase 4 (2026-11-24, pedido del usuario): los reportes que llegan en UNA
// sola petición (Libro Auxiliar, Balances, Estado de Resultados…) no pueden
// mostrar "X de Y" como el Libro Diario, porque el servidor entrega todo de
// una vez. Mientras se generan, el botón muestra el tiempo transcurrido
// ("Generando… 8 s") para que se vea que el reporte sigue trabajando.
import { useEffect, useState } from "react";

/** Segundos desde que `active` pasó a true (0 mientras no está activo). */
export function useElapsedSeconds(active) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [active]);
  return active ? elapsed : 0;
}

/** "Generando..." -> "Generando… 8 s" (sin segundos durante el primero). */
export function generatingLabel(base, seconds) {
  if (!seconds) return base;
  return `${String(base).replace(/(\.\.\.|…)$/, "")}… ${seconds} s`;
}
