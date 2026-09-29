/**
 * W16-C7 (SPEC-wave16, pwa-invest-b) — /invest/community
 *
 * Community funds surface backed by the inline `community` router
 * (server/routers.ts:6537, 13 procs). Wired here (user-role only):
 *   - listFunds / createFund / contribute
 *   - listProposals / submitProposal / vote / liveVotes
 *   - getImpactMetrics (funded-proposal + totals — the user-visible
 *     disbursement history; proposals in status funded/completed are listed)
 *   - requestDisbursement (server restricts to the proposal submitter; the
 *     button only renders on the user's own eligible proposals)
 *   - communityLeaderboard / listMyVotes
 *
 * Admin-only procedures are intentionally NOT exposed: approveDisbursement and
 * listDisbursementRequests belong to an admin console, not this user UI.
 *
 * Honesty: `community.contribute` records the contribution against the fund
 * (counter + audit log); it does NOT debit a wallet — the UI states this.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import {
  btnPrimaryCls,
  btnSecondaryCls,
  communityApi,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  inputCls,
  investErrMsg,
  statusBadgeCls,
  type CommunityFund,
  type CommunityImpactMetrics,
  type CommunityLeaderboard,
  type FundProposal,
  type MyVote,
} from "./api-b";

type Tab = "funds" | "myvotes" | "leaderboard";

/** Quorum used server-side for vote milestones / disbursement eligibility. */
const QUORUM = 10;

