/**
 * wave17 C1 (SPEC-wave17, rn-invest) — Community funds RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/Community.tsx, backed by the inline
 * `community` router (server/routers.ts:6537). Wired here (user-role only):
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
 * Honesty (identical to PWA): `community.contribute` records the contribution
 * against the fund (counter + audit log); it does NOT debit a wallet — the UI
 * states this.
 * Proc names grep-verified against audit/routers.json (mounted, non-legacy).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { trpc } from '../../services/trpc';
import { useAuth } from '../../contexts/AuthContext';
import {
  ErrorBanner,
  InvestHeader,
  LabeledInput,
  StatusBadge,
  SuccessNote,
  TabBar,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  investErrMsg,
  styles,
} from './common';

type Tab = 'funds' | 'myvotes' | 'leaderboard';

/** Quorum used server-side for vote milestones / disbursement eligibility. */
const QUORUM = 10;

/** Live vote tally for one proposal (community.liveVotes, public query). */
function LiveVoteTally({ proposalId }: { proposalId: number }) {
  const q = trpc.community.liveVotes.useQuery({ proposalId });
  if (q.isLoading) return <Text style={styles.textDim}>live tally: loading…</Text>;
  if (q.error) return <Text style={styles.textDim}>live tally unavailable: {investErrMsg(q.error)}</Text>;
  if (!q.data) return null;
  return (
    <Text style={styles.textDim}>
      live tally: {q.data.votesFor} for / {q.data.votesAgainst} against ({q.data.total} total)
    </Text>
  );
}

