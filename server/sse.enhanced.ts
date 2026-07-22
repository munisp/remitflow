/**
 * RemitFlow — Enhanced SSE Event Service
 * ══════════════════════════════════════════════════════════════════════════════
 * Extends the base sse.service with additional event types for:
 *
 *   - Transfer lifecycle events (initiated, processing, completed, failed, reversed)
 *   - Real-time FX rate alerts (threshold crossed, rate updated)
 *   - Fraud/AML alerts (suspicious activity, account freeze)
 *   - KYC pipeline events (document uploaded, OCR complete, decision)
 *   - Social ledger events (ROSCA pot ready, referral reward, pool goal reached)
 *   - System health events (middleware degraded, SLO burn rate alert)
 *
 * This module augments the base SSE service and exports higher-level helpers
 * that the routers and pipeline can call without knowing the underlying
 * transport details.
 */

import { broadcastUserEvent, broadcastAdminEvent } from "./sse.service";

// ── Transfer Events ───────────────────────────────────────────────────────────

export interface TransferEvent {
  transferId: string;
  amount: number;
  sendCurrency: string;
  receiveCurrency: string;
  recipientName: string;
  status: "initiated" | "processing" | "completed" | "failed" | "reversed" | "refunded";
  provider?: string;
  estimatedDeliveryMinutes?: number;
  failureReason?: string;
  completedAt?: string;
}

export function notifyTransferUpdate(userId: number, event: TransferEvent): void {
  const type = event.status === "completed"
    ? "transfer_sent"
    : event.status === "failed"
    ? "transfer_failed"
    : event.status === "initiated"
    ? "transfer_pending"
    : "transfer_update";

  broadcastUserEvent(userId, {
    type,
    payload: {
      transferId: event.transferId,
      amount: event.amount,
      sendCurrency: event.sendCurrency,
      receiveCurrency: event.receiveCurrency,
      recipientName: event.recipientName,
      status: event.status,
      provider: event.provider,
      estimatedDeliveryMinutes: event.estimatedDeliveryMinutes,
      failureReason: event.failureReason,
      completedAt: event.completedAt,
    },
  });

  // Also broadcast to admin dashboard
  broadcastAdminEvent({
    type: "transfer_update",
    payload: {
      userId,
      ...event,
    },
  });
}

// ── FX Rate Alert Events ──────────────────────────────────────────────────────

export interface FxAlertEvent {
  alertId: string;
  corridor: string;
  targetRate: number;
  currentRate: number;
  direction: "above" | "below";
  triggeredAt: string;
}

export function notifyFxAlert(userId: number, alert: FxAlertEvent): void {
  broadcastUserEvent(userId, {
    type: "rate_alert_hit",
    payload: {
      alertId: alert.alertId,
      corridor: alert.corridor,
      targetRate: alert.targetRate,
      currentRate: alert.currentRate,
      direction: alert.direction,
      triggeredAt: alert.triggeredAt,
      message: `Your FX alert for ${alert.corridor} has been triggered. Rate is now ${alert.currentRate} (target: ${alert.targetRate}).`,
    },
  });
}

// ── Fraud & AML Alert Events ──────────────────────────────────────────────────

export interface FraudAlertEvent {
  alertId: string;
  severity: "low" | "medium" | "high" | "critical";
  alertType: "velocity_breach" | "geo_anomaly" | "device_change" | "aml_flag" | "account_freeze";
  description: string;
  transferId?: string;
  requiresAction: boolean;
}

export function notifyFraudAlert(userId: number, alert: FraudAlertEvent): void {
  // Notify the user
  broadcastUserEvent(userId, {
    type: "login_new_device", // closest existing type for security events
    payload: {
      alertId: alert.alertId,
      severity: alert.severity,
      alertType: alert.alertType,
      description: alert.description,
      transferId: alert.transferId,
      requiresAction: alert.requiresAction,
    },
  });

  // Notify compliance team via admin SSE
  broadcastAdminEvent({
    type: "fraud_alert",
    payload: {
      userId,
      ...alert,
    },
  });
}

// ── KYC Pipeline Events ───────────────────────────────────────────────────────

export interface KycPipelineEvent {
  kycId: string;
  stage: "document_received" | "ocr_complete" | "liveness_passed" | "liveness_failed" | "decision_approved" | "decision_rejected" | "tier_upgraded";
  tier?: string;
  message?: string;
}

export function notifyKycUpdate(userId: number, event: KycPipelineEvent): void {
  const type = event.stage === "decision_approved" || event.stage === "tier_upgraded"
    ? "kyc_approved"
    : event.stage === "decision_rejected"
    ? "kyc_rejected"
    : "kyc_pending";

  broadcastUserEvent(userId, {
    type,
    payload: {
      kycId: event.kycId,
      stage: event.stage,
      tier: event.tier,
      message: event.message ?? `KYC update: ${event.stage}`,
    },
  });
}

// ── Social Ledger Events ──────────────────────────────────────────────────────

export interface SocialLedgerEvent {
  eventType: "rosca_pot_ready" | "referral_reward" | "pool_goal_reached" | "contribution_received";
  amount?: number;
  currency?: string;
  groupId?: string;
  poolId?: string;
  message: string;
}

export function notifySocialEvent(userId: number, event: SocialLedgerEvent): void {
  broadcastUserEvent(userId, {
    type: "referral_bonus", // reuse for all social events
    payload: {
      eventType: event.eventType,
      amount: event.amount,
      currency: event.currency,
      groupId: event.groupId,
      poolId: event.poolId,
      message: event.message,
    },
  });
}

// ── System Health Events (Admin Only) ─────────────────────────────────────────

export interface SystemHealthEvent {
  component: string;
  status: "degraded" | "recovered" | "slo_breach" | "slo_warning";
  message: string;
  burnRate?: number;
  sloName?: string;
}

export function notifySystemHealth(event: SystemHealthEvent): void {
  broadcastAdminEvent({
    type: "system_health",
    payload: { ...event },
  });
}

// ── Batch Broadcast Utility ───────────────────────────────────────────────────

/**
 * Broadcast a transfer update to multiple users simultaneously.
 * Used for group transfers or split payments.
 */
export function notifyTransferUpdateBatch(
  userIds: number[],
  event: TransferEvent
): void {
  for (const userId of userIds) {
    notifyTransferUpdate(userId, event);
  }
}