const Community: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const myUserId = user?.id ? Number(user.id) : null;

  const [tab, setTab] = useState<Tab>("funds");

  // ── Funds ─────────────────────────────────────────────────────────────────
  const [funds, setFunds] = useState<CommunityFund[]>([]);
  const [fundsLoading, setFundsLoading] = useState(true);
  const [fundsErr, setFundsErr] = useState<string | null>(null);

  // ── Create fund ───────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [cfName, setCfName] = useState("");
  const [cfDescription, setCfDescription] = useState("");
  const [cfCountry, setCfCountry] = useState("");
  const [cfTheme, setCfTheme] = useState("");
  const [cfGoal, setCfGoal] = useState("");
  const [cfBusy, setCfBusy] = useState(false);
  const [cfErr, setCfErr] = useState<string | null>(null);

  // ── Selected fund + proposals ─────────────────────────────────────────────
  const [selectedFund, setSelectedFund] = useState<CommunityFund | null>(null);
  const [proposals, setProposals] = useState<FundProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsErr, setProposalsErr] = useState<string | null>(null);
  const [impact, setImpact] = useState<CommunityImpactMetrics | null>(null);

  // ── Contribute ────────────────────────────────────────────────────────────
  const [contribAmount, setContribAmount] = useState("");
  const [contribBusy, setContribBusy] = useState(false);
  const [contribErr, setContribErr] = useState<string | null>(null);
  const [contribMsg, setContribMsg] = useState<string | null>(null);

  // ── Submit proposal ───────────────────────────────────────────────────────
  const [spTitle, setSpTitle] = useState("");
  const [spDescription, setSpDescription] = useState("");
  const [spAmount, setSpAmount] = useState("");
  const [spBeneficiaryName, setSpBeneficiaryName] = useState("");
  const [spBeneficiaryCountry, setSpBeneficiaryCountry] = useState("");
  const [spImpact, setSpImpact] = useState("");
  const [spBusy, setSpBusy] = useState(false);
  const [spErr, setSpErr] = useState<string | null>(null);

  // ── Vote / disburse ───────────────────────────────────────────────────────
  const [voteBusyId, setVoteBusyId] = useState<number | null>(null);
  const [voteErr, setVoteErr] = useState<string | null>(null);
  const [disburseBusyId, setDisburseBusyId] = useState<number | null>(null);
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null);

  // ── My votes / leaderboard ────────────────────────────────────────────────
  const [myVotes, setMyVotes] = useState<MyVote[]>([]);
  const [myVotesLoading, setMyVotesLoading] = useState(false);
  const [myVotesErr, setMyVotesErr] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<CommunityLeaderboard | null>(null);
  const [leaderboardErr, setLeaderboardErr] = useState<string | null>(null);

  const loadFunds = useCallback(async () => {
    setFundsLoading(true);
    setFundsErr(null);
    try {
      setFunds(await communityApi.listFunds.query());
    } catch (e) {
      setFundsErr(investErrMsg(e));
    } finally {
      setFundsLoading(false);
    }
  }, []);

  const loadProposals = useCallback(async (fundId: number) => {
    setProposalsLoading(true);
    setProposalsErr(null);
    try {
      const [p, m] = await Promise.all([
        communityApi.listProposals.query({ fundId }),
        communityApi.getImpactMetrics.query({ fundId }),
      ]);
      setProposals(p);
      setImpact(m);
    } catch (e) {
      setProposalsErr(investErrMsg(e));
    } finally {
      setProposalsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFunds();
  }, [loadFunds]);

  useEffect(() => {
    if (tab === "myvotes") {
      setMyVotesLoading(true);
      setMyVotesErr(null);
      communityApi.listMyVotes
        .query()
        .then(setMyVotes)
        .catch((e) => setMyVotesErr(investErrMsg(e)))
        .finally(() => setMyVotesLoading(false));
    }
    if (tab === "leaderboard") {
      setLeaderboardErr(null);
      communityApi.communityLeaderboard
        .query()
        .then(setLeaderboard)
        .catch((e) => setLeaderboardErr(investErrMsg(e)));
    }
  }, [tab]);

  const selectFund = (f: CommunityFund) => {
    setSelectedFund(f);
    setContribAmount("");
    setContribErr(null);
    setContribMsg(null);
    setVoteErr(null);
    setDisburseMsg(null);
    void loadProposals(f.id);
  };

  const createFund = async () => {
    setCfBusy(true);
    setCfErr(null);
    try {
      const goal = cfGoal.trim() ? Number(cfGoal) : undefined;
      await communityApi.createFund.mutate({
        name: cfName.trim(),
        description: cfDescription.trim() || undefined,
        country: cfCountry.trim() || undefined,
        theme: cfTheme.trim() || undefined,
        goalAmount: goal && Number.isFinite(goal) ? goal : undefined,
        currency: "USD",
        sdgGoals: [],
      });
      setShowCreate(false);
      setCfName("");
      setCfDescription("");
      setCfCountry("");
      setCfTheme("");
      setCfGoal("");
      await loadFunds();
    } catch (e) {
      setCfErr(investErrMsg(e));
    } finally {
      setCfBusy(false);
    }
  };

  const contribute = async () => {
    if (!selectedFund) return;
    const amount = Number(contribAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setContribBusy(true);
    setContribErr(null);
    setContribMsg(null);
    try {
      const res = await communityApi.contribute.mutate({ fundId: selectedFund.id, amount });
      setContribMsg(
        `Contribution of ${fmtMoney(res.amount)} recorded against this fund (no wallet debit occurs in this flow).`,
      );
      setContribAmount("");
      await loadFunds();
      const refreshed = await communityApi.getImpactMetrics.query({ fundId: selectedFund.id });
      setImpact(refreshed);
      if (refreshed) setSelectedFund(refreshed.fund);
    } catch (e) {
      setContribErr(investErrMsg(e));
    } finally {
      setContribBusy(false);
    }
  };

  const submitProposal = async () => {
    if (!selectedFund) return;
    const amount = Number(spAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSpBusy(true);
    setSpErr(null);
    try {
      await communityApi.submitProposal.mutate({
        fundId: selectedFund.id,
        title: spTitle.trim(),
        description: spDescription.trim() || undefined,
        requestedAmount: amount,
        currency: "USD",
        beneficiaryName: spBeneficiaryName.trim() || undefined,
        beneficiaryCountry: spBeneficiaryCountry.trim() || undefined,
        impactDescription: spImpact.trim() || undefined,
      });
      setSpTitle("");
      setSpDescription("");
      setSpAmount("");
      setSpBeneficiaryName("");
      setSpBeneficiaryCountry("");
      setSpImpact("");
      await loadProposals(selectedFund.id);
    } catch (e) {
      setSpErr(investErrMsg(e));
    } finally {
      setSpBusy(false);
    }
  };

  const vote = async (proposalId: number, voteValue: "for" | "against") => {
    setVoteBusyId(proposalId);
    setVoteErr(null);
    try {
      await communityApi.vote.mutate({ proposalId, vote: voteValue });
      // Refresh live counts for this proposal + the full list.
      if (selectedFund) await loadProposals(selectedFund.id);
    } catch (e) {
      setVoteErr(investErrMsg(e));
    } finally {
      setVoteBusyId(null);
    }
  };

  const requestDisbursement = async (proposalId: number) => {
    setDisburseBusyId(proposalId);
    setVoteErr(null);
    setDisburseMsg(null);
    try {
      await communityApi.requestDisbursement.mutate({
        proposalId,
        disbursementMethod: "wallet",
      });
      setDisburseMsg(
        "Disbursement requested — the proposal now awaits administrator review. Approval and payout are performed by platform administrators, not here.",
      );
      if (selectedFund) await loadProposals(selectedFund.id);
    } catch (e) {
      setVoteErr(investErrMsg(e));
    } finally {
      setDisburseBusyId(null);
    }
  };

  const disbursementHistory = proposals.filter(
    (p) => p.status === "funded" || p.status === "completed",
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <header>
        <p className="text-xs text-stone-400 mb-1">
          <Link to="/invest" className="hover:text-amber-700">
            Investments
          </Link>{" "}
          / Community funds
        </p>
        <h1 className="text-2xl font-bold text-stone-900">Community funds</h1>
        <p className="text-stone-500 mt-2 text-sm leading-relaxed">
          Pool funds with the community, propose projects, and vote on how pooled
          money is used. Disbursements are approved by platform administrators;
          funded and completed proposals form the public disbursement history.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {(
          [
            { value: "funds", label: "Funds & proposals" },
            { value: "myvotes", label: "My votes" },
            { value: "leaderboard", label: "Leaderboard" },
          ] as Array<{ value: Tab; label: string }>
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === t.value
                ? "bg-amber-700 text-white"
                : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "funds" && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              className={showCreate ? btnSecondaryCls : btnPrimaryCls}
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? "Cancel" : "Create a fund"}
            </button>
          </div>

          {showCreate && (
            <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-4">
              <h2 className="text-base font-semibold text-stone-900">New community fund</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Name (min 3 characters)
                  </label>
                  <input
                    className={inputCls}
                    value={cfName}
                    onChange={(e) => setCfName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Goal amount (USD, optional)
                  </label>
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    value={cfGoal}
                    onChange={(e) => setCfGoal(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Country (optional)
                  </label>
                  <input
                    className={inputCls}
                    value={cfCountry}
                    onChange={(e) => setCfCountry(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Theme (optional)
                  </label>
                  <input
                    className={inputCls}
                    value={cfTheme}
                    onChange={(e) => setCfTheme(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    Description (optional)
                  </label>
                  <textarea
                    className={inputCls}
                    rows={2}
                    value={cfDescription}
                    onChange={(e) => setCfDescription(e.target.value)}
                  />
                </div>
              </div>
              {cfErr && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {cfErr}
                </div>
              )}
              <button
                type="button"
                className={btnPrimaryCls}
                disabled={cfBusy || cfName.trim().length < 3}
                onClick={() => void createFund()}
              >
                {cfBusy ? "Creating…" : "Create fund"}
              </button>
            </section>
          )}

          {fundsLoading && <p className="text-sm text-stone-400">Loading funds…</p>}
          {fundsErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {fundsErr}
            </div>
          )}
          {!fundsLoading && !fundsErr && funds.length === 0 && (
            <p className="text-sm text-stone-400">No active community funds yet.</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {funds.map((f) => {
              const goal = f.goalAmount ? Number(f.goalAmount) : null;
              const raised = Number(f.totalRaised ?? 0);
              const pct = goal && goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => selectFund(f)}
                  className={`text-left bg-white rounded-2xl border p-6 space-y-3 transition-colors hover:border-amber-300 ${
                    selectedFund?.id === f.id ? "border-amber-400" : "border-stone-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold text-stone-900">{f.name}</h2>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(f.status)}`}
                    >
                      {f.status}
                    </span>
                  </div>
                  {f.description && (
                    <p className="text-sm text-stone-500 line-clamp-2">{f.description}</p>
                  )}
                  <p className="text-xs text-stone-400">
                    {[f.theme, f.country].filter(Boolean).join(" · ") || "General"}
                    {f.sdgGoals.length > 0 ? ` · SDG ${f.sdgGoals.join(", ")}` : ""}
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-stone-400">Raised</p>
                      <p className="text-stone-800 font-medium">
                        {fmtMoney(f.totalRaised ?? "0", f.currency ?? "USD")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-stone-400">Goal</p>
                      <p className="text-stone-800 font-medium">
                        {f.goalAmount ? fmtMoney(f.goalAmount, f.currency ?? "USD") : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-stone-400">Contributors</p>
                      <p className="text-stone-800 font-medium">{f.contributorCount ?? 0}</p>
                    </div>
                  </div>
                  {pct !== null && (
                    <>
                      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                        <div className="h-full bg-amber-600" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-stone-400">{pct}% of goal</p>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {selectedFund && (
            <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-stone-900">{selectedFund.name}</h2>
                <button
                  type="button"
                  className="text-xs text-stone-400 hover:text-stone-600"
                  onClick={() => setSelectedFund(null)}
                >
                  Close
                </button>
              </div>

              {impact && (
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-stone-400 text-xs">Funded proposals</dt>
                    <dd className="text-stone-700">{impact.fundedProposals}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400 text-xs">Total funded</dt>
                    <dd className="text-stone-700">{fmtMoney(impact.totalFunded)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400 text-xs">Beneficiaries</dt>
                    <dd className="text-stone-700">{impact.beneficiaryCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400 text-xs">SDG goals</dt>
                    <dd className="text-stone-700">
                      {impact.sdgGoals.length > 0 ? impact.sdgGoals.join(", ") : "—"}
                    </dd>
                  </div>
                </dl>
              )}

              {/* Contribute — records against the fund; no wallet debit. */}
              <div className="border-t border-stone-100 pt-5 space-y-3">
                <h3 className="text-sm font-semibold text-stone-900">Contribute</h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Recording a contribution increases the fund's raised total and is
                  audit-logged. No wallet debit occurs in this flow.
                </p>
                <div className="flex items-center gap-3 max-w-md">
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    placeholder="Amount (USD)"
                    value={contribAmount}
                    onChange={(e) => setContribAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className={btnPrimaryCls}
                    disabled={contribBusy || !Number(contribAmount) || Number(contribAmount) <= 0}
                    onClick={() => void contribute()}
                  >
                    {contribBusy ? "Recording…" : "Contribute"}
                  </button>
                </div>
                {contribErr && (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {contribErr}
                  </div>
                )}
                {contribMsg && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {contribMsg}
                  </div>
                )}
              </div>

              {/* Proposals */}
              <div className="border-t border-stone-100 pt-5 space-y-4">
                <h3 className="text-sm font-semibold text-stone-900">
                  Proposals ({proposals.length})
                </h3>
                {proposalsLoading && <p className="text-sm text-stone-400">Loading proposals…</p>}
                {proposalsErr && (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {proposalsErr}
                  </div>
                )}
                {voteErr && (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {voteErr}
                  </div>
                )}
                {disburseMsg && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {disburseMsg}
                  </div>
                )}

                {proposals.map((p) => {
                  const vf = Number(p.votesFor ?? 0);
                  const va = Number(p.votesAgainst ?? 0);
                  const eligible = p.status === "approved" || vf >= QUORUM;
                  const actionable =
                    eligible && p.status !== "funded" && p.status !== "completed" && p.status !== "rejected";
                  const isMine = myUserId !== null && p.submittedByUserId === myUserId;
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-stone-100 p-5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-stone-900">{p.title}</h4>
                          <p className="text-xs text-stone-400">
                            {fmtMoney(p.requestedAmount, p.currency ?? "USD")}
                            {p.beneficiaryName ? ` · for ${p.beneficiaryName}` : ""}
                            {p.beneficiaryCountry ? ` (${p.beneficiaryCountry})` : ""} ·
                            submitted {fmtDate(p.createdAt)}
                            {p.votingDeadline ? ` · voting ends ${fmtDate(p.votingDeadline)}` : ""}
                          </p>
                        </div>
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusBadgeCls(p.status)}`}
                        >
                          {p.status}
                        </span>
                      </div>
                      {p.description && (
                        <p className="text-sm text-stone-600">{p.description}</p>
                      )}
                      {p.impactDescription && (
                        <p className="text-xs text-stone-500">
                          Expected impact: {p.impactDescription}
                        </p>
                      )}
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <p className="text-xs text-stone-500">
                          {vf} for / {va} against
                          {eligible && actionable ? ` · eligible for disbursement review` : ""}
                        </p>
                        <div className="flex items-center gap-2">
                          {(p.status === "voting" || p.status === "approved") && (
                            <>
                              <button
                                type="button"
                                className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 disabled:opacity-40"
                                disabled={voteBusyId === p.id}
                                onClick={() => void vote(p.id, "for")}
                              >
                                Vote for
                              </button>
                              <button
                                type="button"
                                className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-40"
                                disabled={voteBusyId === p.id}
                                onClick={() => void vote(p.id, "against")}
                              >
                                Vote against
                              </button>
                            </>
                          )}
                          {isMine && actionable && (
                            <button
                              type="button"
                              className="px-3 py-1 bg-white border border-stone-200 text-stone-700 rounded-lg text-xs font-medium hover:bg-stone-50 disabled:opacity-40"
                              disabled={disburseBusyId === p.id}
                              onClick={() => void requestDisbursement(p.id)}
                            >
                              {disburseBusyId === p.id
                                ? "Requesting…"
                                : "Request disbursement"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Submit proposal */}
                <div className="rounded-xl border border-dashed border-stone-200 p-5 space-y-4">
                  <h4 className="text-sm font-semibold text-stone-900">Submit a proposal</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        Title (min 5 characters)
                      </label>
                      <input
                        className={inputCls}
                        value={spTitle}
                        onChange={(e) => setSpTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        Requested amount (USD)
                      </label>
                      <input
                        className={inputCls}
                        inputMode="decimal"
                        value={spAmount}
                        onChange={(e) => setSpAmount(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        Beneficiary name (optional)
                      </label>
                      <input
                        className={inputCls}
                        value={spBeneficiaryName}
                        onChange={(e) => setSpBeneficiaryName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        Beneficiary country (optional)
                      </label>
                      <input
                        className={inputCls}
                        value={spBeneficiaryCountry}
                        onChange={(e) => setSpBeneficiaryCountry(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        Description (optional)
                      </label>
                      <textarea
                        className={inputCls}
                        rows={2}
                        value={spDescription}
                        onChange={(e) => setSpDescription(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        Expected impact (optional)
                      </label>
                      <textarea
                        className={inputCls}
                        rows={2}
                        value={spImpact}
                        onChange={(e) => setSpImpact(e.target.value)}
                      />
                    </div>
                  </div>
                  {spErr && (
                    <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {spErr}
                    </div>
                  )}
                  <button
                    type="button"
                    className={btnPrimaryCls}
                    disabled={spBusy || spTitle.trim().length < 5 || !(Number(spAmount) > 0)}
                    onClick={() => void submitProposal()}
                  >
                    {spBusy ? "Submitting…" : "Submit proposal"}
                  </button>
                </div>

                {/* Disbursement history — funded/completed proposals. */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-stone-900">
                    Disbursement history ({disbursementHistory.length})
                  </h4>
                  {disbursementHistory.length === 0 ? (
                    <p className="text-sm text-stone-400">
                      No proposals have been funded or completed for this fund yet.
                    </p>
                  ) : (
                    <div className="bg-white rounded-xl border border-stone-100 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                            <th className="px-4 py-2 font-medium">Proposal</th>
                            <th className="px-4 py-2 font-medium">Amount</th>
                            <th className="px-4 py-2 font-medium">Beneficiary</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium">Funded at</th>
                          </tr>
                        </thead>
                        <tbody>
                          {disbursementHistory.map((p) => (
                            <tr key={p.id} className="border-b border-stone-50">
                              <td className="px-4 py-2 text-stone-800">{p.title}</td>
                              <td className="px-4 py-2 text-stone-600">
                                {fmtMoney(p.requestedAmount, p.currency ?? "USD")}
                              </td>
                              <td className="px-4 py-2 text-stone-600">
                                {p.beneficiaryName ?? "—"}
                              </td>
                              <td className="px-4 py-2">
                                <span
                                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeCls(p.status)}`}
                                >
                                  {p.status}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-stone-500">
                                {p.fundedAt ? fmtDateTime(p.fundedAt) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {tab === "myvotes" && (
        <section className="space-y-4">
          {myVotesLoading && <p className="text-sm text-stone-400">Loading your votes…</p>}
          {myVotesErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {myVotesErr}
            </div>
          )}
          {!myVotesLoading && !myVotesErr && myVotes.length === 0 && (
            <p className="text-sm text-stone-400">You have not voted on any proposals yet.</p>
          )}
          {myVotes.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                    <th className="px-5 py-3 font-medium">Proposal</th>
                    <th className="px-5 py-3 font-medium">Fund</th>
                    <th className="px-5 py-3 font-medium">Vote</th>
                    <th className="px-5 py-3 font-medium">Comment</th>
                    <th className="px-5 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {myVotes.map((v) => (
                    <tr key={v.id} className="border-b border-stone-50">
                      <td className="px-5 py-3 text-stone-800">{v.proposalTitle ?? "—"}</td>
                      <td className="px-5 py-3 text-stone-600">{v.fundName ?? "—"}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            v.vote === "for"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-600"
                          }`}
                        >
                          {v.vote}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-stone-600">{v.comment ?? "—"}</td>
                      <td className="px-5 py-3 text-stone-500">{fmtDateTime(v.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "leaderboard" && (
        <section className="space-y-6">
          {leaderboardErr && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {leaderboardErr}
            </div>
          )}
          {!leaderboard && !leaderboardErr && (
            <p className="text-sm text-stone-400">Loading leaderboard…</p>
          )}
          {leaderboard && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white rounded-2xl border border-stone-100 p-6">
                <h2 className="text-base font-semibold text-stone-900 mb-4">Top voters</h2>
                {leaderboard.topVoters.length === 0 ? (
                  <p className="text-sm text-stone-400">No votes yet.</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {leaderboard.topVoters.map((e) => (
                      <li key={e.userId} className="flex justify-between">
                        <span className="text-stone-700">
                          {e.rank}. {e.name}
                        </span>
                        <span className="text-stone-500">{e.votes ?? 0} votes</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="bg-white rounded-2xl border border-stone-100 p-6">
                <h2 className="text-base font-semibold text-stone-900 mb-4">Top proposers</h2>
                {leaderboard.topProposers.length === 0 ? (
                  <p className="text-sm text-stone-400">No proposals yet.</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {leaderboard.topProposers.map((e) => (
                      <li key={e.userId} className="flex justify-between">
                        <span className="text-stone-700">
                          {e.rank}. {e.name}
                        </span>
                        <span className="text-stone-500">{e.total ?? 0} proposals</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default Community;
