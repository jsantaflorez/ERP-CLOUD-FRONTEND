import { useState } from "react";
import { loginRequest } from "../services/securityService";
import { useAuth } from "../context/AuthContext";
import logo from "../logo/logo.png";
import spain from "../logo/spain.png";
import uk from "../logo/uk.png";
import translations from "../translations";

function Login({ onLogin, language, onLanguageChange }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const { login } = useAuth();

  const t = translations[language] || translations.es;

  /**
   * Handles the login form submission against the active backend.
   * @param {Event} e - The HTML form submit event.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || !password) {
      // Falls back to an inline string if translations.js doesn't have
      // this key yet — add `requiredFields` to both es/en dictionaries
      // in translations.js to remove this fallback.
      setError(t.requiredFields || (language === "es" ? "Por favor complete todos los campos" : "Please fill in all fields"));
      return;
    }

    setLoading(true);
    try {
      // Execute authentication request against our Spring Boot backend
      const result = await loginRequest(cleanUser, password);

      if (result && result.success) {
        /**
         * Enterprise Mapping:
         * Standardize backend response fields to match the UI expectations.
         *
         * FIX: previously assumed a nested `result.data.user` object with
         * `roles: [{ name: "..." }]` and a hardcoded companyId — that
         * shape doesn't match what this backend actually returns. The
         * real response is flat: { token, type, expiresIn, companyId,
         * email, fullName, roles: ["READ","CREATE",...] }. The old
         * mapping never THREW an error (optional chaining just silently
         * fell back to defaults), so login still "worked" but always
         * granted the "Administrator" fallback level and a fake
         * companyId, regardless of who actually logged in.
         */
        const mappedUser = {
          id: result.data.id ?? 1, // backend doesn't return a numeric user id in this payload
          username: result.data.fullName || result.data.email || cleanUser,
          roles: Array.isArray(result.data.roles) ? result.data.roles : [],
          // Kept for backward compatibility with Dashboard.jsx's current
          // role checks (which expect a single string level). This is a
          // coarse guess — SYS_ADMIN maps to "Administrator", anything
          // else falls back to "USER". Dashboard.jsx's authorization
          // logic should ideally be updated to check the `roles` array
          // directly instead of this flattened string; flagging this as
          // a follow-up rather than changing Dashboard.jsx silently here.
          level: Array.isArray(result.data.roles) && result.data.roles.includes("SYS_ADMIN")
            ? "Administrator"
            : "USER",
          active: true
        };

        // Feed the tenant/auth context (token + companyId) so every Axios
        // request picks it up automatically via the interceptor. This
        // replaces the old direct localStorage.setItem("token"/"companyId")
        // calls that used to live here.
        login({
          token: result.data.token,
          // FIX: companyId now comes from the backend's real response
          // instead of a hardcoded "4" — the backend already returns it.
          companyId: result.data.companyId != null ? String(result.data.companyId) : null,
          // TODO: backend doesn't return a company display name yet, only
          // the numeric companyId. Falls back to showing the raw ID in
          // the UI (see ThirdPartyPage/CostCenterPage/etc.'s AppHeader
          // tenantId prop) until the backend adds one.
          companyName: null,
          username: mappedUser.username,
          role: mappedUser.level,
        });

        // Propagate the clean, mapped user object to the main App wrapper
        // (this is a separate concern from the tenant/auth context above —
        // App.jsx uses it purely to decide whether to show Login or
        // Dashboard, and to display user info in the UI).
        onLogin(mappedUser);
      } else {
        setError(result.message || t.invalidCredentials);
      }
    } catch (err) {
      // Captures backend exceptions or network failures safely
      setError(err.message || t.invalidCredentials);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        {/* Language Selector */}
        <div className="absolute right-3 top-3 flex gap-2">
          {[{ lang: "es", src: spain, alt: "Español" }, { lang: "en", src: uk, alt: "English" }].map(({ lang, src, alt }) => (
            <button key={lang} type="button" onClick={() => onLanguageChange(lang)}
              className={`rounded-md p-1 ${language === lang ? "ring-2 ring-blue-500" : ""}`}>
              <img src={src} alt={alt} className="h-5 w-7 rounded-sm object-cover" />
            </button>
          ))}
        </div>

        <div className="mb-6 text-center">
          <img src={logo} alt="Logo ERP" className="mx-auto mb-3 h-20 w-20 object-contain" />
          <h1 className="text-2xl font-bold text-slate-800">{t.loginTitle}</h1>
          <p className="text-sm text-slate-500">{t.loginSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input type="text" placeholder={t.user} value={username}
            onChange={(e) => { setUsername(e.target.value); setError(""); }}
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
          />
          <input type="password" placeholder={t.password} value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading}
            className="rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {loading ? "..." : t.loginButton}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
