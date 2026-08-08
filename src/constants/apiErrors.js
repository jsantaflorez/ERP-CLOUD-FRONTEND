// src/constants/apiErrors.js
//
// Maps stable backend error codes (e.g. "DUPLICATE_VALUE") to human
// language messages, per active UI language — the same pattern already
// used for TAX_REGIME_LABELS. The backend should return one of these
// CODES in its `message` field (see
// ChartOfAccountsService#extractConstraintMessage), never prose in a
// specific language, so the frontend controls translation the same way
// it does for every other piece of UI text.

export const API_ERROR_LABELS = {
  es: {
    DUPLICATE_VALUE: "Ya existe un registro con este valor. Verifica el código o identificador.",
    FK_CONSTRAINT: "No se puede realizar esta acción porque el registro está relacionado con otros datos.",
    REQUIRED_FIELD_MISSING: "Falta un campo obligatorio.",
    DATA_INTEGRITY_VIOLATION: "No se pudo procesar la solicitud por una inconsistencia en los datos.",
    // NEW: codes from InvalidOperationException (business-rule rejections,
    // not DB constraint violations). Shared across modules where the
    // underlying rule is conceptually the same (e.g. a parent node can't
    // accept direct postings/movements, whether it's a cost center or a
    // chart-of-accounts account).
    PARENT_ALLOWS_MOVEMENT: "No se puede agregar un centro hijo: el centro padre permite movimiento.",
    HAS_CHILDREN_CANNOT_POST: "Este registro tiene subcuentas o centros hijos y no puede permitir movimientos/asientos directos.",
    PARENT_IS_POSTING_ACCOUNT: "El registro padre es una cuenta/centro de movimiento y no puede tener hijos.",
    CATEGORY_CLASS_MISMATCH: "La categoría seleccionada no corresponde a la clase de cuenta elegida.",
    CODE_IMMUTABLE: "El código no se puede modificar una vez creado el registro.",
    SELF_PARENT_NOT_ALLOWED: "Un registro no puede ser su propio padre.",
    CIRCULAR_REFERENCE: "Referencia circular detectada: no se puede mover el registro bajo uno de sus propios descendientes.",
    ACCOUNT_NOT_POSTING_ACCOUNT: "La cuenta contable seleccionada no es una cuenta de movimiento.",
    ACCOUNT_INACTIVE: "La cuenta contable seleccionada está inactiva.",
    CONSECUTIVE_CANNOT_DECREASE: "No se puede asignar un consecutivo menor al actual.",
  },
  en: {
    DUPLICATE_VALUE: "A record with this value already exists. Check the code or identifier.",
    FK_CONSTRAINT: "This action can't be completed because the record is linked to other data.",
    REQUIRED_FIELD_MISSING: "A required field is missing.",
    DATA_INTEGRITY_VIOLATION: "The request couldn't be processed due to a data inconsistency.",
    PARENT_ALLOWS_MOVEMENT: "Can't add a sub-center: the parent center allows movement.",
    HAS_CHILDREN_CANNOT_POST: "This record has sub-accounts or child centers and can't allow direct postings/movements.",
    PARENT_IS_POSTING_ACCOUNT: "The parent record is a posting account/center and can't have children.",
    CATEGORY_CLASS_MISMATCH: "The selected category doesn't belong to the chosen account class.",
    CODE_IMMUTABLE: "The code can't be changed once the record is created.",
    SELF_PARENT_NOT_ALLOWED: "A record can't be its own parent.",
    CIRCULAR_REFERENCE: "Circular reference detected — can't move the record under one of its own descendants.",
    ACCOUNT_NOT_POSTING_ACCOUNT: "The selected account is not a posting account.",
    ACCOUNT_INACTIVE: "The selected account is inactive.",
    CONSECUTIVE_CANNOT_DECREASE: "Can't assign a consecutive number lower than the current one.",
  },
};

/**
 * Resolves a user-facing error message for a failed Axios request.
 *
 * Priority:
 *  1. If the backend's `message` field matches a known error CODE
 *     (e.g. "DUPLICATE_VALUE"), return the translated label for the
 *     active language.
 *  2. Otherwise, fall back to whatever raw message the backend sent
 *     (covers validation errors, custom messages, etc. that aren't part
 *     of this fixed code list).
 *  3. If there's no response at all (network error, server down),
 *     fall back to the caller-provided generic message (typically
 *     t.errorConn).
 *
 * @param {*} error - The error caught from an Axios call.
 * @param {"es"|"en"} language - Active UI language.
 * @param {string} fallback - Generic fallback (e.g. t.errorConn).
 */
export function getApiErrorMessage(error, language, fallback) {
  const backendMessage = error?.response?.data?.message;
  const lang = API_ERROR_LABELS[language] ? language : "es";

  if (backendMessage && API_ERROR_LABELS[lang][backendMessage]) {
    return API_ERROR_LABELS[lang][backendMessage];
  }

  return backendMessage || fallback;
}
