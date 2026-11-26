// src/utils/lastCompany.js
//
// B1 (2026-11-25): la pantalla de ingreso resalta, en el paso 2, la última
// empresa usada por ese correo EN ESTE EQUIPO (un Enter y entra). Se guarda
// al entrar y al cambiar de empresa desde la barra global. Solo el id de la
// empresa por correo; nada que no esté ya en la sesión del navegador.
const KEY = "zoru.lastCompanyByEmail";

function readMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const normalize = (email) => String(email || "").trim().toLowerCase();

export function getLastCompanyId(email) {
  const key = normalize(email);
  if (!key) return null;
  const value = readMap()[key];
  return value != null ? String(value) : null;
}

export function rememberLastCompany(email, companyId) {
  const key = normalize(email);
  if (!key || companyId == null || companyId === "") return;
  try {
    const map = readMap();
    map[key] = String(companyId);
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Sin almacenamiento disponible: simplemente no se recuerda.
  }
}
