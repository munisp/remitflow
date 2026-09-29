/**
 * Domain module: auth — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  RegisterData,
  User,
} from "./types";

// Auth API (deprecated - use authService.ts instead)
// Kept for backward compatibility with existing code
export const authApiLegacy = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: User }>("/auth/auth/login", {
      email,
      password,
    }),

  register: (data: RegisterData) =>
    api.post<{ token: string; user: User }>("/auth/auth/register", data),

  requestOtp: (email: string) =>
    api.post<{ message: string }>("/auth/auth/request-otp", { email }),

  verifyOtp: (email: string, otp: string) =>
    api.post<{ token: string; user: User }>("/auth/auth/verify-otp", {
      email,
      otp,
    }),

  logout: () => api.post<void>("/auth/auth/logout"),

  refreshToken: () => api.post<{ token: string }>("/auth/auth/refresh"),

  getProfile: () => api.get<User>("/user/user/profile"),
};
