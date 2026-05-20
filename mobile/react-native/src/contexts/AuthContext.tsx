/**
 * Authentication context for RemitFlow React Native app
 */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trpc } from '../services/trpc';

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
    AsyncStorage.getItem('session_id').then((id) => {
      if (id) setSessionId(id);
      setIsLoading(false);
    });
  }, []);

  const setSession = async (id: string) => {
    await AsyncStorage.setItem('session_id', id);
    setSessionId(id);
    await refetch();
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    await AsyncStorage.removeItem('session_id');
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
