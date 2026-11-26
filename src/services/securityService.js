import api from './api';

// Error -> stable CODE in `code` (INVALID_CREDENTIALS, ACCOUNT_LOCKED,
// TOO_MANY_REQUESTS, NO_ACTIVE_COMPANIES, LOGIN_SESSION_EXPIRED...); Login.jsx
// translates it to the active language. No response = server unreachable.
function authError(error) {
  const code = error.response ? (error.response.data?.message || 'INVALID_CREDENTIALS') : 'NETWORK_ERROR';
  const err = new Error(code);
  err.code = code;
  return err;
}

/**
 * B1 (2026-11-25) -- login en dos pasos, paso 1: correo + contraseña.
 * Only after the password is verified does the backend list the user's
 * companies (name and NIT), together with a 5-minute pre-session token that
 * is only good for selectCompanyRequest() below. Replaces the old public
 * POST /auth/companies lookup (a company directory without password).
 * @returns {Promise<{preAuthToken:string, expiresIn:number, email:string, fullName:string,
 *   companies:Array<{id:number, legalName:string, tradeName:string|null, taxId:string|null}>}>}
 */
export async function loginRequest(email, password) {
  try {
    const response = await api.post('/auth/login', { email, password });
    return response.data?.data;
  } catch (error) {
    throw authError(error);
  }
}

/**
 * B1 (2026-11-25) -- paso 2: the company chosen in the list, with the
 * pre-session token of step 1 (sent explicitly: api.js keeps an Authorization
 * header that the call already brings). Returns the normal access session
 * payload ({ token, type, email, fullName, companyId, roles, expiresIn }).
 */
export async function selectCompanyRequest(preAuthToken, companyId) {
  try {
    const response = await api.post(
      '/auth/select-company',
      { companyId },
      { headers: { Authorization: `Bearer ${preAuthToken}` } }
    );
    return response.data?.data;
  } catch (error) {
    throw authError(error);
  }
}

/**
 * Retrieves the complete list of managed users within the active tenant context.
 * Note: Authentication token and Tenant ID are automatically injected via API Interceptor.
 * @returns {Promise<Object>} The user accounts array wrapped in the system response wrapper.
 */
export async function getUsers() {
  try {
    const response = await api.get('/security/users');
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data?.message || 'Access denied or failed to retrieve users';
    throw new Error(errorMessage);
  }
}

/**
 * Registers a new user account inside the target tenant boundaries.
 * @param {Object} payload - The user identity details structure.
 * @returns {Promise<Object>} The persistence execution confirmation payload.
 */
export async function createUser(payload) {
  try {
    const response = await api.post('/security/users', payload);
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data?.message || 'Error executing user account creation';
    throw new Error(errorMessage);
  }
}
