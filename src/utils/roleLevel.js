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
