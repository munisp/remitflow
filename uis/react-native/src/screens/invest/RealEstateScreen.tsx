/**
 * wave17 C1 (SPEC-wave17, rn-invest) — Fractional real-estate RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/RealEstate.tsx, backed by the mounted
 * `realEstate` router (server/routers/investment.ts):
 *   - listListings / getListing  — browse (public)
 *   - invest                     — TOTP step-up + tier-2 KYC + guarded wallet
 *                                  debit + share decrement (all server-side,
 *                                  fail-closed; this UI only surfaces them)
 *   - getMyInvestments           — holdings
 *   - roiCalculator              — server-computed projection (on demand)
 *
 * Admin-only `realEstate.confirmCustody` is intentionally NOT exposed here.
 * Honesty (identical to PWA): holdings in `pending_acquisition` are labeled
 * "pending acquisition — custody not yet confirmed" — funds were debited but
 * asset custody/acquisition is not confirmed (server W7/B8 note).
 * Proc names grep-verified against audit/routers.json (mounted, non-legacy).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { trpc } from '../../services/trpc';
import {
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

type Tab = 'browse' | 'holdings';

const PROPERTY_TYPE_SUGGESTIONS = ['residential', 'commercial', 'land', 'mixed_use'];

// ── Listing detail + invest panel (mounted only when a listing is opened) ────

function ListingDetail({ listingId, onClose, onChanged }: { listingId: number; onClose: () => void; onChanged: () => void }) {
  const detailQ = trpc.realEstate.getListing.useQuery({ id: listingId });
  const selected = detailQ.data;

  const [sharesCount, setSharesCount] = useState('1');
  const [holdYears, setHoldYears] = useState('5');
  const [totpCode, setTotpCode] = useState('');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [projection, setProjection] = useState<any | null>(null);
  const [projectionErr, setProjectionErr] = useState<string | null>(null);

  const projQ = trpc.realEstate.roiCalculator.useQuery(
    { listingId, sharesCount: Math.max(0, Math.floor(Number(sharesCount) || 0)), holdYears: Math.min(30, Math.max(1, Math.floor(Number(holdYears) || 5))) },
    { enabled: false },
  );
  const investMutation = trpc.realEstate.invest.useMutation({
    onSuccess: async (res: any) => {
      // Server honesty note (W7/B8): funds debited + shares reserved, but the
      // ownership record is pending acquisition — surface it verbatim.
      setActionMsg(`Investment #${res.id} recorded (${res.sharesOwned} shares, ${fmtMoney(res.totalInvestedUsd)}). ${res.note}`);
      setTotpCode('');
      await Promise.all([detailQ.refetch()]);
      onChanged();
    },
    onError: (e: unknown) => setActionErr(investErrMsg(e)),
  });

  const shares = Math.max(0, Math.floor(Number(sharesCount) || 0));
  const pricePerShare = selected ? Number(selected.pricePerShareUsd) : 0;
  const localTotal = shares > 0 && Number.isFinite(pricePerShare) ? shares * pricePerShare : 0;

  const runProjection = async () => {
    if (!selected || shares < 1) return;
    setProjectionErr(null);
    try {
      const res = await projQ.refetch();
      if (res.error) throw res.error;
      setProjection(res.data);
    } catch (e) {
      setProjection(null);
      setProjectionErr(investErrMsg(e));
    }
  };

  return (
    <View style={[styles.card, styles.cardSelected]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{selected?.title ?? `Listing #${listingId}`}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.linkText}>Close</Text>
        </TouchableOpacity>
      </View>
      {detailQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 12 }} /> : null}
      <ErrorBanner message={detailQ.error ? investErrMsg(detailQ.error) : null} />
      {selected ? (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.textBody}>{selected.description}</Text>

          <View style={[styles.statGrid, { marginTop: 10 }]}>
            {[
              ['Total value', fmtMoney(selected.totalValueUsd)],
              ['Min. investment', fmtMoney(selected.minimumInvestmentUsd)],
              ['Rental yield', fmtPct(selected.rentalYieldPct)],
              ['Appreciation', fmtPct(selected.appreciationPct)],
              ['Developer', selected.developerName ?? '—'],
              ['Available shares', `${selected.availableShares} of ${selected.totalShares}`],
              ['Listed', fmtDateTime(selected.createdAt)],
            ].map(([label, value]) => (
              <View key={label} style={styles.statCell}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={{ marginTop: 8 }}>
            <StatusBadge status={selected.status} />
          </View>

          {selected.status === 'open' ? (
            <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#2d2d4e', paddingTop: 12 }}>
              <Text style={styles.sectionTitle}>Invest</Text>
              <LabeledInput label={`Shares (max ${selected.availableShares})`} value={sharesCount} onChange={setSharesCount} numeric />
              <LabeledInput label="Projection horizon (years)" value={holdYears} onChange={setHoldYears} numeric />
              <TotpField value={totpCode} onChange={setTotpCode} />

              <Text style={[styles.textMuted, { marginTop: 8, lineHeight: 17 }]}>
                Total (computed locally): <Text style={{ color: '#e2e8f0', fontWeight: '700' }}>{fmtMoney(localTotal)}</Text> —
                debited from your USD wallet. Tier-2 verification and 2FA are enforced by the server.
              </Text>

              <View style={[styles.row, { gap: 8, marginTop: 8 }]}>
                <TouchableOpacity
                  style={[styles.btnSecondary, { flex: 1, marginTop: 0 }, (projQ.isFetching || shares < 1) && styles.btnDisabled]}
                  disabled={projQ.isFetching || shares < 1}
                  onPress={runProjection}
                >
                  <Text style={styles.btnText}>{projQ.isFetching ? 'Calculating...' : 'Calculate projection'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { flex: 1, marginTop: 0 }, (investMutation.isPending || shares < 1 || shares > selected.availableShares) && styles.btnDisabled]}
                  disabled={investMutation.isPending || shares < 1 || shares > selected.availableShares}
                  onPress={() => {
                    setActionErr(null);
                    setActionMsg(null);
                    investMutation.mutate({ listingId: selected.id, sharesCount: shares, totpCode: totpCode.trim() || undefined });
                  }}
                >
                  <Text style={styles.btnText}>{investMutation.isPending ? 'Processing...' : `Invest ${fmtMoney(localTotal)}`}</Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 10 }}>
                <ErrorBanner message={projectionErr} />
              </View>
              {projection ? (
                <View style={[styles.card, { backgroundColor: '#12122a' }]}>
                  <Text style={[styles.textDim, { marginBottom: 8, lineHeight: 15 }]}>
                    Server-computed projection over {projection.holdYears} year(s) at {projection.annualReturnPct}% expected annual
                    return — an estimate, not a guarantee.
                  </Text>
                  <View style={styles.statGrid}>
                    {[
                      ['Projected total return', fmtMoney(projection.projectedTotalReturnUsd)],
                      ['Rental income', fmtMoney(projection.rentalIncomeUsd)],
                      ['Capital gain', fmtMoney(projection.capitalGainUsd)],
                      ['Value at exit', fmtMoney(projection.totalValueAtExitUsd)],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.statCell}>
                        <Text style={styles.statLabel}>{label}</Text>
                        <Text style={styles.statValue}>{value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <ErrorBanner message={actionErr} />
              <SuccessNote message={actionMsg} />
            </View>
          ) : (
            <Text style={[styles.textMuted, { marginTop: 12 }]}>
              This listing is not open for investment (status: {selected.status}).
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function RealEstateScreen() {
  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listQ = trpc.realEstate.listListings.useQuery(
    { search: search.trim() || undefined, propertyType: propertyType.trim() || undefined, status: statusFilter || undefined, limit: 50 },
    { enabled: tab === 'browse' },
  );
  const holdingsQ = trpc.realEstate.getMyInvestments.useQuery(undefined, { enabled: tab === 'holdings' });

  return (
    <View style={styles.container}>
      <InvestHeader title="Fractional real estate" />
      <TabBar<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'browse', label: 'Browse listings' },
          { key: 'holdings', label: 'My holdings' },
        ]}
      />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        <Text style={[styles.textMuted, { marginBottom: 12, lineHeight: 18 }]}>
          Browse fractional property listings and invest from your USD wallet. Investing requires
          tier-2 verification and a 2FA code; ownership records stay{' '}
          <Text style={{ fontStyle: 'italic' }}>pending acquisition</Text> until asset custody is
          confirmed by the platform.
        </Text>

        {tab === 'browse' && (
          <View>
            <LabeledInput label="Search" value={search} onChange={setSearch} placeholder="Title or location…" />
            <Text style={[styles.label, { marginTop: 10 }]}>Property type</Text>
            <View style={styles.chipRow}>
              {['', ...PROPERTY_TYPE_SUGGESTIONS].map((p) => (
                <TouchableOpacity
                  key={p || 'any'}
                  style={[styles.chip, propertyType === p && styles.chipActive]}
                  onPress={() => setPropertyType(p)}
                >
                  <Text style={[styles.chipText, propertyType === p && styles.chipTextActive]}>{p || 'Any'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.label, { marginTop: 10 }]}>Status</Text>
            <View style={styles.chipRow}>
              {[
                { v: 'open', l: 'Open' },
                { v: 'funded', l: 'Funded' },
                { v: '', l: 'Any' },
              ].map((o) => (
                <TouchableOpacity
                  key={o.l}
                  style={[styles.chip, statusFilter === o.v && styles.chipActive]}
                  onPress={() => setStatusFilter(o.v)}
                >
                  <Text style={[styles.chipText, statusFilter === o.v && styles.chipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 12 }}>
              <ErrorBanner message={listQ.error ? investErrMsg(listQ.error) : null} />
            </View>
            {listQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!listQ.isLoading && !listQ.error && (listQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>No listings match these filters.</Text>
            )}

            {(listQ.data ?? []).map((l: any) => {
              const soldPct = l.totalShares > 0 ? Math.round(((l.totalShares - l.availableShares) / l.totalShares) * 100) : 0;
              return (
                <TouchableOpacity
                  key={l.id}
                  style={[styles.card, selectedId === l.id && styles.cardSelected]}
                  onPress={() => setSelectedId(selectedId === l.id ? null : l.id)}
                >
                  <View style={styles.rowBetween}>
                    <Text style={[styles.textMain, { flex: 1, marginRight: 8 }]}>{l.title}</Text>
                    <View style={[styles.row, { gap: 6 }]}>
                      {l.isFeatured ? (
                        <View style={[styles.badge, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
                          <Text style={[styles.badgeText, { color: '#f59e0b' }]}>featured</Text>
                        </View>
                      ) : null}
                      <StatusBadge status={l.status} />
                    </View>
                  </View>
                  <Text style={[styles.textMuted, { marginTop: 4 }]}>
                    {l.location}, {l.city}, {l.state} · {l.propertyType}
                  </Text>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <View>
                      <Text style={styles.textDim}>Price / share</Text>
                      <Text style={styles.textMain}>{fmtMoney(l.pricePerShareUsd)}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Expected return</Text>
                      <Text style={styles.textMain}>{fmtPct(l.expectedAnnualReturnPct)} / yr</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Shares left</Text>
                      <Text style={styles.textMain}>{l.availableShares} / {l.totalShares}</Text>
                    </View>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.min(100, soldPct)}%` }]} />
                  </View>
                  <Text style={[styles.textDim, { marginTop: 4 }]}>{soldPct}% subscribed</Text>
                </TouchableOpacity>
              );
            })}

            {selectedId !== null && (
              <ListingDetail
                listingId={selectedId}
                onClose={() => setSelectedId(null)}
                onChanged={() => {
                  listQ.refetch();
                  // A change here (e.g. investing) can create/alter holdings, so refresh
                  // them too — `tab` is narrowed to 'browse' in this block, so a
                  // `tab === 'holdings'` guard would be dead code (TS2367).
                  holdingsQ.refetch();
                }}
              />
            )}
          </View>
        )}

        {tab === 'holdings' && (
          <View>
            <ErrorBanner message={holdingsQ.error ? investErrMsg(holdingsQ.error) : null} />
            {holdingsQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!holdingsQ.isLoading && !holdingsQ.error && (holdingsQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>You have no real-estate holdings yet.</Text>
            )}
            {(holdingsQ.data ?? []).map((h: any) => {
              const c = statusBadgeColors(h.status);
              return (
                <View key={h.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.textMain}>{h.title}</Text>
                      <Text style={styles.textDim}>
                        {h.city}, {h.state} · {h.propertyType} · listing {h.listingStatus}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: c.bg }]}>
                      <Text style={[styles.badgeText, { color: c.fg }]}>{holdingStatusLabel(h.status)}</Text>
                    </View>
                  </View>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <View>
                      <Text style={styles.textDim}>Shares</Text>
                      <Text style={styles.textMain}>{h.sharesOwned}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Invested</Text>
                      <Text style={styles.textMain}>{fmtMoney(h.totalInvestedUsd)}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Ownership</Text>
                      <Text style={styles.textMain}>{fmtPct(h.ownershipPct)}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Returns paid</Text>
                      <Text style={styles.textMain}>{fmtMoney(h.returnsPaidUsd)}</Text>
                    </View>
                  </View>
                  <Text style={[styles.textDim, { marginTop: 6 }]}>Invested at {fmtDate(h.investedAt)}</Text>
                </View>
              );
            })}
            <Text style={[styles.textDim, { marginTop: 4, lineHeight: 16 }]}>
              Holdings marked "pending acquisition" have been paid for and shares are reserved, but
              asset custody/acquisition has not been confirmed yet — they are not active ownership
              records.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
