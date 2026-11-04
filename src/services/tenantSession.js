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
//
// UPDATED (2026-11-04): the display metadata (user name, email, roles and
// company name) is now persisted under "erp_session_meta", so the header's
// session block (AppHeader) survives a page reload -- including the reload
// AppHeader itself triggers after a company switch. Only display data lives
// there; authorization is always decided by the backend from the JWT.
const META_KEY = 'erp_session_meta';

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || 'null') || {};
  } catch {
    return {};
  }
}

function persistMeta(session) {
  try {
    const { companyName, username, email, roles, role } = session;
    localStorage.setItem(META_KEY, JSON.stringify({ companyName, username, email, roles, role }));
  } catch {
    // storage unavailable (private mode, quota): the header falls back to ids
  }
}

const meta = readMeta();

let activeSession = {
  companyId: localStorage.getItem('companyId') || null,
  companyName: meta.companyName ?? null,
  username: meta.username ?? null,
  email: meta.email ?? null,
  roles: Array.isArray(meta.roles) ? meta.roles : [],
  role: meta.role ?? null,
  token: localStorage.getItem('token') || null,
};




/**
 * Replaces the active session (e.g. on login, logout, or company switch).
 * @param {object} session - Partial or full session object to merge in.
 */
export function setActiveSession(session) {
  activeSession = { ...activeSession, ...session };
  persistMeta(activeSession);
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
    email: null,
    roles: [],
    role: null,
    token: null,
  };
  try {
    localStorage.removeItem(META_KEY);
  } catch {
    // ignore
  }
}
