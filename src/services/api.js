import axios from 'axios';
import { getActiveSession } from './tenantSession';

/**
 * Configure the central Axios instance pointing to the Spring Boot backend API.
 */
const api = axios.create({
  baseURL: 'http://localhost:8080/api', // Adjust if your Spring Boot port differs
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request Interceptor to dynamically inject Security & Tenant context
 * into every outgoing HTTP request.
 *
 * Source of truth: tenantSession.js (module-level state fed by AuthContext).
 * We still fall back to localStorage for now because Login.jsx hasn't been
 * migrated to call AuthContext's login() yet — once it is, this fallback
 * can be removed.
 * TODO: remove the localStorage fallback once Login.jsx calls
 * AuthContext.login(...) instead of writing directly to localStorage.
 */
api.interceptors.request.use(
  (config) => {
    const { token: sessionToken, companyId: sessionCompanyId } = getActiveSession();

    const token = sessionToken || localStorage.getItem('token');
    const companyId = sessionCompanyId || localStorage.getItem('companyId');

    // If JWT token is present, inject the standard Authorization Bearer header
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // If companyId is present, inject the custom multi-tenant tracking header
    if (companyId) {
      config.headers['X-Tenant-Id'] = companyId;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