/** Proposals + submit form + contribute for the selected fund. */
function FundDetail({
  fund,
  myUserId,
  onClose,
  onFundsChanged,
}: {
  fund: any;
  myUserId: number | null;
  onClose: () => void;
  onFundsChanged: () => void;
}) {
  const proposalsQ = trpc.community.listProposals.useQuery({ fundId: fund.id });
  const impactQ = trpc.community.getImpactMetrics.useQuery({ fundId: fund.id });

  // Contribute
  const [contribAmount, setContribAmount] = useState('');
  const [contribErr, setContribErr] = useState<string | null>(null);
  const [contribMsg, setContribMsg] = useState<string | null>(null);

  // Submit proposal
  const [spTitle, setSpTitle] = useState('');
  const [spAmount, setSpAmount] = useState('');
  const [spBeneficiaryName, setSpBeneficiaryName] = useState('');
  const [spBeneficiaryCountry, setSpBeneficiaryCountry] = useState('');
  const [spDescription, setSpDescription] = useState('');
  const [spImpact, setSpImpact] = useState('');
  const [spErr, setSpErr] = useState<string | null>(null);

  // Vote / disbursement
  const [voteErr, setVoteErr] = useState<string | null>(null);
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null);
  const [voteBusyId, setVoteBusyId] = useState<number | null>(null);
  const [disburseBusyId, setDisburseBusyId] = useState<number | null>(null);

  const contributeMutation = trpc.community.contribute.useMutation({
    onSuccess: async (res: any) => {
      setContribMsg(`Contribution of ${fmtMoney(res.amount)} recorded against this fund (no wallet debit occurs in this flow).`);
      setContribAmount('');
      onFundsChanged();
      impactQ.refetch();
    },
    onError: (e: unknown) => setContribErr(investErrMsg(e)),
  });
  const proposalMutation = trpc.community.submitProposal.useMutation({
    onSuccess: () => {
      setSpTitle('');
      setSpAmount('');
      setSpBeneficiaryName('');
      setSpBeneficiaryCountry('');
      setSpDescription('');
      setSpImpact('');
      proposalsQ.refetch();
    },
    onError: (e: unknown) => setSpErr(investErrMsg(e)),
  });
  const voteMutation = trpc.community.vote.useMutation({
    onSuccess: () => {
      setVoteBusyId(null);
      proposalsQ.refetch();
    },
    onError: (e: unknown) => {
      setVoteErr(investErrMsg(e));
      setVoteBusyId(null);
    },
  });
  const disburseMutation = trpc.community.requestDisbursement.useMutation({
    onSuccess: () => {
      setDisburseMsg(
        'Disbursement requested — the proposal now awaits administrator review. Approval and payout are performed by platform administrators, not here.',
      );
      setDisburseBusyId(null);
      proposalsQ.refetch();
    },
    onError: (e: unknown) => {
      setVoteErr(investErrMsg(e));
      setDisburseBusyId(null);
    },
  });

  const contribute = () => {
    const amount = Number(contribAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setContribErr(null);
    setContribMsg(null);
    contributeMutation.mutate({ fundId: fund.id, amount });
  };

  const submitProposal = () => {
    const amount = Number(spAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSpErr(null);
    proposalMutation.mutate({
      fundId: fund.id,
      title: spTitle.trim(),
      description: spDescription.trim() || undefined,
      requestedAmount: amount,
      currency: 'USD',
      beneficiaryName: spBeneficiaryName.trim() || undefined,
      beneficiaryCountry: spBeneficiaryCountry.trim() || undefined,
      impactDescription: spImpact.trim() || undefined,
    });
  };

  const proposals: any[] = proposalsQ.data ?? [];
  const disbursementHistory = proposals.filter((p) => p.status === 'funded' || p.status === 'completed');
  const impact = impactQ.data;

  return (
    <View style={[styles.card, styles.cardSelected]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{fund.name}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.linkText}>Close</Text>
        </TouchableOpacity>
      </View>

      {impact ? (
        <View style={[styles.statGrid, { marginTop: 10 }]}>
          {[
            ['Funded proposals', String(impact.fundedProposals)],
            ['Total funded', fmtMoney(impact.totalFunded)],
            ['Beneficiaries', String(impact.beneficiaryCount ?? 0)],
            ['SDG goals', impact.sdgGoals.length > 0 ? impact.sdgGoals.join(', ') : '—'],
          ].map(([label, value]) => (
            <View key={label} style={styles.statCell}>
              <Text style={styles.statLabel}>{label}</Text>
              <Text style={styles.statValue}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Contribute — records against the fund; no wallet debit. */}
      <View style={[styles.divider, { paddingTop: 12 }]}>
        <Text style={styles.sectionTitle}>Contribute</Text>
        <Text style={[styles.textMuted, { lineHeight: 17 }]}>
          Recording a contribution increases the fund's raised total and is attributed to your
          account. It does not debit your wallet in this flow.
        </Text>
        <LabeledInput label="Amount (USD)" value={contribAmount} onChange={(v) => setContribAmount(v.replace(/[^\d.]/g, ''))} numeric placeholder="0.00" />
        <ErrorBanner message={contribErr} />
        <SuccessNote message={contribMsg} />
        <TouchableOpacity
          style={[styles.btn, (contributeMutation.isPending || !contribAmount || Number(contribAmount) <= 0) && styles.btnDisabled]}
          disabled={contributeMutation.isPending || !contribAmount || Number(contribAmount) <= 0}
          onPress={contribute}
        >
          <Text style={styles.btnText}>{contributeMutation.isPending ? 'Recording…' : 'Record contribution'}</Text>
        </TouchableOpacity>
      </View>

      {/* Proposals */}
      <View style={[styles.divider, { paddingTop: 12 }]}>
        <Text style={styles.sectionTitle}>Proposals</Text>
        <ErrorBanner message={proposalsQ.error ? investErrMsg(proposalsQ.error) : null} />
        <ErrorBanner message={voteErr} />
        <SuccessNote message={disburseMsg} />
        {proposalsQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 10 }} /> : null}
        {!proposalsQ.isLoading && !proposalsQ.error && proposals.length === 0 && (
          <Text style={[styles.textMuted, { marginTop: 6 }]}>No proposals on this fund yet.</Text>
        )}
        {proposals.map((p) => {
          const vf = Number(p.votesFor ?? 0);
          const va = Number(p.votesAgainst ?? 0);
          const eligible = p.status === 'approved' || vf >= QUORUM;
          const actionable = eligible && p.status !== 'funded' && p.status !== 'completed' && p.status !== 'rejected';
          const isMine = myUserId !== null && p.submittedByUserId === myUserId;
          return (
            <View key={p.id} style={[styles.card, { backgroundColor: '#12122a', marginTop: 10 }]}>
              <View style={styles.rowBetween}>
                <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{p.title}</Text>
                <StatusBadge status={p.status} />
              </View>
              <Text style={[styles.textDim, { marginTop: 4 }]}>
                {fmtMoney(p.requestedAmount, p.currency ?? 'USD')}
                {p.beneficiaryName ? ` · for ${p.beneficiaryName}` : ''}
                {p.beneficiaryCountry ? ` (${p.beneficiaryCountry})` : ''} · submitted {fmtDate(p.createdAt)}
                {p.votingDeadline ? ` · voting ends ${fmtDate(p.votingDeadline)}` : ''}
              </Text>
              {p.description ? <Text style={[styles.textBody, { marginTop: 6 }]}>{p.description}</Text> : null}
              {p.impactDescription ? (
                <Text style={[styles.textMuted, { marginTop: 4 }]}>Expected impact: {p.impactDescription}</Text>
              ) : null}
              <View style={{ marginTop: 6 }}>
                <Text style={styles.textMuted}>
                  {vf} for / {va} against
                  {eligible && actionable ? ' · eligible for disbursement review' : ''}
                </Text>
                <LiveVoteTally proposalId={p.id} />
              </View>
              <View style={[styles.row, { gap: 8, marginTop: 8, flexWrap: 'wrap' }]}>
                {(p.status === 'voting' || p.status === 'approved') && (
                  <>
                    <TouchableOpacity
                      style={[styles.btnSecondary, { marginTop: 0, paddingVertical: 7, paddingHorizontal: 12 }, voteBusyId === p.id && styles.btnDisabled]}
                      disabled={voteBusyId === p.id}
                      onPress={() => {
                        setVoteBusyId(p.id);
                        setVoteErr(null);
                        voteMutation.mutate({ proposalId: p.id, vote: 'for' });
                      }}
                    >
                      <Text style={[styles.btnText, { color: '#34d399' }]}>Vote for</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btnSecondary, { marginTop: 0, paddingVertical: 7, paddingHorizontal: 12 }, voteBusyId === p.id && styles.btnDisabled]}
                      disabled={voteBusyId === p.id}
                      onPress={() => {
                        setVoteBusyId(p.id);
                        setVoteErr(null);
                        voteMutation.mutate({ proposalId: p.id, vote: 'against' });
                      }}
                    >
                      <Text style={[styles.btnText, { color: '#f87171' }]}>Vote against</Text>
                    </TouchableOpacity>
                  </>
                )}
                {isMine && actionable && (
                  <TouchableOpacity
                    style={[styles.btnSecondary, { marginTop: 0, paddingVertical: 7, paddingHorizontal: 12 }, disburseBusyId === p.id && styles.btnDisabled]}
                    disabled={disburseBusyId === p.id}
                    onPress={() => {
                      setDisburseBusyId(p.id);
                      setVoteErr(null);
                      setDisburseMsg(null);
                      disburseMutation.mutate({ proposalId: p.id, disbursementMethod: 'wallet' });
                    }}
                  >
                    <Text style={styles.btnText}>{disburseBusyId === p.id ? 'Requesting…' : 'Request disbursement'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {/* Submit proposal */}
        <View style={[styles.card, { borderStyle: 'dashed', marginTop: 10 }]}>
          <Text style={styles.sectionTitle}>Submit a proposal</Text>
          <LabeledInput label="Title (min 5 characters)" value={spTitle} onChange={setSpTitle} />
          <LabeledInput label="Requested amount (USD)" value={spAmount} onChange={(v) => setSpAmount(v.replace(/[^\d.]/g, ''))} numeric />
          <LabeledInput label="Beneficiary name (optional)" value={spBeneficiaryName} onChange={setSpBeneficiaryName} />
          <LabeledInput label="Beneficiary country (optional)" value={spBeneficiaryCountry} onChange={setSpBeneficiaryCountry} />
          <LabeledInput label="Description (optional)" value={spDescription} onChange={setSpDescription} multiline />
          <LabeledInput label="Expected impact (optional)" value={spImpact} onChange={setSpImpact} multiline />
          <ErrorBanner message={spErr} />
          <TouchableOpacity
            style={[styles.btn, (proposalMutation.isPending || spTitle.trim().length < 5 || !spAmount || Number(spAmount) <= 0) && styles.btnDisabled]}
            disabled={proposalMutation.isPending || spTitle.trim().length < 5 || !spAmount || Number(spAmount) <= 0}
            onPress={submitProposal}
          >
            <Text style={styles.btnText}>{proposalMutation.isPending ? 'Submitting…' : 'Submit proposal'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Disbursement history */}
      {disbursementHistory.length > 0 && (
        <View style={[styles.divider, { paddingTop: 12 }]}>
          <Text style={styles.sectionTitle}>Disbursement history</Text>
          <Text style={[styles.textDim, { lineHeight: 15 }]}>
            Funded and completed proposals — approval and payout are performed by platform
            administrators.
          </Text>
          {disbursementHistory.map((p) => (
            <View key={p.id} style={[styles.rowBetween, { marginTop: 8 }]}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.textBody}>{p.title}</Text>
                <Text style={styles.textDim}>
                  {p.beneficiaryName ?? '—'} · funded {p.fundedAt ? fmtDateTime(p.fundedAt) : '—'}
                </Text>
              </View>
              <Text style={styles.textMain}>{fmtMoney(p.requestedAmount, p.currency ?? 'USD')}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function CommunityScreen() {
  const { user } = useAuth();
  const myUserId = user?.id ? Number(user.id) : null;

  const [tab, setTab] = useState<Tab>('funds');
  const [selectedFund, setSelectedFund] = useState<any | null>(null);

  // Create fund
  const [showCreate, setShowCreate] = useState(false);
  const [cfName, setCfName] = useState('');
  const [cfDescription, setCfDescription] = useState('');
  const [cfCountry, setCfCountry] = useState('');
  const [cfTheme, setCfTheme] = useState('');
  const [cfGoal, setCfGoal] = useState('');
  const [cfErr, setCfErr] = useState<string | null>(null);

  const fundsQ = trpc.community.listFunds.useQuery(undefined, { enabled: tab === 'funds' });
  const myVotesQ = trpc.community.listMyVotes.useQuery(undefined, { enabled: tab === 'myvotes' });
  const leaderboardQ = trpc.community.communityLeaderboard.useQuery(undefined, { enabled: tab === 'leaderboard' });

  const createFundMutation = trpc.community.createFund.useMutation({
    onSuccess: () => {
      setShowCreate(false);
      setCfName('');
      setCfDescription('');
      setCfCountry('');
      setCfTheme('');
      setCfGoal('');
      fundsQ.refetch();
    },
    onError: (e: unknown) => setCfErr(investErrMsg(e)),
  });

  const createFund = () => {
    const goal = cfGoal.trim() ? Number(cfGoal) : undefined;
    setCfErr(null);
    createFundMutation.mutate({
      name: cfName.trim(),
      description: cfDescription.trim() || undefined,
      country: cfCountry.trim() || undefined,
      theme: cfTheme.trim() || undefined,
      goalAmount: goal && Number.isFinite(goal) ? goal : undefined,
      currency: 'USD',
      sdgGoals: [],
    });
  };

  return (
    <View style={styles.container}>
      <InvestHeader title="Community funds" />
      <TabBar<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'funds', label: 'Funds' },
          { key: 'myvotes', label: 'My votes' },
          { key: 'leaderboard', label: 'Leaderboard' },
        ]}
      />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        <Text style={[styles.textMuted, { marginBottom: 12, lineHeight: 18 }]}>
          Pool funds with the community, propose projects, and vote on how pooled money is used.
          Disbursements are approved by platform administrators; funded and completed proposals
          form the public disbursement history.
        </Text>

        {tab === 'funds' && (
          <View>
            <TouchableOpacity style={styles.btnSecondary} onPress={() => setShowCreate((v) => !v)}>
              <Text style={styles.btnText}>{showCreate ? 'Cancel' : 'Create a fund'}</Text>
            </TouchableOpacity>

            {showCreate && (
              <View style={[styles.card, { marginTop: 10 }]}>
                <Text style={styles.sectionTitle}>New community fund</Text>
                <LabeledInput label="Name (min 3 characters)" value={cfName} onChange={setCfName} />
                <LabeledInput label="Description (optional)" value={cfDescription} onChange={setCfDescription} multiline />
                <LabeledInput label="Country (optional)" value={cfCountry} onChange={setCfCountry} />
                <LabeledInput label="Theme (optional)" value={cfTheme} onChange={setCfTheme} />
                <LabeledInput label="Goal amount (USD, optional)" value={cfGoal} onChange={(v) => setCfGoal(v.replace(/[^\d.]/g, ''))} numeric />
                <ErrorBanner message={cfErr} />
                <TouchableOpacity
                  style={[styles.btn, (createFundMutation.isPending || cfName.trim().length < 3) && styles.btnDisabled]}
                  disabled={createFundMutation.isPending || cfName.trim().length < 3}
                  onPress={createFund}
                >
                  <Text style={styles.btnText}>{createFundMutation.isPending ? 'Creating…' : 'Create fund'}</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ marginTop: 12 }}>
              <ErrorBanner message={fundsQ.error ? investErrMsg(fundsQ.error) : null} />
            </View>
            {fundsQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!fundsQ.isLoading && !fundsQ.error && (fundsQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>No active community funds yet.</Text>
            )}

            {(fundsQ.data ?? []).map((f: any) => {
              const goal = f.goalAmount ? Number(f.goalAmount) : null;
              const raised = Number(f.totalRaised ?? 0);
              const pct = goal && goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.card, selectedFund?.id === f.id && styles.cardSelected]}
                  onPress={() => setSelectedFund(selectedFund?.id === f.id ? null : f)}
                >
                  <View style={styles.rowBetween}>
                    <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{f.name}</Text>
                    <StatusBadge status={f.status} />
                  </View>
                  {f.description ? (
                    <Text style={[styles.textMuted, { marginTop: 4 }]} numberOfLines={2}>{f.description}</Text>
                  ) : null}
                  <Text style={[styles.textDim, { marginTop: 4 }]}>
                    {[f.theme, f.country].filter(Boolean).join(' · ') || 'General'}
                    {f.sdgGoals.length > 0 ? ` · SDG ${f.sdgGoals.join(', ')}` : ''}
                  </Text>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <View>
                      <Text style={styles.textDim}>Raised</Text>
                      <Text style={styles.textMain}>{fmtMoney(f.totalRaised ?? '0', f.currency ?? 'USD')}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Goal</Text>
                      <Text style={styles.textMain}>{f.goalAmount ? fmtMoney(f.goalAmount, f.currency ?? 'USD') : '—'}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Contributors</Text>
                      <Text style={styles.textMain}>{f.contributorCount ?? 0}</Text>
                    </View>
                  </View>
                  {pct !== null && (
                    <View>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={[styles.textDim, { marginTop: 4 }]}>{pct}% of goal</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

            {selectedFund && (
              <FundDetail
                fund={selectedFund}
                myUserId={myUserId}
                onClose={() => setSelectedFund(null)}
                onFundsChanged={() => fundsQ.refetch()}
              />
            )}
          </View>
        )}

        {tab === 'myvotes' && (
          <View>
            <ErrorBanner message={myVotesQ.error ? investErrMsg(myVotesQ.error) : null} />
            {myVotesQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!myVotesQ.isLoading && !myVotesQ.error && (myVotesQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>You have not voted on any proposals yet.</Text>
            )}
            {(myVotesQ.data ?? []).map((v: any) => (
              <View key={v.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.textMain}>{v.proposalTitle ?? `Proposal #${v.proposalId}`}</Text>
                    <Text style={styles.textDim}>
                      {v.fundName ?? '—'} · {fmtDateTime(v.createdAt)}
                    </Text>
                  </View>
                  <StatusBadge status={v.vote === 'for' ? 'approved' : 'rejected'} />
                </View>
                <Text style={[styles.textMuted, { marginTop: 4 }]}>
                  You voted <Text style={{ fontWeight: '700' }}>{v.vote}</Text>
                  {v.comment ? ` — ${v.comment}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {tab === 'leaderboard' && (
          <View>
            <ErrorBanner message={leaderboardQ.error ? investErrMsg(leaderboardQ.error) : null} />
            {leaderboardQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {leaderboardQ.data ? (
              <View>
                {(
                  [
                    ['Top voters', leaderboardQ.data.topVoters, 'votes'],
                    ['Top contributors', leaderboardQ.data.topContributors, 'total'],
                    ['Top proposers', leaderboardQ.data.topProposers, 'funded'],
                  ] as Array<[string, any[], string]>
                ).map(([heading, entries, metric]) => (
                  <View key={heading} style={styles.card}>
                    <Text style={styles.sectionTitle}>{heading}</Text>
                    {entries.length === 0 ? (
                      <Text style={[styles.textMuted, { marginTop: 6 }]}>No entries yet.</Text>
                    ) : (
                      entries.map((e: any) => (
                        <View key={`${heading}-${e.userId}`} style={[styles.rowBetween, { marginTop: 8 }]}>
                          <Text style={styles.textBody}>
                            #{e.rank} {e.name}
                          </Text>
                          <Text style={styles.textMuted}>
                            {metric === 'votes' ? `${e.votes ?? 0} votes` : metric === 'total' ? fmtMoney(e.total ?? 0) : `${e.funded ?? 0} funded`}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
