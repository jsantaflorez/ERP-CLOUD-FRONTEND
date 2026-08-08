 // src/components/common/AppHeader.jsx
import logo from "../../logo/logo.png";  // sube 2 niveles: common → components → src → logo

function AppHeader({ title, subtitle, actions, tenantId }) {
  return (
    <div className="mb-6 flex items-center justify-between rounded-2xl bg-white px-6 py-4 shadow-sm ring-1 ring-slate-200">

      {/* ── Bloque izquierdo: Logo + Textos ── */}
      <div className="flex items-center gap-4">
        <img
          src={logo}
          alt="IntEgraERP Logo"
          className="h-12 w-auto object-contain"
        />
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          )}
        </div>
      </div>

      {/* ── Bloque derecho: Tenant Badge + Acciones ── */}
      <div className="flex items-center gap-3">

        {/* Badge que indica la compañía activa */}
        {tenantId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            {tenantId}
          </span>
        )}

        {/* Slot de acciones: cada módulo inyecta sus propios botones */}
        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>

    </div>
  );
}

export default AppHeader;