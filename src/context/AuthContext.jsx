// src/context/AuthContext.jsx
import { createContext, useContext, useState, useCallback } from "react";
import {
  getActiveSession,
  setActiveSession,
  clearActiveSession,
} from "../services/tenantSession";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // React state here is a MIRROR of tenantSession's module-level state,
  // used purely so components re-render when the session changes.
  // The actual source of truth lives in tenantSession.js so that non-React
  // code (like the Axios interceptor) can read it too.
  const [session, setSession] = useState(getActiveSession());

  // Called from Login.jsx's handleSubmit with the mapped session data.
  // Also mirrors token/companyId into localStorage: tenantSession.js is
  // in-memory only, so without this a page reload would wipe the tenant
  // context even though App.jsx still restores the logged-in user from
  // localStorage separately.
  // TODO: replace this localStorage mirroring with a proper hydration
  // step (e.g. a `/me` call) once the backend supports it, instead of
  // trusting values echoed back from the browser.
  const login = useCallback((sessionData) => {
    setActiveSession(sessionData);
    setSession(getActiveSession());

    if (sessionData.token) localStorage.setItem("token", sessionData.token);
    if (sessionData.companyId) localStorage.setItem("companyId", sessionData.companyId);
  }, []);

  const logout = useCallback(() => {
    clearActiveSession();
    setSession(getActiveSession());

    localStorage.removeItem("token");
    localStorage.removeItem("companyId");
  }, []);

  // The day a company switcher exists in AppHeader, it calls this.
  const switchCompany = useCallback((newCompanyId, newCompanyName) => {
    setActiveSession({ companyId: newCompanyId, companyName: newCompanyName });
    setSession(getActiveSession());
  }, []);

  return (
    <AuthContext.Provider value={{ session, login, logout, switchCompany }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook for consuming the current session inside components.
 * Throws early if used outside <AuthProvider> to make misuse obvious
 * instead of silently returning null and failing later on session.xxx.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
