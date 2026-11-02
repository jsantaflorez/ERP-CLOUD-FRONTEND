import axios from 'axios';
import { getActiveSession } from './tenantSession';

/**
 * Central Axios instance pointing to the Spring Boot backend API.
 *
 * The base URL comes from the build-time variable VITE_API_URL (audit
 * 2026-11-02, A4) -- see .env.example. The fallback is the local backend
 * (8081, because 8080 is taken by another local project on this machine).
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8081/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor: injects the JWT into every outgoing request.
 *
 * Source of truth: tenantSession.js (module-level state fed by AuthContext),
 * with localStorage as fallback after a page reload.
 *
 * The X-Tenant-Id header is no longer sent (audit 2026-11-02, M1): the
 * backend takes the active company ONLY from the signed JWT, so a header
 * the browser controls must never look like it matters.
 */
api.interceptors.request.use(
  (config) => {
    const { token: sessionToken } = getActiveSession();
    const token = sessionToken || localStorage.getItem('token');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Response interceptor: a 401 on a business endpoint means the session is
 * no longer valid (token expired, access to the company revoked, user or
 * company deactivated -- audit 2026-11-02, M2). App.jsx listens for
 * "auth:expired" and logs the user out. Login/companies calls (/auth/...)
 * are excluded: there a 401 just means wrong credentials.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';
    if (status === 401 && !url.includes('/auth/')) {
      window.dispatchEvent(
        new CustomEvent('auth:expired', { detail: { code: error?.response?.data?.message } })
      );
    }
    return Promise.reject(error);
  }
);

export default api;
