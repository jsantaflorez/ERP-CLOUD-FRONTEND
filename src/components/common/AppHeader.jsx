// src/components/common/AppHeader.jsx
//
// UI 2026-11-21 (análisis de usabilidad del encabezado): este encabezado
// llevaba, en cada una de las 27 pantallas, el logo, un subtítulo y toda la
// sesión (atajos, usuario con rol y cerrar sesión, empresa activa con su
// selector) en tres tarjetas con etiquetas en mayúsculas. La sesión pasó a la
// barra global (common/GlobalBar.jsx, montada una sola vez por Dashboard) y el
// logo ya está en el menú lateral. Aquí queda solo lo que es de la pantalla:
// el título, un dato corto opcional (`meta`, p. ej. "8 documentos") y las
// acciones de la pantalla.
//
// La firma no cambia para no tocar las 27 pantallas: `subtitle`, `tenantId` y
// `language` se siguen aceptando. El subtítulo ya no se pinta como una línea
// aparte (repetía el título y sumaba altura); queda como ayuda al pasar el
// cursor sobre el título.
function AppHeader({ title, subtitle, actions, meta }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-xl font-bold text-slate-900" title={subtitle || undefined}>
          {title}
        </h1>
        {meta != null && meta !== "" && (
          <span className="whitespace-nowrap text-sm text-slate-500">{meta}</span>
        )}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default AppHeader;
