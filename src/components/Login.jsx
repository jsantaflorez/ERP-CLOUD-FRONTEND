import { useEffect, useRef, useState } from "react";
import { loginRequest, selectCompanyRequest } from "../services/securityService";
import { useAuth } from "../context/AuthContext";
import logo from "../logo/logo.png";
import spain from "../logo/spain.png";
import uk from "../logo/uk.png";
import translations from "../translations";
import { levelFromRoles } from "../utils/roleLevel";
import { API_ERROR_LABELS } from "../constants/apiErrors";
import { getLastCompanyId } from "../utils/lastCompany";

// B1 (auditoría F1-13, 2026-11-25): login en dos pasos.
//
// Paso 1: correo + contraseña. Antes, al salir del campo correo la pantalla
// pedía SIN contraseña la lista de empresas de ese correo (un directorio
// público de clientes con su NIT). Ahora las empresas solo llegan después de
// verificar la contraseña, junto con un token de pre-sesión de 5 minutos que
// vive solo en la memoria de esta pantalla (nunca en localStorage).
//
// Paso 2: la lista de empresas (nombre y NIT), SIEMPRE visible aunque haya
// una sola (decisión del usuario), con la última usada en este equipo ya
// resaltada: ↑/↓ (Inicio/Fin) para moverse, Enter o clic para entrar, Esc o
// "Cambiar usuario" para volver al paso 1.
function Login({ onLogin, language, onLanguageChange }) {
  const [step, setStep] = useState("credentials"); // "credentials" | "company"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Paso 2
  const [preAuth, setPreAuth] = useState(null); // { token, email, fullName, companies }
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef(null);
  const emailRef = useRef(null);

  const { login } = useAuth();
  const t = translations[language] || translations.es;

  const authErrorMessage = (code) =>
    (API_ERROR_LABELS[language] || API_ERROR_LABELS.es)[code] || t.invalidCredentials;

  // Al llegar al paso 2, el foco va a la lista para seguir solo con teclado.
  useEffect(() => {
    if (step === "company") listRef.current?.focus();
    if (step === "credentials") emailRef.current?.focus();
  }, [step]);

  const backToCredentials = (message = "") => {
    setStep("credentials");
    setPreAuth(null);
    setPassword("");
    setError(message);
  };

  const handleCredentials = async (e) => {
    e.preventDefault();
    setError("");
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || !password) {
      setError(t.requiredFields || (language === "es" ? "Por favor complete todos los campos" : "Please fill in all fields"));
      return;
    }
    setLoading(true);
    try {
      const data = await loginRequest(cleanUser, password);
      const companies = Array.isArray(data?.companies) ? data.companies : [];
      const lastId = getLastCompanyId(data?.email || cleanUser);
      const lastIndex = companies.findIndex((c) => String(c.id) === String(lastId));
      setPreAuth({
        token: data?.preAuthToken,
        email: data?.email || cleanUser,
        fullName: data?.fullName || "",
        companies,
      });
      setHighlight(lastIndex >= 0 ? lastIndex : 0);
      setPassword(""); // ya no se necesita: el paso 2 usa el token de pre-sesión
      setStep("company");
    } catch (err) {
      setError(authErrorMessage(err.code || err.message));
    } finally {
      setLoading(false);
    }
  };

  const enterCompany = async (company) => {
    if (!company || loading || !preAuth) return;
    setError("");
    setLoading(true);
    try {
      const data = await selectCompanyRequest(preAuth.token, company.id);
      const roles = Array.isArray(data?.roles) ? data.roles : [];
      const mappedUser = {
        id: data?.id ?? 1, // the payload carries no numeric user id
        username: data?.fullName || data?.email || preAuth.email,
        roles,
        level: levelFromRoles(roles),
        active: true,
      };
      login({
        token: data?.token,
        companyId: data?.companyId != null ? String(data.companyId) : String(company.id),
        companyName: company.tradeName || company.legalName,
        username: mappedUser.username,
        email: data?.email || preAuth.email,
        roles,
        role: mappedUser.level,
      });
      onLogin(mappedUser);
    } catch (err) {
      const code = err.code || err.message;
      if (code === "LOGIN_SESSION_EXPIRED") {
        backToCredentials(authErrorMessage(code));
      } else {
        setError(authErrorMessage(code));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleListKeyDown = (e) => {
    const count = preAuth?.companies?.length || 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(Math.max(count - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      enterCompany(preAuth?.companies?.[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      backToCredentials();
    }
  };

  const optionId = (index) => `login-company-${index}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        {/* Language Selector */}
        <div className="absolute right-3 top-3 flex gap-2">
          {[{ lang: "es", src: spain, alt: "Espanol" }, { lang: "en", src: uk, alt: "English" }].map(({ lang, src, alt }) => (
            <button key={lang} type="button" onClick={() => onLanguageChange(lang)}
              className={`rounded-md p-1 ${language === lang ? "ring-2 ring-blue-500" : ""}`}>
              <img src={src} alt={alt} className="h-5 w-7 rounded-sm object-cover" />
            </button>
          ))}
        </div>

        <div className="mb-6 text-center">
          <img src={logo} alt="ZORU" className="mx-auto mb-3 h-20 w-20 object-contain" />
          <h1 className="text-2xl font-bold text-slate-800">{t.loginTitle}</h1>
          <p className="text-sm text-slate-500">{t.loginSubtitle}</p>
        </div>

        {step === "credentials" ? (
          // FIX (2026-11-25, prueba del usuario): el mensaje ya NO se borra al
          // cambiar un campo. Al volver del paso 2 el navegador autocompleta
          // correo/contraseña, eso disparaba onChange y el aviso de "pasó
          // demasiado tiempo" desaparecía casi enseguida. Ahora el mensaje
          // queda hasta el siguiente intento (handleCredentials lo limpia).
          <form onSubmit={handleCredentials} className="flex flex-col gap-4">
            <input ref={emailRef} type="text" placeholder={t.user} value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
            />
            <input type="password" placeholder={t.password} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
            />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={loading}
              className="rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
              {loading ? "..." : t.loginButton}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              {preAuth?.fullName && (
                <p className="text-sm text-slate-600">{t.loginGreeting} <strong className="text-slate-800">{preAuth.fullName}</strong></p>
              )}
              <p className="text-sm font-semibold text-slate-800">{t.selectCompany}</p>
            </div>

            <ul
              ref={listRef}
              role="listbox"
              tabIndex={0}
              aria-label={t.selectCompany}
              aria-activedescendant={optionId(highlight)}
              onKeyDown={handleListKeyDown}
              className="max-h-72 overflow-y-auto rounded-xl border border-slate-300 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {(preAuth?.companies || []).map((c, index) => {
                const active = index === highlight;
                return (
                  <li
                    key={c.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => enterCompany(c)}
                    className={`cursor-pointer border-b border-slate-100 px-4 py-3 last:border-b-0 ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <div className={`text-sm font-semibold ${active ? "text-blue-700" : "text-slate-800"}`}>{c.legalName}</div>
                    <div className="text-xs text-slate-500">
                      {c.taxId ? `${t.companyTaxId} ${c.taxId}` : ""}
                      {c.tradeName && c.tradeName !== c.legalName ? `${c.taxId ? " · " : ""}${c.tradeName}` : ""}
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="text-[11px] text-slate-500">{t.loginCompanyHint}</p>
            {error && <p className="text-sm text-red-700">{error}</p>}

            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => backToCredentials()} disabled={loading}
                className="text-sm text-slate-600 underline hover:text-slate-800 disabled:opacity-60">
                {t.changeUser}
              </button>
              <button type="button" onClick={() => enterCompany(preAuth?.companies?.[highlight])} disabled={loading}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {loading ? "..." : t.loginButton}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
