import api from './api';

/**
 * Sends an authentication request to the backend.
 * @param {string} username - The user identifier or email.
 * @param {string} password - The raw credentials.
 * @param {number|string} companyId - The company the user picked on the
 *   Login screen's dropdown (see getCompaniesForEmail below). FIXED
 *   (2026-10-28, Multiempresa Fase 2): this used to be a hardcoded
 *   testCompanyId=4 here, silently ignoring whichever account actually
 *   logged in -- now it's the real value chosen for THIS login attempt.
 * @returns {Promise<Object>} The API response payload containing JWT and metadata.
 */
export async function loginRequest(username, password, companyId) {
  try {
    const response = await api.post('/auth/login', {
      email: username,      // Mapped to 'String email' (@Email in Java)
      password: password,   // Mapped to 'String password'
      companyId: companyId  // Mapped to 'Long companyId' in the Java record
    });
    return response.data;
  } catch (error) {
    // Extracts backend error message or defaults to a generic failure message
    const errorMessage = error.response?.data?.message || 'Server error during authentication';
    throw new Error(errorMessage);
  }
}

/**
 * NEW (2026-10-28, Multiempresa Fase 2): looks up which companies a given
 * email can log into, to populate the Login screen's company dropdown.
 * Deliberately scoped to THAT email's own UserRole assignments -- the
 * backend never returns a global company list here, by design (a pilot
 * client's user should only ever see their own companies, nothing else).
 *
 * This runs before the password is verified (no session exists yet), so
 * it hits a public /api/auth endpoint rather than the authenticated
 * /api/v1/session/companies used later for the AppHeader switcher.
 *
 * Fails soft: any error (bad email format, network issue, unknown email)
 * just resolves to an empty list rather than throwing, since an empty
 * dropdown is a normal, recoverable UI state here -- not worth a blocking
 * error on every blur of the email field.
 * @param {string} email
 * @returns {Promise<Array<{id:number, legalName:string, tradeName:string|null, taxId:string}>>}
 */
export async function getCompaniesForEmail(email) {
  try {
    const response = await api.post('/auth/companies', { email });
    return Array.isArray(response.data?.data) ? response.data.data : [];
  } catch {
    // No binding needed -- this fails soft on purpose, see the doc comment above.
    return [];
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
