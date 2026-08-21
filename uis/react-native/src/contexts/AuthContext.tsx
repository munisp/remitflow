/**
 * Authentication context for RemitFlow React Native app
 */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { trpc } from '../services/trpc';
import { secureSet, secureGet, secureDelete } from '../services/secureStorage';

/** Keystore-backed key for the session token (CLI-005). */
const SESSION_ID_KEY = 'session_id';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  avatarUrl?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionId: string | null;
  setSession: (sessionId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  sessionId: null,
  setSession: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { data: user, refetch } = trpc.auth.me.useQuery(undefined, {
    enabled: !!sessionId,
    retry: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation();

  useEffect(() => {
    // CLI-005: session token lives in keystore-backed storage; legacy
    // plaintext AsyncStorage copies are migrated and purged by secureGet.
    secureGet(SESSION_ID_KEY).then((id) => {
      if (id) setSessionId(id);
      setIsLoading(false);
    });
  }, []);

  const setSession = async (id: string) => {
    await secureSet(SESSION_ID_KEY, id);
    setSessionId(id);
    await refetch();
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    await secureDelete(SESSION_ID_KEY);
    setSessionId(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        isAuthenticated: !!user,
        sessionId,
        setSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
