import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { checkLogin as apiCheckLogin } from "./api";

type AuthContextValue = {
  loading: boolean;
  authenticated: boolean;
  userEmail: string | null;
  isAdmin: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: () => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiCheckLogin();
      setAuthenticated(Boolean(res?.authenticated));
      setUserEmail(res?.user?.email ?? null);
      setIsAdmin(Boolean(res?.isAdmin));
    } catch (e: any) {
      setAuthenticated(false);
      setUserEmail(null);
      setError(e?.message || "Login check failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(() => {
    window.location.href = "/login";
  }, []);

  const logout = useCallback(() => {
    window.location.href = "/logout";
  }, []);

  const value = useMemo(
    () => ({
      loading,
      authenticated,
      userEmail,
      isAdmin,
      error,
      refresh,
      login,
      logout,
    }),
    [loading, authenticated, userEmail, isAdmin, error, refresh, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
