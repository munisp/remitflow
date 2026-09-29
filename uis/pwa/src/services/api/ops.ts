/**
 * Domain module: ops — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  AuditLog,
  CreateDisputeRequest,
  Dispute,
  DisputeMessage,
  LoginHistoryEntry,
  SecurityRecommendation,
  SecuritySettings,
} from "./types";

// Dispute Service
export const disputeService = {
  getAll: (params?: { status?: string; page?: number }) =>
    api.get<{ disputes: Dispute[]; total: number }>(
      `/disputes?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  getById: (id: string) => api.get<Dispute>(`/disputes/${id}`),

  create: (data: CreateDisputeRequest) => api.post<Dispute>("/disputes", data),

  addMessage: (id: string, message: string) =>
    api.post<DisputeMessage>(`/disputes/${id}/messages`, { message }),

  cancel: (id: string) => api.post<Dispute>(`/disputes/${id}/cancel`),
};

// Audit Log Service
export const auditLogService = {
  getAll: (params?: {
    page?: number;
    limit?: number;
    action?: string;
    startDate?: string;
    endDate?: string;
  }) =>
    api.get<{ logs: AuditLog[]; total: number }>(
      `/audit-logs?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  export: (
    format: "csv" | "json",
    params?: { startDate?: string; endDate?: string },
  ) =>
    api.get<Blob>(
      `/audit-logs/export?format=${format}&${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),
};

// Security Service
export const securityService = {
  getSettings: () => api.get<SecuritySettings>("/security/settings"),

  updateSettings: (data: Partial<SecuritySettings>) =>
    api.put<SecuritySettings>("/security/settings", data),

  enableTwoFactor: () =>
    api.post<{ qrCode: string; secret: string }>("/security/2fa/enable"),

  verifyTwoFactor: (code: string) =>
    api.post<{ verified: boolean }>("/security/2fa/verify", { code }),

  disableTwoFactor: (code: string) =>
    api.post<void>("/security/2fa/disable", { code }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>("/security/password/change", { currentPassword, newPassword }),

  changePin: (currentPin: string, newPin: string) =>
    api.post<void>("/security/pin/change", { currentPin, newPin }),

  getLoginHistory: () =>
    api.get<LoginHistoryEntry[]>("/security/login-history"),

  getSecurityScore: () =>
    api.get<{ score: number; recommendations: SecurityRecommendation[] }>(
      "/security/score",
    ),

  revokeDevice: (deviceId: string) =>
    api.delete<void>(`/security/devices/${deviceId}`),
};
