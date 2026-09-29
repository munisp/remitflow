/**
 * Domain module: settings — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
  getCurrentUserDetails,
} from "./core";
import type {
  CreateSupportTicketRequest,
  FAQ,
  LinkAccountRequest,
  LinkedAccount,
  SecuritySettings,
  SupportMessage,
  SupportTicket,
  UserPreferences,
  UserProfile,
} from "./types";

// Settings Service
export const settingsService = {
  getPreferences: async () => {
    const userRes = await getCurrentUserDetails();
    const user = userRes.data;

    const mapped: UserPreferences = {
      language: "en",
      currency: "NGN",
      theme: "light",
      biometricAuth: false,
      twoFactorAuth: false,
      transactionNotifications: user.status === "active",
      marketingEmails: false,
      autoLogoutMinutes: 15,
    };

    return {
      ...userRes,
      data: mapped,
    };
  },

  updatePreferences: (data: Partial<UserPreferences>) =>
    api.put<UserPreferences>("/settings/preferences", data),

  getSecuritySettings: () => api.get<SecuritySettings>("/settings/security"),

  updateSecuritySettings: (data: Partial<SecuritySettings>) =>
    api.put<SecuritySettings>("/settings/security", data),
};

// Support Service
export const supportService = {
  createTicket: (data: CreateSupportTicketRequest) =>
    api.post<SupportTicket>("/support/tickets", data),

  getTickets: () => api.get<SupportTicket[]>("/support/tickets"),

  getTicket: (id: string) => api.get<SupportTicket>(`/support/tickets/${id}`),

  addMessage: (ticketId: string, message: string) =>
    api.post<SupportMessage>(`/support/tickets/${ticketId}/messages`, {
      message,
    }),

  getFaqs: () => api.get<FAQ[]>("/support/faqs"),
};

// Profile Service
export const profileService = {
  getProfile: async () => {
    const userRes = await getCurrentUserDetails();
    const user = userRes.data;

    const mapped: UserProfile = {
      id: user.id,
      email: user.email,
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      phone: user.phone_number || "",
      kycTier:
        user.kyc_verification_status?.toLowerCase() === "verified" ? 2 : 1,
      createdAt: user.created_at || new Date().toISOString(),
    };

    return {
      ...userRes,
      data: mapped,
    };
  },

  updateProfile: (data: Partial<UserProfile>) =>
    api.put<UserProfile>("/profile", data),

  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append("avatar", file);
    return api.post<{ avatarUrl: string }>("/profile/avatar", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>("/profile/change-password", {
      currentPassword,
      newPassword,
    }),

  getLinkedAccounts: () => api.get<LinkedAccount[]>("/profile/linked-accounts"),

  linkAccount: (data: LinkAccountRequest) =>
    api.post<LinkedAccount>("/profile/linked-accounts", data),

  unlinkAccount: (id: string) =>
    api.delete<void>(`/profile/linked-accounts/${id}`),
};
