import api from './api';

/**
 * Sends an authentication request to the backend.
 * @param {string} username - The user identifier or email.
 * @param {string} password - The raw credentials.
 * @returns {Promise<Object>} The API response payload containing JWT and metadata.
 */
export async function loginRequest(username, password) {
  try {
    const testCompanyId = 4; // Mapped to 'Long companyId' in your Java record

    const response = await api.post('/auth/login', {
      email: username,      // Mapped to 'String email' (@Email in Java)
      password: password,   // Mapped to 'String password'
      companyId: testCompanyId
    });
    return response.data;
  } catch (error) {
    // Extracts backend error message or defaults to a generic failure message
    const errorMessage = error.response?.data?.message || 'Server error during authentication';
    throw new Error(errorMessage);
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