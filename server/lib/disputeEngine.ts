/**
 * Dispute Engine — P2 Business 9.8
 * End-to-end dispute management with SLA tracking and auto-escalation.
 */

type DisputeStatus = "open" | "under_review" | "awaiting_info" | "escalated" | "resolved" | "closed" | "rejected";
type DisputeType = "unauthorized" | "not_received" | "wrong_amount" | "duplicate" | "fraud" | "service_issue" | "other";
type Resolution = "refunded" | "partially_refunded" | "denied" | "credited" | "reversed";

interface Dispute {
  id: string;
  transactionId: string;
  userId: number;
  type: DisputeType;
  status: DisputeStatus;
  amount: number;
  currency: string;
  description: string;
  evidence: string[];
  resolution?: Resolution;
  resolutionAmount?: number;
  resolutionNote?: string;
  assignedTo?: string;
  slaDeadline: number;
  createdAt: number;
  updatedAt: number;
  escalatedAt?: number;
  resolvedAt?: number;
  timeline: Array<{ action: string; by: string; timestamp: number; note?: string }>;
}

const disputes = new Map<string, Dispute>();

const SLA_HOURS: Record<DisputeType, number> = {
  unauthorized: 24,
  fraud: 24,
  not_received: 72,
  wrong_amount: 72,
  duplicate: 48,
  service_issue: 120,
  other: 120,
};

export function createDispute(params: {
  transactionId: string;
  userId: number;
  type: DisputeType;
  amount: number;
  currency: string;
  description: string;
}): Dispute {
  const id = `DSP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const now = Date.now();
  const slaHours = SLA_HOURS[params.type];

  const dispute: Dispute = {
    id,
    ...params,
    status: "open",
    evidence: [],
    slaDeadline: now + slaHours * 3600_000,
    createdAt: now,
    updatedAt: now,
    timeline: [{ action: "created", by: `user:${params.userId}`, timestamp: now }],
  };

  disputes.set(id, dispute);
  return dispute;
}

export function updateDisputeStatus(
  disputeId: string,
  status: DisputeStatus,
  updatedBy: string,
  note?: string
): Dispute | null {
  const dispute = disputes.get(disputeId);
  if (!dispute) return null;

  dispute.status = status;
  dispute.updatedAt = Date.now();
  dispute.timeline.push({ action: `status_changed:${status}`, by: updatedBy, timestamp: Date.now(), note });

  if (status === "escalated") dispute.escalatedAt = Date.now();
  if (status === "resolved" || status === "closed") dispute.resolvedAt = Date.now();

  return dispute;
}

export function resolveDispute(
  disputeId: string,
  resolution: Resolution,
  resolvedBy: string,
  amount?: number,
  note?: string
): Dispute | null {
  const dispute = disputes.get(disputeId);
  if (!dispute) return null;

  dispute.status = "resolved";
  dispute.resolution = resolution;
  dispute.resolutionAmount = amount;
  dispute.resolutionNote = note;
  dispute.resolvedAt = Date.now();
  dispute.updatedAt = Date.now();
  dispute.timeline.push({
    action: `resolved:${resolution}`,
    by: resolvedBy,
    timestamp: Date.now(),
    note: note ?? `${resolution}${amount ? ` ${dispute.currency} ${amount}` : ""}`,
  });

  return dispute;
}

export function addEvidence(disputeId: string, evidenceUrl: string, addedBy: string): boolean {
  const dispute = disputes.get(disputeId);
  if (!dispute) return false;

  dispute.evidence.push(evidenceUrl);
  dispute.updatedAt = Date.now();
  dispute.timeline.push({ action: "evidence_added", by: addedBy, timestamp: Date.now() });

  return true;
}

export function getDispute(disputeId: string): Dispute | undefined {
  return disputes.get(disputeId);
}

export function getUserDisputes(userId: number): Dispute[] {
  const results: Dispute[] = [];
  disputes.forEach((d) => {
    if (d.userId === userId) results.push(d);
  });
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export function getDisputeStats(): {
  total: number;
  open: number;
  resolved: number;
  slaBreaches: number;
  avgResolutionHours: number;
} {
  let total = 0, open = 0, resolved = 0, slaBreaches = 0;
  const resolutionTimes: number[] = [];

  disputes.forEach((d) => {
    total++;
    if (d.status === "open" || d.status === "under_review" || d.status === "awaiting_info") open++;
    if (d.status === "resolved" || d.status === "closed") {
      resolved++;
      if (d.resolvedAt) resolutionTimes.push(d.resolvedAt - d.createdAt);
    }
    if (Date.now() > d.slaDeadline && d.status !== "resolved" && d.status !== "closed") slaBreaches++;
  });

  const avg = resolutionTimes.length > 0
    ? resolutionTimes.reduce((s, t) => s + t, 0) / resolutionTimes.length / 3600_000
    : 0;

  return {
    total,
    open,
    resolved,
    slaBreaches,
    avgResolutionHours: Math.round(avg * 10) / 10,
  };
}

export function getSLABreaches(): Dispute[] {
  const now = Date.now();
  const results: Dispute[] = [];
  disputes.forEach((d) => {
    if (now > d.slaDeadline && d.status !== "resolved" && d.status !== "closed") {
      results.push(d);
    }
  });
  return results.sort((a, b) => a.slaDeadline - b.slaDeadline);
}
