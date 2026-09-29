/**
 * W16-C7 (SPEC-wave16, pwa-invest-b) — /invest/escrow
 *
 * Property escrow surface backed by the mounted `propertyEscrow` router
 * (server/routers/propertyEscrow.ts, 19 procs). User-role procedures wired:
 *   - escrowPlan.listMyPlans / get        — my escrows (buyer or builder role)
 *   - escrowPlan.payDeposit / payInstallment — wallet-debiting, tier-gated,
 *     TOTP step-up guarded (requireTotpStepUp, fail-closed — surfaced here)
 *   - milestone.getTimeline               — milestone status view incl. evidence
 *   - milestone.submitEvidence            — builder-role evidence upload
 *   - dispute.raise / requestFullRefund   — buyer-role dispute + refund request
 *
 * Fund release / evidence approval are ADMIN-ONLY server procedures
 * (milestone.approveMilestone, milestone.reviewEvidence, dispute.resolve,
 * builderKyb.adminVerify) — they deliberately do NOT appear in this UI. The
 * milestone view states who performs releases instead of showing dead buttons.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  btnDangerCls,
  btnPrimaryCls,
  btnSecondaryCls,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtPct,
  inputCls,
  investErrMsg,
  propertyEscrowApi,
  statusBadgeCls,
  type EscrowDisputeType,
  type EscrowEvidenceType,
  type EscrowPlan,
  type EscrowPlanDetail,
  type EscrowTimeline,
} from "./api-b";

type Role = "buyer" | "builder";

const DISPUTE_TYPES: Array<{ value: EscrowDisputeType; label: string }> = [
  { value: "deadline_missed", label: "Deadline missed" },
  { value: "quality_issues", label: "Quality issues" },
  { value: "builder_default", label: "Builder default" },
  { value: "scope_change", label: "Scope change" },
  { value: "fraud", label: "Fraud" },
  { value: "communication_failure", label: "Communication failure" },
  { value: "force_majeure", label: "Force majeure" },
  { value: "other", label: "Other" },
];

const EVIDENCE_TYPES: Array<{ value: EscrowEvidenceType; label: string }> = [
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
  { value: "document", label: "Document" },
  { value: "engineer_report", label: "Engineer report" },
  { value: "surveyor_report", label: "Surveyor report" },
  { value: "inspection_report", label: "Inspection report" },
  { value: "receipt", label: "Receipt" },
  { value: "certificate", label: "Certificate" },
];

const Escrow: React.FC = () => {
  const [role, setRole] = useState<Role>("buyer");

  // ── Plan list ─────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState<EscrowPlan[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  // ── Plan detail ───────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<EscrowPlanDetail | null>(null);
  const [timeline, setTimeline] = useState<EscrowTimeline | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  // ── Payments (TOTP step-up) ───────────────────────────────────────────────
  const [totpCode, setTotpCode] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  // ── Dispute ───────────────────────────────────────────────────────────────
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [dType, setDType] = useState<EscrowDisputeType>("other");
  const [dSeverity, setDSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [dDescription, setDDescription] = useState("");
  const [dBusy, setDBusy] = useState(false);
  const [dErr, setDErr] = useState<string | null>(null);
  const [dMsg, setDMsg] = useState<string | null>(null);

  // ── Refund ────────────────────────────────────────────────────────────────
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundErr, setRefundErr] = useState<string | null>(null);
  const [refundMsg, setRefundMsg] = useState<string | null>(null);

  // ── Builder evidence ──────────────────────────────────────────────────────
  const [evMilestoneId, setEvMilestoneId] = useState<string | null>(null);
  const [evType, setEvType] = useState<EscrowEvidenceType>("photo");
  const [evUrl, setEvUrl] = useState("");
  const [evFileName, setEvFileName] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evBusy, setEvBusy] = useState(false);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [evMsg, setEvMsg] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setListLoading(true);
    setListErr(null);
    try {
      setPlans(await propertyEscrowApi.escrowPlan.listMyPlans.query({ role, limit: 50 }));
    } catch (e) {
      setListErr(investErrMsg(e));
    } finally {
      setListLoading(false);
    }
  }, [role]);

  useEffect(() => {
    setDetail(null);
    setTimeline(null);
    void loadPlans();
  }, [loadPlans]);

  const openPlan = async (planId: string) => {
    setDetailLoading(true);
    setDetailErr(null);
    setPayErr(null);
    setPayMsg(null);
    setDErr(null);
    setDMsg(null);
    setRefundErr(null);
    setRefundMsg(null);
    setEvErr(null);
    setEvMsg(null);
    setEvMilestoneId(null);
    setShowDisputeForm(false);
    setTotpCode("");
    try {
      const [d, t] = await Promise.all([
        propertyEscrowApi.escrowPlan.get.query({ planId }),
        propertyEscrowApi.milestone.getTimeline.query({ planId }),
      ]);
      setDetail(d);
      setTimeline(t);
    } catch (e) {
      setDetail(null);
      setTimeline(null);
      setDetailErr(investErrMsg(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detail) return;
    await openPlan(detail.plan.planId);
  };

  const pay = async (kind: "deposit" | "installment") => {
    if (!detail) return;
    setPayBusy(true);
    setPayErr(null);
    setPayMsg(null);
    try {
      const input = { planId: detail.plan.planId, totpCode: totpCode.trim() || undefined };
      if (kind === "deposit") {
        const res = await propertyEscrowApi.escrowPlan.payDeposit.mutate(input);
        setPayMsg(
          `Deposit of ${fmtMoney(res.depositPaid)} paid — plan is now ${res.status}. Next installment due ${fmtDate(res.nextPaymentDate)}.`,
        );
      } else {
        const res = await propertyEscrowApi.escrowPlan.payInstallment.mutate(input);
        setPayMsg(
          `Installment #${res.installmentNumber} paid (${fmtMoney(res.amountPaid)}). Total paid ${fmtMoney(res.totalPaid)} of ${fmtMoney(res.totalRequired)}; ${res.remainingInstallments} installment(s) remaining. Plan status: ${res.status}.`,
        );
      }
      setTotpCode("");
      await Promise.all([loadPlans(), refreshDetail()]);
    } catch (e) {
      setPayErr(investErrMsg(e));
    } finally {
      setPayBusy(false);
    }
  };

  const raiseDispute = async () => {
    if (!detail) return;
    setDBusy(true);
    setDErr(null);
    setDMsg(null);
    try {
      const res = await propertyEscrowApi.dispute.raise.mutate({
        planId: detail.plan.planId,
        disputeType: dType,
        severity: dSeverity,
        description: dDescription.trim(),
      });
      setDMsg(res.message);
      setShowDisputeForm(false);
      setDDescription("");
      await Promise.all([loadPlans(), refreshDetail()]);
    } catch (e) {
      setDErr(investErrMsg(e));
    } finally {
      setDBusy(false);
    }
  };

  const requestRefund = async () => {
    if (!detail) return;
    setRefundBusy(true);
    setRefundErr(null);
    setRefundMsg(null);
    try {
      const res = await propertyEscrowApi.dispute.requestFullRefund.mutate({
        planId: detail.plan.planId,
        reason: refundReason.trim(),
      });
      setRefundMsg(res.message);
      setRefundReason("");
      await Promise.all([loadPlans(), refreshDetail()]);
    } catch (e) {
      setRefundErr(investErrMsg(e));
    } finally {
      setRefundBusy(false);
    }
  };

  const submitEvidence = async () => {
    if (!evMilestoneId) return;
    setEvBusy(true);
    setEvErr(null);
    setEvMsg(null);
    try {
      const res = await propertyEscrowApi.milestone.submitEvidence.mutate({
        milestoneId: evMilestoneId,
        evidenceType: evType,
        fileUrl: evUrl.trim(),
        fileName: evFileName.trim() || undefined,
        description: evDescription.trim() || undefined,
      });
      setEvMsg(res.message);
      setEvMilestoneId(null);
      setEvUrl("");
      setEvFileName("");
      setEvDescription("");
      await refreshDetail();
    } catch (e) {
      setEvErr(investErrMsg(e));
    } finally {
      setEvBusy(false);
    }
  };

  const plan = detail?.plan ?? null;
  const canPayDeposit =
    role === "buyer" && !!plan && plan.status === "draft" && !plan.depositPaid;
  const canPayInstallment = role === "buyer" && !!plan && plan.status === "active";
  const canDispute =
    role === "buyer" &&
    !!plan &&
    (plan.status === "active" || plan.status === "completed");
  const canRefund =
    role === "buyer" && !!plan && (plan.status === "disputed" || plan.status === "defaulted");

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <header>
        <p className="text-xs text-stone-400 mb-1">
          <Link to="/invest" className="hover:text-amber-700">
            Investments
          </Link>{" "}
          / Property escrow
        </p>
        <h1 className="text-2xl font-bold text-stone-900">Property escrow</h1>
        <p className="text-stone-500 mt-2 text-sm leading-relaxed">
          Milestone-protected diaspora property purchases. Deposits and installments
          debit your USD wallet and require a 2FA code. Funds are released to the
          builder by platform administrators after milestone evidence is reviewed —
          releases cannot be triggered from this screen.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {(
          [
            { value: "buyer", label: "As buyer" },
            { value: "builder", label: "As builder" },
          ] as Array<{ value: Role; label: string }>
        ).map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRole(r.value)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              role === r.value
                ? "bg-amber-700 text-white"
                : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {listLoading && <p className="text-sm text-stone-400">Loading escrow plans…</p>}
      {listErr && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {listErr}
        </div>
      )}
      {!listLoading && !listErr && plans.length === 0 && (
        <p className="text-sm text-stone-400">
          {role === "buyer"
            ? "You have no property escrow plans yet."
            : "No escrow plans are assigned to a builder profile on your account."}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {plans.map((p) => {
          const paid = Number(p.totalPaidUsd ?? 0);
          const total = Number(p.totalPriceUsd ?? 0);
          const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => void openPlan(p.planId)}
              className={`text-left bg-white rounded-2xl border p-6 space-y-3 transition-colors hover:border-amber-300 ${
                plan?.planId === p.planId ? "border-amber-400" : "border-stone-100"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold text-stone-900">{p.planId}</h2>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(p.status)}`}
                >
                  {p.status ?? "—"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-stone-400">Total price</p>
                  <p className="text-stone-800 font-medium">{fmtMoney(p.totalPriceUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-400">Paid in</p>
                  <p className="text-stone-800 font-medium">{fmtMoney(p.totalPaidUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-400">Released to builder</p>
                  <p className="text-stone-800 font-medium">{fmtMoney(p.totalReleasedUsd)}</p>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                <div className="h-full bg-amber-600" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-stone-400">
                {pct}% paid · {p.installmentCount}× {fmtMoney(p.installmentAmount)}{" "}
                {p.installmentFrequency ?? "monthly"} · created {fmtDate(p.createdAt)}
              </p>
            </button>
          );
        })}
      </div>

      {detailLoading && <p className="text-sm text-stone-400">Loading plan detail…</p>}
      {detailErr && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {detailErr}
        </div>
      )}

      {detail && plan && (
        <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900">
              Plan {plan.planId}
              <span
                className={`ml-3 inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(plan.status)}`}
              >
                {plan.status ?? "—"}
              </span>
            </h2>
            <button
              type="button"
              className="text-xs text-stone-400 hover:text-stone-600"
              onClick={() => {
                setDetail(null);
                setTimeline(null);
              }}
            >
              Close
            </button>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-stone-400 text-xs">Property</dt>
              <dd className="text-stone-700">
                {detail.listing
                  ? `${detail.listing.title} (${detail.listing.city}, ${detail.listing.state})`
                  : `#${plan.listingId}`}
              </dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Builder</dt>
              <dd className="text-stone-700">
                {detail.builder
                  ? `${detail.builder.companyName} (KYB: ${detail.builder.kybStatus})`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Deposit</dt>
              <dd className="text-stone-700">
                {fmtPct(plan.depositPct)} — {plan.depositPaid ? "paid" : "unpaid"}
              </dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Payment currency</dt>
              <dd className="text-stone-700">{plan.paymentCurrency ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Total price</dt>
              <dd className="text-stone-700">{fmtMoney(plan.totalPriceUsd)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Paid into escrow</dt>
              <dd className="text-stone-700">{fmtMoney(plan.totalPaidUsd)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Released to builder</dt>
              <dd className="text-stone-700">{fmtMoney(plan.totalReleasedUsd)}</dd>
            </div>
            <div>
              <dt className="text-stone-400 text-xs">Held in escrow</dt>
              <dd className="text-stone-700">
                {fmtMoney(
                  Math.max(
                    0,
                    Number(plan.totalPaidUsd ?? 0) - Number(plan.totalReleasedUsd ?? 0),
                  ),
                )}
              </dd>
            </div>
          </dl>

          {/* Payments — buyer only, TOTP step-up */}
          {(canPayDeposit || canPayInstallment) && (
            <div className="border-t border-stone-100 pt-5 space-y-4">
              <h3 className="text-sm font-semibold text-stone-900">Payments</h3>
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-stone-500 mb-1.5">
                  2FA code (required if enrolled)
                </label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {canPayDeposit && (
                  <button
                    type="button"
                    className={btnPrimaryCls}
                    disabled={payBusy}
                    onClick={() => void pay("deposit")}
                  >
                    {payBusy
                      ? "Processing…"
                      : `Pay deposit (${fmtMoney(
                          (Number(plan.totalPriceUsd) * Number(plan.depositPct ?? 10)) / 100,
                        )})`}
                  </button>
                )}
                {canPayInstallment && (
                  <button
                    type="button"
                    className={btnPrimaryCls}
                    disabled={payBusy}
                    onClick={() => void pay("installment")}
                  >
                    {payBusy
                      ? "Processing…"
                      : `Pay next installment (${fmtMoney(plan.installmentAmount)})`}
                  </button>
                )}
              </div>
              {payErr && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {payErr}
                </div>
              )}
              {payMsg && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {payMsg}
                </div>
              )}
            </div>
          )}

          {/* Milestone status view */}
          <div className="border-t border-stone-100 pt-5 space-y-4">
            <h3 className="text-sm font-semibold text-stone-900">Milestones</h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              Milestone evidence is reviewed by platform inspectors/administrators, who
              also perform the fund release. This screen shows status only — releases
              cannot be triggered here.
            </p>
            {!timeline && <p className="text-sm text-stone-400">Loading milestones…</p>}
            {timeline && timeline.milestones.length === 0 && (
              <p className="text-sm text-stone-400">No milestones on this plan.</p>
            )}
            {timeline?.milestones.map((m) => (
              <div key={m.id} className="rounded-xl border border-stone-100 p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-stone-900">
                      {m.sequenceNumber}. {m.name}
                    </h4>
                    <p className="text-xs text-stone-400">
                      releases {fmtPct(m.releasePct)} ({fmtMoney(m.releaseAmountUsd)}) · due{" "}
                      {fmtDate(m.deadline)} · verification: {m.verificationType ?? "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {m.fundsReleased && (
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                        funds released
                      </span>
                    )}
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(m.status)}`}
                    >
                      {m.status ?? "—"}
                    </span>
                  </div>
                </div>
                {m.rejectedReason && (
                  <p className="text-xs text-red-600">Rejection reason: {m.rejectedReason}</p>
                )}
                {m.evidence.length > 0 && (
                  <ul className="text-xs text-stone-500 space-y-1">
                    {m.evidence.map((ev) => (
                      <li key={ev.id}>
                        {ev.evidenceType}:{" "}
                        <a
                          className="text-amber-700 hover:underline break-all"
                          href={ev.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {ev.fileName ?? ev.fileUrl}
                        </a>{" "}
                        · submitted {fmtDateTime(ev.createdAt)} ·{" "}
                        {ev.verified === true
                          ? "verified"
                          : ev.verified === false
                            ? `rejected${ev.rejectionReason ? ` (${ev.rejectionReason})` : ""}`
                            : "awaiting review"}
                      </li>
                    ))}
                  </ul>
                )}
                {role === "builder" && m.status !== "approved" && (
                  <div>
                    <button
                      type="button"
                      className={btnSecondaryCls}
                      onClick={() => {
                        setEvMilestoneId(evMilestoneId === m.milestoneId ? null : m.milestoneId);
                        setEvErr(null);
                        setEvMsg(null);
                      }}
                    >
                      {evMilestoneId === m.milestoneId ? "Cancel evidence" : "Submit evidence"}
                    </button>
                  </div>
                )}
                {role === "builder" && evMilestoneId === m.milestoneId && (
                  <div className="rounded-xl border border-dashed border-stone-200 p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          Evidence type
                        </label>
                        <select
                          className={inputCls}
                          value={evType}
                          onChange={(e) => setEvType(e.target.value as EscrowEvidenceType)}
                        >
                          {EVIDENCE_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          File URL (https://…)
                        </label>
                        <input
                          className={inputCls}
                          placeholder="https://…"
                          value={evUrl}
                          onChange={(e) => setEvUrl(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          File name (optional)
                        </label>
                        <input
                          className={inputCls}
                          value={evFileName}
                          onChange={(e) => setEvFileName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          Description (optional)
                        </label>
                        <input
                          className={inputCls}
                          value={evDescription}
                          onChange={(e) => setEvDescription(e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className={btnPrimaryCls}
                      disabled={evBusy || !evUrl.trim()}
                      onClick={() => void submitEvidence()}
                    >
                      {evBusy ? "Submitting…" : "Submit evidence"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {evErr && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {evErr}
              </div>
            )}
            {evMsg && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {evMsg}
              </div>
            )}
          </div>

          {/* Payment schedule */}
          {detail.schedule.length > 0 && (
            <div className="border-t border-stone-100 pt-5 space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Payment schedule</h3>
              <div className="bg-white rounded-xl border border-stone-100 overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Due</th>
                      <th className="px-4 py-2 font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Paid at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.schedule.map((s) => (
                      <tr key={s.id} className="border-b border-stone-50">
                        <td className="px-4 py-2 text-stone-600">{s.installmentNumber}</td>
                        <td className="px-4 py-2 text-stone-600">{fmtDate(s.dueDate)}</td>
                        <td className="px-4 py-2 text-stone-600">{fmtMoney(s.amountUsd)}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(s.status)}`}
                          >
                            {s.status ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-stone-500">{fmtDate(s.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Disputes */}
          <div className="border-t border-stone-100 pt-5 space-y-4">
            <h3 className="text-sm font-semibold text-stone-900">
              Disputes ({detail.disputes.length})
            </h3>
            {detail.disputes.map((d) => (
              <div key={d.id} className="rounded-xl border border-stone-100 p-4 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-stone-800">
                    {d.disputeId} — {d.disputeType} ({d.severity})
                  </p>
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(d.status)}`}
                  >
                    {d.status}
                  </span>
                </div>
                <p className="text-xs text-stone-500">
                  raised {fmtDateTime(d.createdAt)} · cure deadline {fmtDate(d.cureDeadline)} ·
                  auto-refund date {fmtDate(d.autoRefundDate)}
                </p>
                <p className="text-sm text-stone-600">{d.description}</p>
              </div>
            ))}

            {dMsg && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {dMsg}
              </div>
            )}
            {dErr && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {dErr}
              </div>
            )}

            {canDispute && !showDisputeForm && (
              <button
                type="button"
                className={btnDangerCls}
                onClick={() => setShowDisputeForm(true)}
              >
                Raise a dispute
              </button>
            )}

            {showDisputeForm && canDispute && (
              <div className="rounded-xl border border-dashed border-stone-200 p-4 space-y-4">
                <h4 className="text-sm font-semibold text-stone-900">Raise dispute</h4>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Raising a dispute freezes the escrow plan and issues a 14-day cure
                  notice to the builder. If unresolved after 90 days, a full refund is
                  issued automatically.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">
                      Type
                    </label>
                    <select
                      className={inputCls}
                      value={dType}
                      onChange={(e) => setDType(e.target.value as EscrowDisputeType)}
                    >
                      {DISPUTE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">
                      Severity
                    </label>
                    <select
                      className={inputCls}
                      value={dSeverity}
                      onChange={(e) =>
                        setDSeverity(e.target.value as "low" | "medium" | "high" | "critical")
                      }
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="critical">critical</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">
                      Description (min 20 characters)
                    </label>
                    <textarea
                      className={inputCls}
                      rows={3}
                      value={dDescription}
                      onChange={(e) => setDDescription(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={btnDangerCls}
                    disabled={dBusy || dDescription.trim().length < 20}
                    onClick={() => void raiseDispute()}
                  >
                    {dBusy ? "Submitting…" : "Submit dispute"}
                  </button>
                  <button
                    type="button"
                    className={btnSecondaryCls}
                    onClick={() => setShowDisputeForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Refund — buyer, disputed/defaulted only; grace period server-enforced */}
            {canRefund && (
              <div className="rounded-xl border border-stone-100 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-stone-900">Request full refund</h4>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Available once the 90-day grace period after the first dispute has
                  elapsed (enforced server-side). Refunds the remaining escrowed balance
                  to your USD wallet.
                </p>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Reason (min 10 characters)
                  </label>
                  <textarea
                    className={inputCls}
                    rows={2}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                  />
                </div>
                {refundErr && (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {refundErr}
                  </div>
                )}
                {refundMsg && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {refundMsg}
                  </div>
                )}
                <button
                  type="button"
                  className={btnDangerCls}
                  disabled={refundBusy || refundReason.trim().length < 10}
                  onClick={() => void requestRefund()}
                >
                  {refundBusy ? "Requesting…" : "Request full refund"}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default Escrow;
