/**
 * Domain module: engagement — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  CreateSavingsGoalRequest,
  Notification,
  NotificationPreferences,
  Referral,
  ReferralReward,
  SavingsContribution,
  SavingsGoal,
  SavingsWithdrawal,
} from "./types";

// Referral Service
export const referralService = {
  getReferralCode: () =>
    api.get<{ code: string; link: string }>("/referrals/code"),

  getReferrals: () => api.get<Referral[]>("/referrals"),

  getRewards: () => api.get<ReferralReward[]>("/referrals/rewards"),

  claimReward: (rewardId: string) =>
    api.post<ReferralReward>(`/referrals/rewards/${rewardId}/claim`),
};

// Savings Service
export const savingsService = {
  createGoal: (data: CreateSavingsGoalRequest) =>
    api.post<SavingsGoal>("/savings/api/v1/savings", data),

  getGoals: () =>
    api.get<SavingsGoal[] | { goals: SavingsGoal[] }>(
      "/savings/api/v1/savings",
    ),

  getGoal: (id: string) => api.get<SavingsGoal>(`/savings/goals/${id}`),

  contribute: (goalId: string, amount: number) =>
    api.post<SavingsContribution>(`/savings/goals/${goalId}/contribute`, {
      amount,
    }),

  withdraw: (goalId: string, amount: number) =>
    api.post<SavingsWithdrawal>(`/savings/goals/${goalId}/withdraw`, {
      amount,
    }),
};

// Notification Service
export const notificationService = {
  getAll: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get<{ notifications: Notification[]; total: number; unread: number }>(
      `/notifications?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  markRead: (id: string) => api.put<Notification>(`/notifications/${id}/read`),

  markAllRead: () => api.put<{ updated: number }>("/notifications/read-all"),

  getPreferences: () =>
    api.get<NotificationPreferences>("/notifications/preferences"),

  updatePreferences: (data: Partial<NotificationPreferences>) =>
    api.put<NotificationPreferences>("/notifications/preferences", data),

  delete: (id: string) => api.delete<void>(`/notifications/${id}`),
};
