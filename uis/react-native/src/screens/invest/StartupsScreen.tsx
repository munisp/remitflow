/**
 * wave17 C1 (SPEC-wave17, rn-invest) — Startup deals RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/Startups.tsx, backed by the mounted
 * `startups` router (server/routers/investment.ts):
 *   - listDeals / getDeal  — browse curated deals (public)
 *   - commit               — invest (tier-2 KYC + TOTP step-up + guarded wallet
 *                            debit when paymentMethod=wallet — all server-side,
 *                            fail-closed; this UI only surfaces them)
 *   - getMyInvestments     — portfolio
 *   - signAgreement        — user-role audited mutation for unsigned commitments
 *
 * Admin-only `startups.confirmCustody` is intentionally NOT exposed here.
 * Honesty (identical to PWA): wallet-funded commitments are `pending_acquisition`
 * (custody not yet confirmed); bank_transfer/card commitments are recorded as
 * `pending` — no wallet debit occurs for those methods in this flow, and the
 * UI says so.
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
  TabBar,
  TotpField,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtPct,
  holdingStatusLabel,
  investErrMsg,
  statusBadgeColors,
  styles,
} from './common';

type Tab = 'deals' | 'portfolio';
type PaymentMethod = 'wallet' | 'bank_transfer' | 'card';

const STAGE_SUGGESTIONS = ['idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'growth'];

// ── Deal detail + commit panel (mounted only when a deal is opened) ──────────

function DealDetail({ dealId, onClose, onChanged }: { dealId: number; onClose: () => void; onChanged: () => void }) {
  const detailQ = trpc.startups.getDeal.useQuery({ id: dealId });
  const selected = detailQ.data;

  const [amountUsd, setAmountUsd] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wallet');
  const [notes, setNotes] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const commitMutation = trpc.startups.commit.useMutation({
    onSuccess: async (res: any) => {
      // Server honesty note (W7/B8): commitment recorded but asset custody is
      // pending — surface verbatim.
      setActionMsg(
        `Commitment #${res.id} recorded (${fmtMoney(res.amountUsd)}, ${res.instrumentType}${
          res.equityPct ? `, ~${fmtPct(res.equityPct)} equity` : ''
        }). ${res.note}`,
      );
      setTotpCode('');
      setAmountUsd('');
      setNotes('');
      await detailQ.refetch();
      onChanged();
    },
    onError: (e: unknown) => setActionErr(investErrMsg(e)),
  });

  const amount = Number(amountUsd);
  const minTicket = selected ? Number(selected.minimumTicketUsd) : 0;

  return (
    <View style={[styles.card, styles.cardSelected]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{selected?.companyName ?? `Deal #${dealId}`}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.linkText}>Close</Text>
        </TouchableOpacity>
      </View>
      {detailQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 12 }} /> : null}
      <ErrorBanner message={detailQ.error ? investErrMsg(detailQ.error) : null} />
      {selected ? (
        <View style={{ marginTop: 10 }}>
          {selected.tagline ? <Text style={[styles.textMuted, { fontStyle: 'italic' }]}>{selected.tagline}</Text> : null}
          <Text style={[styles.textBody, { marginTop: 6 }]}>{selected.description}</Text>

          <View style={[styles.statGrid, { marginTop: 10 }]}>
            {[
              ['Valuation', fmtMoney(selected.valuationUsd)],
              ['Equity offered', fmtPct(selected.equityOfferedPct)],
              ['Instrument', selected.instrumentType],
              ['Min. ticket', fmtMoney(selected.minimumTicketUsd)],
              ['Founded', String(selected.foundedYear ?? '—')],
              ['Team size', String(selected.teamSize ?? '—')],
              ['Closing date', fmtDate(selected.closingDate)],
            ].map(([label, value]) => (
              <View key={label} style={styles.statCell}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>

          {selected.websiteUrl || selected.pitchDeckUrl ? (
            <View style={[styles.row, { gap: 16, marginTop: 8 }]}>
              {selected.websiteUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(selected.websiteUrl)}>
                  <Text style={styles.linkText}>Website</Text>
                </TouchableOpacity>
              ) : null}
              {selected.pitchDeckUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(selected.pitchDeckUrl)}>
                  <Text style={styles.linkText}>Pitch deck</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {(selected.highlights ?? []).length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Highlights</Text>
              {selected.highlights.map((h: string, i: number) => (
                <Text key={i} style={styles.textMuted}>• {h}</Text>
              ))}
            </View>
          ) : null}
          {(selected.risks ?? []).length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Risks (as declared)</Text>
              {selected.risks.map((r: string, i: number) => (
                <Text key={i} style={styles.textMuted}>• {r}</Text>
              ))}
            </View>
          ) : null}
          {(selected.metrics ?? []).length > 0 ? (
            <View style={[styles.statGrid, { marginTop: 10 }]}>
              {selected.metrics.map((m: any, i: number) => (
                <View key={i} style={styles.statCell}>
                  <Text style={styles.statLabel}>{m.label}</Text>
                  <Text style={styles.statValue}>{m.value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {selected.status === 'open' ? (
            <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#2d2d4e', paddingTop: 12 }}>
              <Text style={styles.sectionTitle}>Commit funds</Text>
              <LabeledInput
                label={`Amount (USD, min ${fmtMoney(selected.minimumTicketUsd)})`}
                value={amountUsd}
                onChange={(v) => setAmountUsd(v.replace(/[^\d.]/g, ''))}
                numeric
                placeholder="0.00"
              />
              <Text style={[styles.label, { marginTop: 10 }]}>Payment method</Text>
              <ChipSelector<PaymentMethod>
                value={paymentMethod}
                onChange={setPaymentMethod}
                options={[
                  { value: 'wallet', label: 'USD wallet (debited now, 2FA)' },
                  { value: 'bank_transfer', label: 'Bank transfer (recorded, not debited)' },
                  { value: 'card', label: 'Card (recorded, not debited)' },
                ]}
              />
              <TotpField value={totpCode} onChange={setTotpCode} />
              <LabeledInput label="Notes (optional)" value={notes} onChange={setNotes} multiline />

              {paymentMethod !== 'wallet' && (
                <Text style={[styles.textMuted, { marginTop: 8, lineHeight: 17 }]}>
                  With {paymentMethod === 'bank_transfer' ? 'bank transfer' : 'card'}, the commitment is recorded as{' '}
                  <Text style={{ fontStyle: 'italic' }}>pending</Text> — no wallet debit occurs in this flow.
                </Text>
              )}

              <TouchableOpacity
                style={[styles.btn, (commitMutation.isPending || !Number.isFinite(amount) || amount < 100) && styles.btnDisabled]}
                disabled={commitMutation.isPending || !Number.isFinite(amount) || amount < 100}
                onPress={() => {
                  setActionErr(null);
                  setActionMsg(null);
                  commitMutation.mutate({
                    dealId: selected.id,
                    amountUsd: amount,
                    paymentMethod,
                    notes: notes.trim() || undefined,
                    totpCode: totpCode.trim() || undefined,
                  });
                }}
              >
                <Text style={styles.btnText}>
                  {commitMutation.isPending ? 'Processing...' : `Commit ${Number.isFinite(amount) && amount > 0 ? fmtMoney(amount) : 'funds'}`}
                </Text>
              </TouchableOpacity>
              {Number.isFinite(amount) && amount > 0 && amount < minTicket ? (
                <Text style={[styles.warnText, { marginTop: 6 }]}>
                  Below this deal's minimum ticket of {fmtMoney(selected.minimumTicketUsd)} — the server will reject it.
                </Text>
              ) : null}

              <View style={{ marginTop: 10 }}>
                <ErrorBanner message={actionErr} />
                <SuccessNote message={actionMsg} />
              </View>
            </View>
          ) : (
            <Text style={[styles.textMuted, { marginTop: 12 }]}>
              This deal is not open for investment (status: {selected.status}).
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function StartupsScreen() {
  const [tab, setTab] = useState<Tab>('deals');
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [stage, setStage] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [signBusyId, setSignBusyId] = useState<number | null>(null);

  const dealsQ = trpc.startups.listDeals.useQuery(
    { search: search.trim() || undefined, sector: sector.trim() || undefined, stage: stage.trim() || undefined, status: statusFilter || undefined, limit: 50 },
    { enabled: tab === 'deals' },
  );
  const portfolioQ = trpc.startups.getMyInvestments.useQuery(undefined, { enabled: tab === 'portfolio' });

  const signMutation = trpc.startups.signAgreement.useMutation({
    onSuccess: () => {
      setSignBusyId(null);
      portfolioQ.refetch();
    },
    onError: (e: unknown) => {
      setSignErr(investErrMsg(e));
      setSignBusyId(null);
    },
  });

  const raisedPct = (d: any) => {
    const target = Number(d.targetRaiseUsd);
    const raised = Number(d.raisedSoFarUsd ?? 0);
    return target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
  };

  return (
    <View style={styles.container}>
      <InvestHeader title="Startup investments" />
      <TabBar<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'deals', label: 'Curated deals' },
          { key: 'portfolio', label: 'My portfolio' },
        ]}
      />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        <Text style={[styles.textMuted, { marginBottom: 12, lineHeight: 18 }]}>
          Curated private deals. Committing with the wallet method debits your USD wallet (tier-2
          verification and 2FA enforced server-side); commitments remain{' '}
          <Text style={{ fontStyle: 'italic' }}>pending acquisition</Text> until asset custody is
          confirmed.
        </Text>

        {tab === 'deals' && (
          <View>
            <LabeledInput label="Search" value={search} onChange={setSearch} placeholder="Company or sector…" />
            <LabeledInput label="Sector (optional)" value={sector} onChange={setSector} placeholder="Any" />
            <Text style={[styles.label, { marginTop: 10 }]}>Stage</Text>
            <View style={styles.chipRow}>
              {['', ...STAGE_SUGGESTIONS].map((st) => (
                <TouchableOpacity key={st || 'any'} style={[styles.chip, stage === st && styles.chipActive]} onPress={() => setStage(st)}>
                  <Text style={[styles.chipText, stage === st && styles.chipTextActive]}>{st || 'Any'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.label, { marginTop: 10 }]}>Status</Text>
            <View style={styles.chipRow}>
              {[
                { v: 'open', l: 'Open' },
                { v: 'funded', l: 'Funded' },
                { v: 'closed', l: 'Closed' },
                { v: '', l: 'Any' },
              ].map((o) => (
                <TouchableOpacity key={o.l} style={[styles.chip, statusFilter === o.v && styles.chipActive]} onPress={() => setStatusFilter(o.v)}>
                  <Text style={[styles.chipText, statusFilter === o.v && styles.chipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 12 }}>
              <ErrorBanner message={dealsQ.error ? investErrMsg(dealsQ.error) : null} />
            </View>
            {dealsQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!dealsQ.isLoading && !dealsQ.error && (dealsQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>No deals match these filters.</Text>
            )}

            {(dealsQ.data ?? []).map((d: any) => {
              const pct = raisedPct(d);
              return (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.card, selectedId === d.id && styles.cardSelected]}
                  onPress={() => setSelectedId(selectedId === d.id ? null : d.id)}
                >
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.textMain}>{d.companyName}</Text>
                      {d.tagline ? <Text style={[styles.textMuted, { marginTop: 2 }]}>{d.tagline}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {d.isFeatured ? <Badge label="featured" color="#f59e0b" bg="rgba(245,158,11,0.12)" /> : null}
                      <StatusBadge status={d.status} />
                    </View>
                  </View>
                  <Text style={[styles.textDim, { marginTop: 6 }]}>
                    {d.sector} · {d.stage} · {d.location} · {d.instrumentType}
                  </Text>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <View>
                      <Text style={styles.textDim}>Raised</Text>
                      <Text style={styles.textMain}>{fmtMoney(d.raisedSoFarUsd ?? '0')}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Target</Text>
                      <Text style={styles.textMain}>{fmtMoney(d.targetRaiseUsd)}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Min. ticket</Text>
                      <Text style={styles.textMain}>{fmtMoney(d.minimumTicketUsd)}</Text>
                    </View>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={[styles.textDim, { marginTop: 4 }]}>{pct}% raised</Text>
                </TouchableOpacity>
              );
            })}

            {selectedId !== null && (
              <DealDetail
                dealId={selectedId}
                onClose={() => setSelectedId(null)}
                onChanged={() => {
                  dealsQ.refetch();
                  portfolioQ.refetch();
                }}
              />
            )}
          </View>
        )}

        {tab === 'portfolio' && (
          <View>
            <ErrorBanner message={portfolioQ.error ? investErrMsg(portfolioQ.error) : null} />
            <ErrorBanner message={signErr} />
            {portfolioQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!portfolioQ.isLoading && !portfolioQ.error && (portfolioQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>You have no startup investments yet.</Text>
            )}
            {(portfolioQ.data ?? []).map((inv: any) => {
              const c = statusBadgeColors(inv.status);
              return (
                <View key={inv.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.textMain}>{inv.companyName}</Text>
                      <Text style={styles.textDim}>
                        {inv.sector} · {inv.stage} · deal {inv.dealStatus}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: c.bg }]}>
                      <Text style={[styles.badgeText, { color: c.fg }]}>{holdingStatusLabel(inv.status)}</Text>
                    </View>
                  </View>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <View>
                      <Text style={styles.textDim}>Amount</Text>
                      <Text style={styles.textMain}>{fmtMoney(inv.amountUsd)}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Instrument</Text>
                      <Text style={styles.textMain}>{inv.instrumentType}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Equity</Text>
                      <Text style={styles.textMain}>{inv.equityPct ? fmtPct(inv.equityPct) : '—'}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Payment</Text>
                      <Text style={styles.textMain}>{inv.paymentMethod}</Text>
                    </View>
                  </View>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <Text style={styles.textDim}>Invested at {fmtDate(inv.investedAt)}</Text>
                    {inv.agreementSigned ? (
                      <Badge label="signed" color="#10b981" bg="rgba(16,185,129,0.12)" />
                    ) : (
                      <TouchableOpacity
                        style={[styles.btnSecondary, { marginTop: 0, paddingVertical: 8, paddingHorizontal: 14 }, signBusyId === inv.id && styles.btnDisabled]}
                        disabled={signBusyId === inv.id}
                        onPress={() => {
                          setSignBusyId(inv.id);
                          setSignErr(null);
                          signMutation.mutate({ investmentId: inv.id });
                        }}
                      >
                        <Text style={styles.btnText}>{signBusyId === inv.id ? 'Signing...' : 'Sign agreement'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
            <Text style={[styles.textDim, { marginTop: 4, lineHeight: 16 }]}>
              Commitments marked "pending acquisition" are recorded and (for wallet payments) paid
              for, but asset custody/acquisition has not been confirmed yet — they are not
              confirmed investments.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
