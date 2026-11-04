// src/utils/roleLevel.js
//
// Maps the backend role codes of the ACTIVE company (AuthResponse.roles,
// e.g. ["COMPANY_ADMIN","ACCOUNTANT"]) to the single "level" string that
// Dashboard.jsx uses to show or hide menu sections.
//
// Must stay in line with the backend rule app.security.admin-roles
// (default SYS_ADMIN,COMPANY_ADMIN): those users can close periods, manage
// users, import and annul. Hiding menus here is only convenience -- the
// backend enforces the same rule with @PreAuthorize.
export const ADMIN_ROLE_CODES = ["SYS_ADMIN", "COMPANY_ADMIN"];
export const OPERATIONAL_ROLE_CODES = ["ACCOUNTANT"];

export function levelFromRoles(roles) {
  const list = Array.isArray(roles) ? roles : [];
  if (list.some((r) => ADMIN_ROLE_CODES.includes(r))) return "Administrator";
  if (list.some((r) => OPERATIONAL_ROLE_CODES.includes(r))) return "Accountant";
  return "USER";
}

// Human labels for the role codes in roles.code (2026-11-04, header session
// block). Unknown codes (custom roles a company may create) fall back to a
// readable version of the code itself.
const ROLE_LABELS = {
  es: { SYS_ADMIN: "Administrador del sistema", COMPANY_ADMIN: "Administrador", ACCOUNTANT: "Contador" },
  en: { SYS_ADMIN: "System administrator", COMPANY_ADMIN: "Administrator", ACCOUNTANT: "Accountant" },
};

// Highest role first: the header shows one role, the tooltip lists all.
const ROLE_PRIORITY = ["SYS_ADMIN", "COMPANY_ADMIN", "ACCOUNTANT"];

export function sortRoles(roles) {
  const list = Array.isArray(roles) ? [...new Set(roles)] : [];
  const rank = (r) => (ROLE_PRIORITY.includes(r) ? ROLE_PRIORITY.indexOf(r) : ROLE_PRIORITY.length);
  return list.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function roleLabel(code, language = "es") {
  if (!code) return "";
  const labels = ROLE_LABELS[language] || ROLE_LABELS.es;
  if (labels[code]) return labels[code];
  const words = code.toLowerCase().split("_").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
