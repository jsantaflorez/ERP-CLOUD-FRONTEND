// src/services/tenantSession.js
//
// This module is the single source of truth for "who is logged in and
// which company is active right now". It lives OUTSIDE React on purpose:
// Axios interceptors are plain functions, not components or hooks, so they
// cannot call useAuth(). Instead, AuthContext calls setActiveSession(...)
// whenever the session changes, and api.js (the Axios interceptor) calls
// getActiveSession() on every request to read the latest values.
//
// AuthContext is only a "read + render" layer on top of this module -- the
// real value lives here.

// FIXED (2026-10-28, Multiempresa Fase 2): used to hardcode a demo
// company ("4" / "Compania Demo S.A.") as the fallback here, which masked
// the fact that companyId is now a real per-user, per-login value (see
// Login.jsx's company dropdown). A logged-out/not-yet-logged-in session
// should look empty, never like a valid fake session. companyId/token
// still restore from localStorage so a page reload keeps you logged in;
// companyName is not persisted to localStorage today (see AuthContext's
// login()), so it starts null on reload until AppHeader's own company
// list fetch resolves the label again.
let activeSession = {
  companyId: localStorage.getItem('companyId') || null,
  companyName: null,
  username: null,
  role: null,
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
