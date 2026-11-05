// logoutRequest.js — canal para pedir "cerrar sesión" desde cualquier
// pantalla (p. ej. el bloque de usuario de AppHeader) pasando por la MISMA
// protección que el botón del menú: Dashboard provee su handleLogout, que
// pregunta antes de salir si hay un comprobante sin guardar.
// Sin proveedor (fuera de Dashboard) el hook devuelve null y no se muestra
// el botón.
import { createContext, useContext } from "react";

export const LogoutRequestContext = createContext(null);

export function useLogoutRequest() {
  return useContext(LogoutRequestContext);
}
