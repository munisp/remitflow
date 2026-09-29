/**
 * wave17 C1 (SPEC-wave17, rn-invest) — Diaspora Bonds RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/BondsPage.tsx: wires the full user-facing
 * lifecycle of the diasporaBond router (server/routers/diasporaBond.ts):
 *   browse offerings (listBonds) → subscribe happens on the detail screen
 *   (BondDetailScreen) → my holdings (getMySubscriptions) with coupons
 *   (getCouponHistory), off-rail payment confirmation (confirmPayment, TOTP
 *   step-up), secondary-market listing (createSellOrder) and early redemption
 *   (requestEarlyRedemption, TOTP step-up) → secondary market browse/buy
 *   (listSecondaryOrders / fillBuyOrder, TOTP step-up).
 *
 * Admin-only procedures (adminConfirmPayment, processUpcomingCoupons) are
 * intentionally NOT exposed here. All proc names grep-verified against
 * audit/routers.json (mounted, non-legacy, static registration).
 *
 * All backend guards are preserved and their errors surfaced verbatim:
 * tier-2 KYC + plan gate (assertFeatureEligible), whole-multiple-of-face-value
 * rule, guarded USD debits, TOTP step-up, tranche remaining cap.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../../services/trpc';
import {
  ChipSelector,
  ErrorBanner,
  InvestHeader,
  LabeledInput,
  StatusBadge,
  SuccessNote,
  TabBar,
  TotpField,
  fmtDateTime,
  fmtMoney,
  investErrMsg,
  styles,
} from './common';

const MIN_SUBSCRIPTION_USD = 500;

type BondStatus = 'open' | 'closed' | 'matured' | 'all';
type Tab = 'offerings' | 'holdings' | 'secondary';

// ── Coupon history (mounted only when a holding is expanded) ─────────────────

function CouponHistoryPanel({ subscriptionId }: { subscriptionId: number }) {
  const q = trpc.diasporaBond.getCouponHistory.useQuery({ subscriptionId });
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.label}>Coupon payments</Text>
      {q.isLoading ? <ActivityIndicator color="#6366f1" /> : null}
      <ErrorBanner message={q.error ? investErrMsg(q.error) : null} />
      {q.data ? (
        <View>
          <Text style={styles.textMuted}>
            Total received: ${fmtMoney(q.data.totalReceived)} · {q.data.coupons.length} coupon record(s)
          </Text>
          {q.data.coupons.length === 0 ? (
            <Text style={[styles.textDim, { marginTop: 4 }]}>
              No coupons recorded yet — coupon processing runs when each period falls due.
            </Text>
          ) : (
            q.data.coupons.map((c: any) => (
              <View key={c.id} style={[styles.rowBetween, { marginTop: 6 }]}>
                <Text style={styles.textMuted}>
                  #{c.couponNumber} · {fmtDateTime(c.scheduledDate)}
                </Text>
                <Text style={styles.textBody}>${fmtMoney(c.netAmount)}</Text>
                <StatusBadge status={c.status} />
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Per-subscription action panel (coupons, off-rail confirm, sell, redeem) ──

function SubscriptionPanel({ item, onChanged }: { item: any; onChanged: () => void }) {
  const sub = item.subscription;
  const [actErr, setActErr] = useState<string | null>(null);
  const [actMsg, setActMsg] = useState<string | null>(null);

  // Sell-order form
  const [sellUnits, setSellUnits] = useState('');
  const [sellAsk, setSellAsk] = useState('');
  const [sellDays, setSellDays] = useState('7');

  // Early-redemption form (TOTP step-up)
  const [redeemReason, setRedeemReason] = useState('');
  const [redeemTotp, setRedeemTotp] = useState('');

  // Off-rail payment confirmation (pending_payment subscriptions, TOTP)
  const [payRef, setPayRef] = useState('');
  const [payTotp, setPayTotp] = useState('');

  const onErr = (e: unknown) => setActErr(investErrMsg(e));
  const clearTotps = () => {
    setRedeemTotp('');
    setPayTotp('');
  };

  const sellMutation = trpc.diasporaBond.createSellOrder.useMutation({
    onSuccess: (res: any) => {
      setActMsg(
        `Sell order #${res.order.id} created: ${res.order.units} unit(s) at $${fmtMoney(res.order.askPrice)} ask. ` +
          `Fair value $${fmtMoney(res.fairValue)} (${res.premiumDiscount >= 0 ? '+' : ''}${Number(res.premiumDiscount).toFixed(2)}% vs fair). ` +
          `You receive the full ask $${fmtMoney(res.netProceeds)} — the 0.5% platform fee ($${fmtMoney(res.buyerPaidFee)}) is paid by the buyer on top.`,
      );
      setSellUnits('');
      setSellAsk('');
      onChanged();
    },
    onError: onErr,
  });
  const redeemMutation = trpc.diasporaBond.requestEarlyRedemption.useMutation({
    onSuccess: (res: any) => {
      setActMsg(
        `Early redemption completed: principal $${fmtMoney(res.principalUsd)} minus ${(res.penaltyRate * 100).toFixed(0)}% penalty ` +
          `($${fmtMoney(res.penalty)}) = $${fmtMoney(res.redemptionAmount)} credited to your USD wallet.`,
      );
      clearTotps();
      onChanged();
    },
    onError: onErr,
  });
  const confirmMutation = trpc.diasporaBond.confirmPayment.useMutation({
    onSuccess: () => {
      setActMsg('Payment confirmed — the subscription is now active and accrues coupons.');
      setPayRef('');
      clearTotps();
      onChanged();
    },
    onError: onErr,
  });

  const isActive = sub.status === 'active';

  return (
    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#2d2d4e', paddingTop: 10 }}>
      <ErrorBanner message={actErr} />
      <SuccessNote message={actMsg} />

      <CouponHistoryPanel subscriptionId={sub.id} />

      {/* Off-rail payment confirmation */}
      {sub.status === 'pending_payment' && (
        <View style={[styles.warnBox, { marginTop: 10 }]}>
          <Text style={styles.warnText}>
            This subscription is awaiting payment confirmation. If you paid by bank transfer or
            card, enter the payment reference to activate it. Requires your 6-digit 2FA code.
          </Text>
          <LabeledInput label="Payment reference" value={payRef} onChange={setPayRef} placeholder="e.g. bank transfer receipt reference" />
          <TotpField value={payTotp} onChange={setPayTotp} />
          <TouchableOpacity
            style={[styles.btn, (confirmMutation.isPending || payRef.trim().length < 4) && styles.btnDisabled]}
            disabled={confirmMutation.isPending || payRef.trim().length < 4}
            onPress={() => {
              setActErr(null);
              setActMsg(null);
              confirmMutation.mutate({ subscriptionId: sub.id, paymentReference: payRef, totpCode: payTotp || undefined });
            }}
          >
            <Text style={styles.btnText}>{confirmMutation.isPending ? 'Confirming...' : 'Confirm payment'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {isActive && (
        <View style={{ marginTop: 12 }}>
          {/* Sell on secondary market */}
          <View style={[styles.card, { backgroundColor: '#12122a' }]}>
            <Text style={styles.sectionTitle}>Sell on secondary market</Text>
            <Text style={styles.textDim}>
              Units must be a whole number; you hold {sub.units}. You receive the full ask — the
              0.5% platform fee is charged to the buyer.
            </Text>
            <LabeledInput label="Units to sell" value={sellUnits} onChange={(v) => setSellUnits(v.replace(/\D/g, ''))} numeric placeholder={String(sub.units)} />
            <LabeledInput label="Ask price per unit (USD)" value={sellAsk} onChange={(v) => setSellAsk(v.replace(/[^\d.]/g, ''))} numeric placeholder={item.bond?.faceValue ?? '1000.00'} />
            <LabeledInput label="Expires in (days)" value={sellDays} onChange={(v) => setSellDays(v.replace(/\D/g, ''))} numeric />
            <TouchableOpacity
              style={[
                styles.btnSecondary,
                (sellMutation.isPending || !sellUnits || !sellAsk || Number(sellUnits) <= 0 || Number(sellUnits) > sub.units || Number(sellAsk) <= 0) &&
                  styles.btnDisabled,
              ]}
              disabled={
                sellMutation.isPending || !sellUnits || !sellAsk || Number(sellUnits) <= 0 || Number(sellUnits) > sub.units || Number(sellAsk) <= 0
              }
              onPress={() => {
                setActErr(null);
                setActMsg(null);
                sellMutation.mutate({
                  subscriptionId: sub.id,
                  unitsToSell: Number(sellUnits),
                  askPriceUsd: Number(sellAsk),
                  expiresInDays: Number(sellDays) || 7,
                });
              }}
            >
              <Text style={styles.btnText}>{sellMutation.isPending ? 'Listing...' : 'List sell order'}</Text>
            </TouchableOpacity>
          </View>

          {/* Early redemption (TOTP step-up, cannot be undone) */}
          <View style={[styles.card, { backgroundColor: 'rgba(185,28,28,0.08)', borderColor: 'rgba(239,68,68,0.3)' }]}>
            <Text style={styles.sectionTitle}>Early redemption</Text>
            <Text style={styles.textDim}>
              Redeem before maturity: principal minus a 2% penalty is credited to your USD wallet
              immediately. Requires your 6-digit 2FA code. This cannot be undone.
            </Text>
            <LabeledInput label="Reason (optional)" value={redeemReason} onChange={setRedeemReason} maxLength={2000} />
            <TotpField value={redeemTotp} onChange={setRedeemTotp} />
            <TouchableOpacity
              style={[styles.btnDanger, redeemMutation.isPending && styles.btnDisabled]}
              disabled={redeemMutation.isPending}
              onPress={() => {
                setActErr(null);
                setActMsg(null);
                redeemMutation.mutate({ subscriptionId: sub.id, reason: redeemReason || undefined, totpCode: redeemTotp || undefined });
              }}
            >
              <Text style={styles.btnText}>{redeemMutation.isPending ? 'Redeeming...' : 'Redeem early'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function BondsScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('offerings');

  // Offerings
  const [statusFilter, setStatusFilter] = useState<BondStatus>('open');
  const [minYield, setMinYield] = useState('');
  const listInput = useMemo(
    () => ({ status: statusFilter, minYield: minYield ? Number(minYield) / 100 : undefined }),
    [statusFilter, minYield],
  );
  const bondsQ = trpc.diasporaBond.listBonds.useQuery(listInput, { enabled: tab === 'offerings' });

  // Holdings
  const [expandedSub, setExpandedSub] = useState<number | null>(null);
  const mineQ = trpc.diasporaBond.getMySubscriptions.useQuery(undefined, { enabled: tab === 'holdings' });

  // Secondary market
  const ordersQ = trpc.diasporaBond.listSecondaryOrders.useQuery({ side: 'all' }, { enabled: tab === 'secondary' });
  const [fillErr, setFillErr] = useState<string | null>(null);
  const [fillMsg, setFillMsg] = useState<string | null>(null);
  const [fillTotp, setFillTotp] = useState<Record<number, string>>({});
  const [fillUnits, setFillUnits] = useState<Record<number, string>>({});
  const [fillBusyId, setFillBusyId] = useState<number | null>(null);
  const fillMutation = trpc.diasporaBond.fillBuyOrder.useMutation({
    onSuccess: (res: any) => {
      setFillMsg(
        `Bought ${res.unitsAcquired} unit(s) for $${fmtMoney(res.totalCost)} + $${fmtMoney(res.platformFee)} platform fee. ` +
          `The units are now in your holdings as an active subscription.`,
      );
      setFillBusyId(null);
      ordersQ.refetch();
    },
    onError: (e: unknown) => {
      setFillErr(investErrMsg(e));
      setFillBusyId(null);
    },
  });

  const fill = (order: any) => {
    const unitsRaw = fillUnits[order.id];
    setFillBusyId(order.id);
    setFillErr(null);
    setFillMsg(null);
    fillMutation.mutate({
      orderId: order.id,
      unitsToFill: unitsRaw ? Number(unitsRaw) : undefined,
      totpCode: fillTotp[order.id] || undefined,
    });
  };

  return (
    <View style={styles.container}>
      <InvestHeader title="Diaspora Bonds" />
      <TabBar<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'offerings', label: 'Offerings' },
          { key: 'holdings', label: 'My holdings' },
          { key: 'secondary', label: 'Secondary market' },
        ]}
      />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        <Text style={[styles.textMuted, { marginBottom: 12, lineHeight: 18 }]}>
          Browse open offerings, subscribe from your USD wallet, track coupons, trade on the
          secondary market, or redeem early (2% penalty).
        </Text>

        {/* ── Offerings ── */}
        {tab === 'offerings' && (
          <View>
            <Text style={styles.label}>Status</Text>
            <ChipSelector<BondStatus>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'closed', label: 'Closed' },
                { value: 'matured', label: 'Matured' },
                { value: 'all', label: 'All' },
              ]}
            />
            <LabeledInput label="Min coupon yield (%)" hint="Optional" value={minYield} onChange={(v) => setMinYield(v.replace(/[^\d.]/g, ''))} numeric placeholder="e.g. 6" />
            <TouchableOpacity style={styles.btnSecondary} onPress={() => bondsQ.refetch()} disabled={bondsQ.isFetching}>
              <Text style={styles.btnText}>{bondsQ.isFetching ? 'Refreshing...' : 'Refresh'}</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 12 }}>
              <ErrorBanner message={bondsQ.error ? investErrMsg(bondsQ.error) : null} />
            </View>
            {bondsQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!bondsQ.isLoading && !bondsQ.error && (bondsQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>No bonds match this filter.</Text>
            )}

            {(bondsQ.data ?? []).map((b: any) => {
              const fillPct = (Number(b.raisedAmount ?? 0) / Math.max(1, Number(b.targetRaise ?? 0))) * 100;
              return (
                <TouchableOpacity key={b.id} style={styles.card} onPress={() => navigation.navigate('InvestBondDetail', { bondId: b.id })}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.textMain}>{b.name}</Text>
                      <Text style={styles.textDim}>
                        {b.issuer}
                        {b.isin ? ` · ISIN ${b.isin}` : ''}
                        {b.creditRating ? ` · ${b.creditRating}` : ''}
                      </Text>
                    </View>
                    <StatusBadge status={b.status} />
                  </View>
                  <View style={[styles.rowBetween, { marginTop: 10 }]}>
                    <View>
                      <Text style={styles.textDim}>Coupon</Text>
                      <Text style={styles.textMain}>{(Number(b.couponRate) * 100).toFixed(2)}%</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Face value</Text>
                      <Text style={styles.textMain}>${fmtMoney(b.faceValue)}</Text>
                    </View>
                    <View>
                      <Text style={styles.textDim}>Maturity</Text>
                      <Text style={styles.textMain}>{fmtDateTime(b.maturityDate).split(',')[0]}</Text>
                    </View>
                  </View>
                  {b.targetRaise ? (
                    <View style={{ marginTop: 10 }}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.textDim}>Raised ${fmtMoney(b.raisedAmount)}</Text>
                        <Text style={styles.textDim}>
                          {Math.min(100, fillPct).toFixed(0)}% of ${fmtMoney(b.targetRaise)}
                        </Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${Math.min(100, fillPct)}%` }]} />
                      </View>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
            <Text style={[styles.textDim, { marginTop: 4, lineHeight: 16 }]}>
              Minimum subscription ${MIN_SUBSCRIPTION_USD.toLocaleString()} USD; amounts must be a
              whole multiple of the bond face value (backend enforced).
            </Text>
          </View>
        )}

        {/* ── My holdings ── */}
        {tab === 'holdings' && (
          <View>
            <ErrorBanner message={mineQ.error ? investErrMsg(mineQ.error) : null} />
            {mineQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {mineQ.data ? (
              <View>
                <View style={styles.statGrid}>
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>Total invested</Text>
                    <Text style={styles.statValue}>${fmtMoney(mineQ.data.summary.totalInvested)}</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>Current value</Text>
                    <Text style={styles.statValue}>${fmtMoney(mineQ.data.summary.totalCurrentValue)}</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>Unrealized P&L</Text>
                    <Text style={styles.statValue}>
                      {mineQ.data.summary.totalPnl >= 0 ? '+' : ''}${fmtMoney(mineQ.data.summary.totalPnl)} ({Number(mineQ.data.summary.totalPnlPct).toFixed(2)}%)
                    </Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>Positions</Text>
                    <Text style={styles.statValue}>
                      {mineQ.data.summary.activeCount} active · {mineQ.data.summary.maturedCount} matured
                    </Text>
                  </View>
                </View>

                {mineQ.data.subscriptions.length === 0 && (
                  <Text style={[styles.textMuted, { marginTop: 12 }]}>
                    No subscriptions yet — browse the offerings tab to subscribe.
                  </Text>
                )}

                {mineQ.data.subscriptions.map((item: any) => {
                  const sub = item.subscription;
                  const expanded = expandedSub === sub.id;
                  return (
                    <View key={sub.id} style={[styles.card, { marginTop: 12 }]}>
                      <View style={styles.rowBetween}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={[styles.row, { gap: 6, flexWrap: 'wrap' }]}>
                            <Text style={styles.textMain}>{item.bond?.name ?? `Bond #${sub.bondId}`}</Text>
                            <StatusBadge status={sub.status} />
                          </View>
                          <Text style={[styles.textDim, { marginTop: 4 }]}>
                            {sub.subscriptionRef} · {sub.units} unit(s) · purchased {fmtDateTime(sub.purchasedAt)}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.rowBetween, { marginTop: 8 }]}>
                        <Text style={styles.textMuted}>
                          Current value: ${fmtMoney(item.currentValue)}{' '}
                          <Text style={{ color: item.pnl >= 0 ? '#10b981' : '#ef4444' }}>
                            ({item.pnl >= 0 ? '+' : ''}{fmtMoney(item.pnl)})
                          </Text>
                        </Text>
                        <TouchableOpacity onPress={() => setExpandedSub(expanded ? null : sub.id)}>
                          <Text style={styles.linkText}>{expanded ? 'Hide actions' : 'Actions'}</Text>
                        </TouchableOpacity>
                      </View>
                      {expanded && <SubscriptionPanel item={item} onChanged={() => mineQ.refetch()} />}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        )}

        {/* ── Secondary market ── */}
        {tab === 'secondary' && (
          <View>
            <ErrorBanner message={ordersQ.error ? investErrMsg(ordersQ.error) : null} />
            <ErrorBanner message={fillErr} />
            <SuccessNote message={fillMsg} />
            {ordersQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!ordersQ.isLoading && !ordersQ.error && (ordersQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>No open secondary-market orders right now.</Text>
            )}
            {(ordersQ.data ?? []).map((o: any) => (
              <View key={o.id} style={styles.card}>
                <View style={[styles.row, { gap: 6, flexWrap: 'wrap' }]}>
                  <Text style={styles.textMain}>{o.bondName ?? `Bond #${o.bondId}`}</Text>
                  <StatusBadge status={o.status} />
                </View>
                <Text style={[styles.textDim, { marginTop: 4 }]}>
                  {o.issuerName ? `${o.issuerName} · ` : ''}
                  {o.couponRate ? `coupon ${(Number(o.couponRate) * 100).toFixed(2)}% · ` : ''}
                  listed {fmtDateTime(o.createdAt)}
                  {o.expiresAt ? ` · expires ${fmtDateTime(o.expiresAt)}` : ''}
                </Text>
                <Text style={[styles.textBody, { marginTop: 6 }]}>
                  {o.units} unit(s) @ ${fmtMoney(o.askPrice)} = ${fmtMoney(o.totalValue)}{' '}
                  <Text style={styles.textDim}>+ 0.5% buyer fee (${fmtMoney(Number(o.totalValue ?? 0) * 0.005)})</Text>
                </Text>
                <LabeledInput
                  label="Units to buy (blank = all)"
                  value={fillUnits[o.id] ?? ''}
                  onChange={(v) => setFillUnits((m) => ({ ...m, [o.id]: v.replace(/\D/g, '') }))}
                  numeric
                  placeholder={String(o.units)}
                />
                <TotpField value={fillTotp[o.id] ?? ''} onChange={(v) => setFillTotp((m) => ({ ...m, [o.id]: v }))} />
                <TouchableOpacity
                  style={[styles.btn, fillBusyId === o.id && styles.btnDisabled]}
                  disabled={fillBusyId === o.id}
                  onPress={() => fill(o)}
                >
                  <Text style={styles.btnText}>{fillBusyId === o.id ? 'Filling...' : 'Buy units'}</Text>
                </TouchableOpacity>
              </View>
            ))}
            <Text style={[styles.textDim, { marginTop: 4, lineHeight: 16 }]}>
              Fills are atomic and guarded server-side: your USD wallet is debited only if the order
              is still open and fully funded settlement is possible. Buying requires tier-2 KYC and
              your 6-digit 2FA code.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
