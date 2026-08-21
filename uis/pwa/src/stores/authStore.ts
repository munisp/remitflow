import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setAuthToken } from "../services/api";
import { authService } from "../services/authService";
import { onboardingService } from "../services/onboardingService";

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  keycloak_id?: string;
  keycloakId?: string;
  kycStatus?: "pending" | "verified" | "rejected";
  isVerified?: boolean;
  kycUrl?: string;
  status?: string;
  createdAt?: string;
  tenant_id?: string;
  role?: "admin" | "user" | "partner";
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  completeSsoLogin: () => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  setError: (message: string) => void;
  refreshAuth: () => Promise<void>;
  fetchUserDetails: () => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  uin?: string;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authService.login({ email, password });

          // Update API client with new token
          setAuthToken(response.access_token);

          // Get user from authService (stored during login)
          let user = authService.getUser();

          // Fetch detailed user profile from user service
          try {
            const detailedUser = await authService.fetchUserDetails();
            if (detailedUser) {
              user = detailedUser;
              console.log("✓ User details fetched after login:", detailedUser);
            }
          } catch (userError) {
            console.warn(
              "Failed to fetch detailed user profile, using basic info:",
              userError,
            );
            // Continue with basic user info from login response
          }

          set({
            user,
            token: response.access_token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Login failed",
            isLoading: false,
            isAuthenticated: false,
          });
          throw error;
        }
      },

      completeSsoLogin: async () => {
        set({ isLoading: true, error: null });
        try {
          const user = await authService.completeKeycloakLogin();
          // SSO sessions are cookie-based on the platform server; there is
          // no bearer token to store. Authenticated state reflects the
          // verified server session returned by auth.me.
          set({ user, token: null, isAuthenticated: true, isLoading: false });
        } catch (error) {
          set({
            error:
              error instanceof Error
                ? error.message
                : "SSO sign-in failed. Please try again.",
            isLoading: false,
            isAuthenticated: false,
          });
          throw error;
        }
      },

      register: async (data: RegisterData) => {
        set({ isLoading: true, error: null });
        try {
          onboardingService.saveOnboardingData({
            email: data.email,
            password: data.password,
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phone,
            ...(data.uin ? { uin: data.uin } : {}),
          });

          set({ isLoading: false, error: null });
        } catch (error) {
          set({
            error:
              error instanceof Error ? error.message : "Registration failed",
            isLoading: false,
          });
          throw error;
        }
      },

      logout: () => {
        authService.logout();
        setAuthToken(null);
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
        });
      },

      clearError: () => {
        set({ error: null });
      },

      setError: (message: string) => {
        set({ error: message });
      },

      refreshAuth: async () => {
        const currentToken = get().token;
        if (!currentToken) {
          // The access token is held in memory only (CLI-002), so it is
          // gone after a page reload. If a credential-flow refresh token
          // survived in sessionStorage, mint a fresh access token first.
          try {
            const refreshed = await authService.refreshToken();
            if (refreshed?.access_token) {
              setAuthToken(refreshed.access_token);
              set({
                token: refreshed.access_token,
                isAuthenticated: true,
              });
              return;
            }
          } catch {
            // Fall through to the cookie-based SSO session check below.
          }

          // Cookie-based SSO session (no bearer token): extend the session
          // via the platform server's httpOnly refresh endpoint, then
          // re-verify. A definitively invalid session logs the user out; an
          // indeterminate result (network error) keeps the current state.
          if (get().isAuthenticated) {
            await authService.refreshSsoSession().catch(() => false);
            try {
              const ssoUser = await authService.fetchSsoSessionUser();
              if (ssoUser) {
                set({ user: ssoUser, isAuthenticated: true });
              } else {
                get().logout();
              }
            } catch {
              // Server unreachable — keep current state; protected API
              // calls will surface real errors to the user.
            }
            return;
          }
          set({ isAuthenticated: false });
          return;
        }

        // Check if token is expired
        if (authService.isTokenExpired()) {
          try {
            const response = await authService.refreshToken();
            if (response) {
              setAuthToken(response.access_token);
              set({
                token: response.access_token,
                isAuthenticated: true,
              });
            } else {
              // Refresh failed
              get().logout();
            }
          } catch (error) {
            console.error("Token refresh failed:", error);
            get().logout();
          }
        }
      },

      fetchUserDetails: async () => {
        try {
          const user = await authService.fetchUserDetails();
          if (user) {
            set({ user });
          }
        } catch (error) {
          console.error("Failed to fetch user details:", error);
        }
      },
    }),
    {
      name: "auth-storage",
      // SECURITY (CLI-002): never persist the access token — it lives in
      // memory only. Only non-secret session metadata is persisted.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
