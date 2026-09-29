/**
 * Authentication context for RemitFlow React Native app
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
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

  const { data: user, error: meError, refetch } = trpc.auth.me.useQuery(undefined, {
    enabled: !!sessionId,
    retry: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation();
  // Keep a ref so `logout` can be a stable callback (useMemo'd provider
  // value) without depending on the mutation object's per-render identity.
  const logoutMutateRef = useRef(logoutMutation.mutateAsync);
  logoutMutateRef.current = logoutMutation.mutateAsync;

  const logout = useCallback(async () => {
    // Best-effort server logout; the local session is ALWAYS cleared
    // (fail closed locally) even if the server call fails or the token is
    // already invalid.
    try {
      await logoutMutateRef.current();
    } catch {
      // ignore — session is being destroyed locally regardless
    }
    await secureDelete(SESSION_ID_KEY);
    setSessionId(null);
  }, []);

  useEffect(() => {
    // CLI-005: session token lives in keystore-backed storage; legacy
    // plaintext AsyncStorage copies are migrated and purged by secureGet.
    secureGet(SESSION_ID_KEY).then((id) => {
      if (id) setSessionId(id);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    // wave14 perf (H5): a cached session id renders the app tentatively
    // while auth.me resolves, but a definitive 401 rejection from the
    // server fails CLOSED — force logout instead of retrying forever.
    // Transient network errors do NOT log the user out (offline tolerance);
    // the server still enforces auth on every request.
    const httpStatus = (meError as { data?: { httpStatus?: number; code?: string } } | null)?.data
      ?.httpStatus;
    const code = (meError as { data?: { code?: string } } | null)?.data?.code;
    if (meError && (httpStatus === 401 || code === 'UNAUTHORIZED')) {
      void logout();
    }
  }, [meError, logout]);

  const setSession = useCallback(
    async (id: string) => {
      await secureSet(SESSION_ID_KEY, id);
      setSessionId(id);
      await refetch();
    },
    [refetch],
  );

  // wave14 perf (L2): memoize the provider value so unrelated re-renders
  // don't cascade through every useAuth() consumer.
  const value = useMemo<AuthContextType>(
    () => ({
      user: user ?? null,
      isLoading,
      // wave14 perf (H5): possession of a cached session id counts as
      // TENTATIVELY authenticated — RootNavigator renders Main immediately
      // and auth.me populates `user` asynchronously. Enforcement remains
      // server-side; a 401 from auth.me forces logout above.
      isAuthenticated: !!sessionId,
      sessionId,
      setSession,
      logout,
    }),
    [user, isLoading, sessionId, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
