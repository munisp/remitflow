/**
 * wave17 C1 (SPEC-wave17, rn-invest) — Property escrow RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/Escrow.tsx, backed by the mounted
 * `propertyEscrow` router (server/routers/propertyEscrow.ts). User-role
 * procedures wired:
 *   - escrowPlan.listMyPlans / get         — my escrows (buyer or builder role)
 *   - escrowPlan.payDeposit / payInstallment — wallet-debiting, tier-gated,
 *     TOTP step-up guarded (requireTotpStepUp, fail-closed — surfaced here)
 *   - milestone.getTimeline                — milestone status view incl. evidence
 *   - milestone.submitEvidence             — builder-role evidence upload
 *   - dispute.raise / requestFullRefund    — buyer-role dispute + refund request
 *
 * Fund release / evidence approval are ADMIN-ONLY server procedures
 * (milestone.approveMilestone, milestone.reviewEvidence, dispute.resolve,
 * builderKyb.adminVerify) — they deliberately do NOT appear in this UI. The
 * milestone view states who performs releases instead of showing dead buttons.
 * Proc names grep-verified against audit/routers.json (mounted, non-legacy).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { trpc } from '../../services/trpc';
import {
  Badge,
  ChipSelector,
  ErrorBanner,
  InvestHeader,
  LabeledInput,
  StatusBadge,
  SuccessNote,
  TotpField,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtPct,
  investErrMsg,
  styles,
} from './common';

type Role = 'buyer' | 'builder';
type EscrowDisputeType =
  | 'deadline_missed' | 'quality_issues' | 'builder_default' | 'scope_change'
  | 'fraud' | 'communication_failure' | 'force_majeure' | 'other';
type EscrowEvidenceType =
  | 'photo' | 'video' | 'document' | 'engineer_report'
  | 'surveyor_report' | 'inspection_report' | 'receipt' | 'certificate';
type Severity = 'low' | 'medium' | 'high' | 'critical';

const DISPUTE_TYPES: Array<{ value: EscrowDisputeType; label: string }> = [
  { value: 'deadline_missed', label: 'Deadline missed' },
  { value: 'quality_issues', label: 'Quality issues' },
  { value: 'builder_default', label: 'Builder default' },
  { value: 'scope_change', label: 'Scope change' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'communication_failure', label: 'Communication failure' },
  { value: 'force_majeure', label: 'Force majeure' },
  { value: 'other', label: 'Other' },
];

const EVIDENCE_TYPES: Array<{ value: EscrowEvidenceType; label: string }> = [
  { value: 'photo', label: 'Photo' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'Document' },
  { value: 'engineer_report', label: 'Engineer report' },
  { value: 'surveyor_report', label: 'Surveyor report' },
  { value: 'inspection_report', label: 'Inspection report' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'certificate', label: 'Certificate' },
];

const SEVERITIES: Array<{ value: Severity; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// ── Plan detail (mounted only when a plan is opened) ─────────────────────────

function PlanDetail({ planId, role, onClose, onChanged }: { planId: string; role: Role; onClose: () => void; onChanged: () => void }) {
  const detailQ = trpc.propertyEscrow.escrowPlan.get.useQuery({ planId });
  const timelineQ = trpc.propertyEscrow.milestone.getTimeline.useQuery({ planId });

  const detail = detailQ.data;
  const timeline = timelineQ.data;
  const plan = detail?.plan ?? null;

  // Payments (TOTP step-up)
  const [totpCode, setTotpCode] = useState('');
  const [payErr, setPayErr] = useState<string | null>(null);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  // Dispute
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [dType, setDType] = useState<EscrowDisputeType>('other');
  const [dSeverity, setDSeverity] = useState<Severity>('medium');
  const [dDescription, setDDescription] = useState('');
  const [dErr, setDErr] = useState<string | null>(null);
  const [dMsg, setDMsg] = useState<string | null>(null);

  // Refund
  const [refundReason, setRefundReason] = useState('');
  const [refundErr, setRefundErr] = useState<string | null>(null);
  const [refundMsg, setRefundMsg] = useState<string | null>(null);

  // Builder evidence
  const [evMilestoneId, setEvMilestoneId] = useState<string | null>(null);
  const [evType, setEvType] = useState<EscrowEvidenceType>('photo');
  const [evUrl, setEvUrl] = useState('');
  const [evFileName, setEvFileName] = useState('');
  const [evDescription, setEvDescription] = useState('');
  const [evErr, setEvErr] = useState<string | null>(null);
  const [evMsg, setEvMsg] = useState<string | null>(null);

  const refreshAll = () => {
    detailQ.refetch();
    timelineQ.refetch();
    onChanged();
  };

  const payDepositMutation = trpc.propertyEscrow.escrowPlan.payDeposit.useMutation({
    onSuccess: (res: any) => {
      setPayMsg(`Deposit of ${fmtMoney(res.depositPaid)} paid — plan is now ${res.status}. Next installment due ${fmtDate(res.nextPaymentDate)}.`);
      setTotpCode('');
      refreshAll();
    },
    onError: (e: unknown) => setPayErr(investErrMsg(e)),
  });
  const payInstallmentMutation = trpc.propertyEscrow.escrowPlan.payInstallment.useMutation({
    onSuccess: (res: any) => {
      setPayMsg(
        `Installment #${res.installmentNumber} paid (${fmtMoney(res.amountPaid)}). Total paid ${fmtMoney(res.totalPaid)} of ${fmtMoney(res.totalRequired)}; ${res.remainingInstallments} installment(s) remaining. Plan status: ${res.status}.`,
      );
      setTotpCode('');
      refreshAll();
    },
    onError: (e: unknown) => setPayErr(investErrMsg(e)),
  });
  const disputeMutation = trpc.propertyEscrow.dispute.raise.useMutation({
    onSuccess: (res: any) => {
      setDMsg(res.message);
      setShowDisputeForm(false);
      setDDescription('');
      refreshAll();
    },
    onError: (e: unknown) => setDErr(investErrMsg(e)),
  });
  const refundMutation = trpc.propertyEscrow.dispute.requestFullRefund.useMutation({
    onSuccess: (res: any) => {
      setRefundMsg(res.message);
      setRefundReason('');
      refreshAll();
    },
    onError: (e: unknown) => setRefundErr(investErrMsg(e)),
  });
  const evidenceMutation = trpc.propertyEscrow.milestone.submitEvidence.useMutation({
    onSuccess: (res: any) => {
      setEvMsg(res.message);
      setEvMilestoneId(null);
      setEvUrl('');
      setEvFileName('');
      setEvDescription('');
      timelineQ.refetch();
    },
    onError: (e: unknown) => setEvErr(investErrMsg(e)),
  });

  const canPayDeposit = role === 'buyer' && !!plan && plan.status === 'draft' && !plan.depositPaid;
  const canPayInstallment = role === 'buyer' && !!plan && plan.status === 'active';
  const canDispute = role === 'buyer' && !!plan && (plan.status === 'active' || plan.status === 'completed');
  const canRefund = role === 'buyer' && !!plan && (plan.status === 'disputed' || plan.status === 'defaulted');

  const payBusy = payDepositMutation.isPending || payInstallmentMutation.isPending;

  return (
    <View style={[styles.card, styles.cardSelected]}>
      <View style={styles.rowBetween}>
        <View style={[styles.row, { gap: 8, flex: 1, marginRight: 8, flexWrap: 'wrap' }]}>
          <Text style={styles.textMain}>Plan {planId}</Text>
          {plan ? <StatusBadge status={plan.status} /> : null}
        </View>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.linkText}>Close</Text>
        </TouchableOpacity>
      </View>

      {detailQ.isLoading || timelineQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 12 }} /> : null}
      <ErrorBanner message={detailQ.error ? investErrMsg(detailQ.error) : null} />
      <ErrorBanner message={timelineQ.error ? investErrMsg(timelineQ.error) : null} />

      {detail && plan ? (
        <View style={{ marginTop: 10 }}>
          <View style={styles.statGrid}>
            {[
              ['Property', detail.listing ? `${detail.listing.title} (${detail.listing.city}, ${detail.listing.state})` : `#${plan.listingId}`],
              ['Builder', detail.builder ? `${detail.builder.companyName} (KYB: ${detail.builder.kybStatus})` : '—'],
              ['Deposit', `${fmtPct(plan.depositPct)} — ${plan.depositPaid ? 'paid' : 'unpaid'}`],
              ['Payment currency', plan.paymentCurrency ?? '—'],
              ['Total price', fmtMoney(plan.totalPriceUsd)],
              ['Paid into escrow', fmtMoney(plan.totalPaidUsd)],
              ['Released to builder', fmtMoney(plan.totalReleasedUsd)],
              ['Held in escrow', fmtMoney(Math.max(0, Number(plan.totalPaidUsd ?? 0) - Number(plan.totalReleasedUsd ?? 0)))],
            ].map(([label, value]) => (
              <View key={label as string} style={styles.statCell}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>

          {/* Payments — buyer only, TOTP step-up */}
          {(canPayDeposit || canPayInstallment) && (
            <View style={[styles.divider, { paddingTop: 12 }]}>
              <Text style={styles.sectionTitle}>Payments</Text>
              <TotpField value={totpCode} onChange={setTotpCode} />
              {canPayDeposit && (
                <TouchableOpacity
                  style={[styles.btn, payBusy && styles.btnDisabled]}
                  disabled={payBusy}
                  onPress={() => {
                    setPayErr(null);
                    setPayMsg(null);
                    payDepositMutation.mutate({ planId: plan.planId, totpCode: totpCode.trim() || undefined });
                  }}
                >
                  <Text style={styles.btnText}>
                    {payBusy ? 'Processing…' : `Pay deposit (${fmtMoney((Number(plan.totalPriceUsd) * Number(plan.depositPct ?? 10)) / 100)})`}
                  </Text>
                </TouchableOpacity>
              )}
              {canPayInstallment && (
                <TouchableOpacity
                  style={[styles.btn, payBusy && styles.btnDisabled]}
                  disabled={payBusy}
                  onPress={() => {
                    setPayErr(null);
                    setPayMsg(null);
                    payInstallmentMutation.mutate({ planId: plan.planId, totpCode: totpCode.trim() || undefined });
                  }}
                >
                  <Text style={styles.btnText}>{payBusy ? 'Processing…' : `Pay next installment (${fmtMoney(plan.installmentAmount)})`}</Text>
                </TouchableOpacity>
              )}
              <ErrorBanner message={payErr} />
              <SuccessNote message={payMsg} />
            </View>
          )}

          {/* Milestone status view */}
          <View style={[styles.divider, { paddingTop: 12 }]}>
            <Text style={styles.sectionTitle}>Milestones</Text>
            <Text style={[styles.textMuted, { lineHeight: 17 }]}>
              Milestone evidence is reviewed by platform inspectors/administrators, who also perform
              the fund release. This screen shows status only — releases cannot be triggered here.
            </Text>
            {timeline && timeline.milestones.length === 0 && (
              <Text style={[styles.textMuted, { marginTop: 6 }]}>No milestones on this plan.</Text>
            )}
            {(timeline?.milestones ?? []).map((m: any) => (
              <View key={m.id} style={[styles.card, { backgroundColor: '#12122a', marginTop: 10 }]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.textMain}>{m.sequenceNumber}. {m.name}</Text>
                    <Text style={[styles.textDim, { marginTop: 2 }]}>
                      releases {fmtPct(m.releasePct)} ({fmtMoney(m.releaseAmountUsd)}) · due {fmtDate(m.deadline)} · verification: {m.verificationType ?? '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {m.fundsReleased ? <Badge label="funds released" color="#10b981" bg="rgba(16,185,129,0.12)" /> : null}
                    <StatusBadge status={m.status} />
                  </View>
                </View>
                {m.rejectedReason ? (
                  <Text style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>Rejection reason: {m.rejectedReason}</Text>
                ) : null}
                {(m.evidence ?? []).length > 0 && (
                  <View style={{ marginTop: 6 }}>
                    {m.evidence.map((ev: any) => (
                      <Text key={ev.id} style={[styles.textMuted, { marginTop: 4 }]}>
                        {ev.evidenceType}:{' '}
                        <Text style={styles.linkText} onPress={() => Linking.openURL(ev.fileUrl)}>
                          {ev.fileName ?? ev.fileUrl}
                        </Text>{' '}
                        · submitted {fmtDateTime(ev.createdAt)} ·{' '}
                        {ev.verified === true
                          ? 'verified'
                          : ev.verified === false
                            ? `rejected${ev.rejectionReason ? ` (${ev.rejectionReason})` : ''}`
                            : 'awaiting review'}
                      </Text>
                    ))}
                  </View>
                )}
                {role === 'builder' && m.status !== 'approved' && (
                  <TouchableOpacity
                    style={[styles.btnSecondary, { marginTop: 8 }]}
                    onPress={() => {
                      setEvMilestoneId(evMilestoneId === m.milestoneId ? null : m.milestoneId);
                      setEvErr(null);
                      setEvMsg(null);
                    }}
                  >
                    <Text style={styles.btnText}>{evMilestoneId === m.milestoneId ? 'Cancel evidence' : 'Submit evidence'}</Text>
                  </TouchableOpacity>
                )}
                {role === 'builder' && evMilestoneId === m.milestoneId && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.label}>Evidence type</Text>
                    <ChipSelector<EscrowEvidenceType> value={evType} onChange={setEvType} options={EVIDENCE_TYPES} />
                    <LabeledInput label="File URL" value={evUrl} onChange={setEvUrl} placeholder="https://…" />
                    <LabeledInput label="File name (optional)" value={evFileName} onChange={setEvFileName} />
                    <LabeledInput label="Description (optional)" value={evDescription} onChange={setEvDescription} multiline />
                    <ErrorBanner message={evErr} />
                    <SuccessNote message={evMsg} />
                    <TouchableOpacity
                      style={[styles.btn, (evidenceMutation.isPending || !evUrl.trim()) && styles.btnDisabled]}
                      disabled={evidenceMutation.isPending || !evUrl.trim()}
                      onPress={() => {
                        setEvErr(null);
                        setEvMsg(null);
                        evidenceMutation.mutate({
                          milestoneId: m.milestoneId,
                          evidenceType: evType,
                          fileUrl: evUrl.trim(),
                          fileName: evFileName.trim() || undefined,
                          description: evDescription.trim() || undefined,
                        });
                      }}
                    >
                      <Text style={styles.btnText}>{evidenceMutation.isPending ? 'Submitting…' : 'Submit evidence'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* Dispute + refund — buyer only */}
          {(canDispute || canRefund) && (
            <View style={[styles.divider, { paddingTop: 12 }]}>
              <Text style={styles.sectionTitle}>Disputes</Text>
              <ErrorBanner message={dErr} />
              <SuccessNote message={dMsg} />
              <ErrorBanner message={refundErr} />
              <SuccessNote message={refundMsg} />

              {canDispute && (
                <View>
                  <TouchableOpacity style={styles.btnSecondary} onPress={() => setShowDisputeForm((v) => !v)}>
                    <Text style={styles.btnText}>{showDisputeForm ? 'Cancel dispute' : 'Raise a dispute'}</Text>
                  </TouchableOpacity>
                  {showDisputeForm && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={styles.label}>Dispute type</Text>
                      <ChipSelector<EscrowDisputeType> value={dType} onChange={setDType} options={DISPUTE_TYPES} />
                      <Text style={[styles.label, { marginTop: 10 }]}>Severity</Text>
                      <ChipSelector<Severity> value={dSeverity} onChange={setDSeverity} options={SEVERITIES} />
                      <LabeledInput label="Description" value={dDescription} onChange={setDDescription} multiline />
                      <TouchableOpacity
                        style={[styles.btnDanger, (disputeMutation.isPending || dDescription.trim().length === 0) && styles.btnDisabled]}
                        disabled={disputeMutation.isPending || dDescription.trim().length === 0}
                        onPress={() => {
                          setDErr(null);
                          setDMsg(null);
                          disputeMutation.mutate({ planId: plan.planId, disputeType: dType, severity: dSeverity, description: dDescription.trim() });
                        }}
                      >
                        <Text style={styles.btnText}>{disputeMutation.isPending ? 'Raising…' : 'Raise dispute'}</Text>
                      </TouchableOpacity>
                      <Text style={[styles.textDim, { marginTop: 8, lineHeight: 16 }]}>
                        Disputes are resolved by platform administrators — resolution is not
                        self-serve on this screen.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {canRefund && (
                <View style={{ marginTop: 12 }}>
                  <LabeledInput label="Refund reason" value={refundReason} onChange={setRefundReason} multiline />
                  <TouchableOpacity
                    style={[styles.btnDanger, (refundMutation.isPending || refundReason.trim().length === 0) && styles.btnDisabled]}
                    disabled={refundMutation.isPending || refundReason.trim().length === 0}
                    onPress={() => {
                      setRefundErr(null);
                      setRefundMsg(null);
                      refundMutation.mutate({ planId: plan.planId, reason: refundReason.trim() });
                    }}
                  >
                    <Text style={styles.btnText}>{refundMutation.isPending ? 'Requesting…' : 'Request full refund'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function EscrowScreen() {
  const [role, setRole] = useState<Role>('buyer');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const plansQ = trpc.propertyEscrow.escrowPlan.listMyPlans.useQuery({ role, limit: 50 });

  return (
    <View style={styles.container}>
      <InvestHeader title="Property escrow" />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        <Text style={[styles.textMuted, { marginBottom: 12, lineHeight: 18 }]}>
          Milestone-protected diaspora property purchases. Deposits and installments debit your USD
          wallet and require a 2FA code. Funds are released to the builder by platform
          administrators after milestone evidence is reviewed — releases cannot be triggered from
          this screen.
        </Text>

        <ChipSelector<Role>
          value={role}
          onChange={(r) => {
            setRole(r);
            setSelectedPlanId(null);
          }}
          options={[
            { value: 'buyer', label: 'As buyer' },
            { value: 'builder', label: 'As builder' },
          ]}
        />

        <View style={{ marginTop: 12 }}>
          <ErrorBanner message={plansQ.error ? investErrMsg(plansQ.error) : null} />
        </View>
        {plansQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
        {!plansQ.isLoading && !plansQ.error && (plansQ.data ?? []).length === 0 && (
          <Text style={styles.textMuted}>
            {role === 'buyer'
              ? 'You have no property escrow plans yet.'
              : 'No escrow plans are assigned to a builder profile on your account.'}
          </Text>
        )}

        {(plansQ.data ?? []).map((p: any) => {
          const paid = Number(p.totalPaidUsd ?? 0);
          const total = Number(p.totalPriceUsd ?? 0);
          const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.card, selectedPlanId === p.planId && styles.cardSelected]}
              onPress={() => setSelectedPlanId(selectedPlanId === p.planId ? null : p.planId)}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{p.planId}</Text>
                <StatusBadge status={p.status} />
              </View>
              <View style={[styles.rowBetween, { marginTop: 8 }]}>
                <View>
                  <Text style={styles.textDim}>Total price</Text>
                  <Text style={styles.textMain}>{fmtMoney(p.totalPriceUsd)}</Text>
                </View>
                <View>
                  <Text style={styles.textDim}>Paid in</Text>
                  <Text style={styles.textMain}>{fmtMoney(p.totalPaidUsd)}</Text>
                </View>
                <View>
                  <Text style={styles.textDim}>Released to builder</Text>
                  <Text style={styles.textMain}>{fmtMoney(p.totalReleasedUsd)}</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={[styles.textDim, { marginTop: 4 }]}>
                {pct}% paid · {p.installmentCount}× {fmtMoney(p.installmentAmount)} {p.installmentFrequency ?? 'monthly'} · created {fmtDate(p.createdAt)}
              </Text>
            </TouchableOpacity>
          );
        })}

        {selectedPlanId !== null && (
          <PlanDetail
            planId={selectedPlanId}
            role={role}
            onClose={() => setSelectedPlanId(null)}
            onChanged={() => plansQ.refetch()}
          />
        )}
      </ScrollView>
    </View>
  );
}
