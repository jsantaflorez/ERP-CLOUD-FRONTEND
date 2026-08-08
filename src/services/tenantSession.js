// src/services/tenantSession.js
//
// This module is the single source of truth for "who is logged in and
// which company is active right now". It lives OUTSIDE React on purpose:
// Axios interceptors are plain functions, not components or hooks, so they
// cannot call useAuth(). Instead, AuthContext calls setActiveSession(...)
// whenever the session changes, and api.js (the Axios interceptor) calls
// getActiveSession() on every request to read the latest values.
//
// AuthContext is only a "read + render" layer on top of this module — the
// real value lives here.

// TODO: once real login/JWT is wired up, hydrate this initial value from
// localStorage or from a `/me` backend call instead of hardcoding it.

let activeSession = {
  companyId: localStorage.getItem('companyId') || "4", // Use whatever is in storage, or "4" if it is empty.
  companyName: "Compañía Demo S.A.",
  username: "Administrador",
  role: "ADMIN",
  token: localStorage.getItem('token') || null,
};




/**
 * Replaces the active session (e.g. on login, logout, or company switch).
 * @param {object} session - Partial or full session object to merge in.
 */
export function setActiveSession(session) {
  activeSession = { ...activeSession, ...session };
}

/**
 * Returns the current session. Always call this fresh (don't cache the
 * result in module scope elsewhere) since it can change between requests.
 */
export function getActiveSession() {
  return activeSession;
}

/**
 * Clears the session back to an "empty" state. Use this on logout.
 * Intentionally does NOT reset to the demo defaults above, so that a
 * logged-out state is never confused with a valid session.
 */
export function clearActiveSession() {
  activeSession = {
    companyId: null,
    companyName: null,
    username: null,
    role: null,
    token: null,
  };
}
