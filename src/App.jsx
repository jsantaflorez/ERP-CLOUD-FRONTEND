import { useEffect, useState } from "react";
import Login from "./components/Login";
import Dashboard from "./components/pages/Dashboard";
import { AuthProvider, useAuth } from "./context/AuthContext";

function App() {
  // App only mounts the provider. It cannot call useAuth() itself —
  // context is only available to components rendered INSIDE AuthProvider,
  // not to the component that declares <AuthProvider> in its own return.
  // All the logic that needs useAuth() (like logout) lives in AppShell.
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { logout: authLogout } = useAuth();
  const [user, setUser] = useState(null);
  const [language, setLanguage] = useState("es");

  useEffect(() => {
    // Restore session data from browser storage on application boot
    const savedUser = localStorage.getItem("erp_user");
    const savedLanguage = localStorage.getItem("erp_language");

    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }

    if (savedLanguage === "es" || savedLanguage === "en") {
      setLanguage(savedLanguage);
    }
  }, []);

  /**
   * Finalizes the state mutation upon successful backend authentication.
   * Note: token/companyId are now handled by AuthContext's login() call,
   * which Login.jsx triggers directly — this only tracks the UI-facing
   * "who is logged in" state, separate from the tenant/auth session.
   * @param {Object} userData - The authenticated user identity metadata.
   */
  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem("erp_user", JSON.stringify(userData));
  };

  /**
   * Flushes all state properties and tears down tenant/auth session data.
   * Delegates token/companyId cleanup to AuthContext's logout() so
   * tenantSession (in-memory) and localStorage stay in sync — previously
   * this cleared localStorage directly and left tenantSession stale.
   */
  const handleLogout = () => {
    authLogout();

    setUser(null);
    setLanguage("es");

    localStorage.removeItem("erp_user");
    localStorage.removeItem("erp_language");
  };

  /**
   * Updates and synchronizes global localization flags.
   * @param {string} lang - The new language iso code ('es' | 'en').
   */
  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    localStorage.setItem("erp_language", lang);
  };

  return user ? (
    <Dashboard
      user={user}
      onLogout={handleLogout}
      language={language}
      onLanguageChange={handleLanguageChange}
    />
  ) : (
    <Login
      onLogin={handleLogin}
      language={language}
      onLanguageChange={handleLanguageChange}
    />
  );
}

export default App;
