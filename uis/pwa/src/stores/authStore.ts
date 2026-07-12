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
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  clearError: () => void;
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

      refreshAuth: async () => {
        const currentToken = get().token;
        if (!currentToken) {
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
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
