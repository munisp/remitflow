/**
 * wave17 C1 (SPEC-wave17, rn-invest) — NGX Stocks RN screen.
 *
 * Mirrors uis/pwa/src/pages/invest/StocksPage.tsx: consumes the user-facing
 * ngxStocks procedures (server/routers/investment.ts):
 *   listing browse (list / sectors), watchlist (getWatchlist / addToWatchlist /
 *   removeFromWatchlist), order capture (placeOrder — tier-2 KYC + plan gate,
 *   TOTP for sells and buys above ₦1,000,000, stale-price refusal on market
 *   orders, idempotency key), positions/orders (getOrders) and cancellation
 *   with wallet refund (cancelOrder).
 *
 * HONESTY (identical labels to the PWA): broker settlement is NOT implemented
 * backend-side (ngxStocks.brokerWebhook always fails closed with
 * NOT_IMPLEMENTED; executions are reconciled manually by operations). This
 * screen therefore:
 *   - labels the surface "Broker connectivity in progress";
 *   - renders priceStale / priceSource badges so seed/indicative quotes are
 *     never presented as live;
 *   - never presents an order as an executed trade — order status is shown
 *     verbatim, and brokerStatus "queued_for_ops" is explained as manual ops
 *     processing ("NOT an executed trade").
 * brokerWebhook and ingestPrices are deliberately not exposed in the user UI.
 * Proc names grep-verified against audit/routers.json (mounted, non-legacy).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
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
  fmtDateTime,
  fmtMoney,
  investErrMsg,
  newIdempotencyKey,
  styles,
} from './common';

type NgxOrderType = 'buy' | 'sell' | 'limit_buy' | 'limit_sell';
type NgxBroker = 'Bamboo' | 'Trove' | 'Chaka' | 'Stanbic' | 'GTB';
type Tab = 'market' | 'orders' | 'watchlist';

const BROKERS: NgxBroker[] = ['Bamboo', 'Trove', 'Chaka', 'Stanbic', 'GTB'];
/** Mirrors the server: sells of any size and buys above this need 2FA. */
const TOTP_THRESHOLD_NGN = 1_000_000;

function PriceHonestyBadge({ stock }: { stock: any }) {
  if (stock.priceStale) {
    return (
      <Badge
        label={stock.priceSource === 'seed' ? 'indicative seed price — stale' : 'stale price'}
        color="#ef4444"
        bg="rgba(239,68,68,0.12)"
      />
    );
  }
  if (stock.priceSource === 'seed') {
    return <Badge label="indicative seed price" color="#f59e0b" bg="rgba(245,158,11,0.12)" />;
  }
  return <Badge label="live feed price" color="#10b981" bg="rgba(16,185,129,0.12)" />;
}

// ── Order ticket ─────────────────────────────────────────────────────────────

function OrderTicket({ stock, onClose }: { stock: any; onClose: () => void }) {
  const [orderType, setOrderType] = useState<NgxOrderType>('buy');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(String(stock.currentPriceNgn));
  const [broker, setBroker] = useState<NgxBroker>('Bamboo');
  const [notes, setNotes] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  // One idempotency key per ticket opening — a retried submit replays the
  // same order server-side instead of double-debiting.
  const [idemKey] = useState(newIdempotencyKey);

  const mutation = trpc.ngxStocks.placeOrder.useMutation({
    onSuccess: (res: any) => {
      setResult(res);
      setTotp('');
    },
    onError: (e: unknown) => {
      // Surfaced verbatim: tier-2 KYC/plan gate, TOTP_REQUIRED (FORBIDDEN),
      // "Price data stale — place a limit order" (BAD_REQUEST), insufficient
      // NGN balance, invalid unsigned decimals.
      setError(investErrMsg(e));
    },
  });

  const isBuy = orderType === 'buy' || orderType === 'limit_buy';
  const isMarket = orderType === 'buy' || orderType === 'sell';
  const totalNgn = (Number(qty) || 0) * (Number(price) || 0);
  const totpLikelyRequired = !isBuy || totalNgn > TOTP_THRESHOLD_NGN;

  const submit = () => {
    setError(null);
    setResult(null);
    mutation.mutate({
      stockId: stock.id,
      orderType,
      quantityUnits: qty,
      pricePerUnitNgn: price,
      brokerName: broker,
      notes: notes || undefined,
      idempotencyKey: idemKey,
      totpCode: totp || undefined,
    });
  };

  if (result) {
    return (
      <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#2d2d4e', paddingTop: 10 }}>
        <SuccessNote
          message={
            result.brokerStatus === 'submitted'
              ? `Order #${result.id} accepted by ${result.brokerName ?? 'the broker'} (status: submitted). It is not an executed trade yet — execution is confirmed separately.`
              : `Order #${result.id} captured and funds held (status: ${result.status}). Broker connectivity is in progress — execution is queued for manual processing by operations. This is NOT an executed trade.`
          }
        />
        {result.brokerMessage ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>{result.brokerMessage}</Text>
          </View>
        ) : null}
        <Text style={styles.textDim}>
          {String(result.orderType).toUpperCase()} {result.quantityUnits} × ₦{fmtMoney(result.pricePerUnitNgn)} = ₦
          {fmtMoney(result.totalAmountNgn)}
          {result.totalAmountUsd ? ` (≈ $${fmtMoney(result.totalAmountUsd)})` : ''}
          {result.idempotent ? ' · idempotent replay of your previous submit' : ''}
        </Text>
        <TouchableOpacity style={styles.btnSecondary} onPress={onClose}>
          <Text style={styles.btnText}>Close ticket</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#2d2d4e', paddingTop: 10 }}>
      <Text style={styles.label}>Order type</Text>
      <ChipSelector<NgxOrderType>
        value={orderType}
        onChange={setOrderType}
        options={[
          { value: 'buy', label: 'Buy (market)' },
          { value: 'sell', label: 'Sell (market)' },
          { value: 'limit_buy', label: 'Limit buy' },
          { value: 'limit_sell', label: 'Limit sell' },
        ]}
      />
      <Text style={[styles.label, { marginTop: 10 }]}>Broker</Text>
      <ChipSelector<NgxBroker>
        value={broker}
        onChange={setBroker}
        options={BROKERS.map((b) => ({ value: b, label: b }))}
      />
      <LabeledInput label="Quantity (units)" value={qty} onChange={(v) => setQty(v.replace(/[^\d.]/g, ''))} numeric placeholder="e.g. 100" />
      <LabeledInput
        label="Price per unit (NGN)"
        hint={isMarket ? 'Market orders trade at the displayed price and are refused if it is stale' : 'Limit orders proceed at your price'}
        value={price}
        onChange={(v) => setPrice(v.replace(/[^\d.]/g, ''))}
        numeric
      />
      <LabeledInput label="Notes (optional)" value={notes} onChange={setNotes} maxLength={500} />
      <TotpField
        value={totp}
        onChange={setTotp}
        label={totpLikelyRequired ? 'TOTP step-up code (required for this order)' : 'TOTP step-up code (if enrolled)'}
      />
      <Text style={[styles.textMuted, { marginTop: 8 }]}>
        Estimated total: <Text style={{ color: '#e2e8f0', fontWeight: '700' }}>₦{fmtMoney(totalNgn)}</Text>
      </Text>
      <ErrorBanner message={error} />
      <View style={[styles.row, { gap: 8, marginTop: 4 }]}>
        <TouchableOpacity
          style={[styles.btn, { flex: 1, marginTop: 0 }, (mutation.isPending || !qty || !price || Number(qty) <= 0 || Number(price) <= 0) && styles.btnDisabled]}
          disabled={mutation.isPending || !qty || !price || Number(qty) <= 0 || Number(price) <= 0}
          onPress={submit}
        >
          <Text style={styles.btnText}>{mutation.isPending ? 'Placing order...' : `Place ${orderType.replace('_', ' ')} order`}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btnSecondary, { marginTop: 0 }]} onPress={onClose} disabled={mutation.isPending}>
          <Text style={styles.btnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.textDim, { marginTop: 8, lineHeight: 16 }]}>
        {isBuy
          ? 'Your NGN wallet is debited at order time as the hold backing this order; cancelling a queued order refunds it.'
          : 'Sell orders reduce your position when executed by the broker/operations.'}{' '}
        Tier-2 KYC and an eligible plan are required. Broker settlement is in progress — an
        accepted order is a captured instruction, not an executed trade.
      </Text>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function StocksScreen() {
  const [tab, setTab] = useState<Tab>('market');

  // Market
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [ticketStockId, setTicketStockId] = useState<number | null>(null);
  const [watchMsg, setWatchMsg] = useState<string | null>(null);
  const [watchErr, setWatchErr] = useState<string | null>(null);
  const [watchBusyId, setWatchBusyId] = useState<number | null>(null);

  // Orders
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<number | null>(null);

  const stocksQ = trpc.ngxStocks.list.useQuery(
    { search: search || undefined, sector: sector || undefined, limit: 50, offset: 0 },
    { enabled: tab === 'market' },
  );
  const sectorsQ = trpc.ngxStocks.sectors.useQuery();
  const ordersQ = trpc.ngxStocks.getOrders.useQuery(
    { status: orderStatusFilter || undefined, limit: 50, offset: 0 },
    { enabled: tab === 'orders' },
  );
  const watchlistQ = trpc.ngxStocks.getWatchlist.useQuery(undefined, { enabled: tab === 'watchlist' });

  const addWatchMutation = trpc.ngxStocks.addToWatchlist.useMutation({
    onSuccess: () => setWatchBusyId(null),
    onError: (e: unknown) => {
      // CONFLICT: already in watchlist.
      setWatchErr(investErrMsg(e));
      setWatchBusyId(null);
    },
  });
  const removeWatchMutation = trpc.ngxStocks.removeFromWatchlist.useMutation({
    onSuccess: () => watchlistQ.refetch(),
    onError: (e: unknown) => setWatchErr(investErrMsg(e)),
  });
  const cancelMutation = trpc.ngxStocks.cancelOrder.useMutation({
    onSuccess: (res: any, vars: any) => {
      setCancelMsg(
        res.refunded
          ? `Order #${vars.orderId} cancelled and the held NGN was refunded to your wallet.`
          : `Order #${vars.orderId} cancelled (no wallet refund applicable).`,
      );
      setCancelBusyId(null);
      ordersQ.refetch();
    },
    onError: (e: unknown) => {
      // BAD_REQUEST: already submitted to broker — ops must recall.
      setCancelErr(investErrMsg(e));
      setCancelBusyId(null);
    },
  });

  const addWatch = (stock: any) => {
    setWatchBusyId(stock.id);
    setWatchErr(null);
    setWatchMsg(null);
    addWatchMutation.mutate(
      { stockId: stock.id },
      { onSuccess: () => setWatchMsg(`${stock.ticker} added to your watchlist.`) },
    );
  };

  return (
    <View style={styles.container}>
      <InvestHeader
        title="NGX Stocks"
        right={<Badge label="Broker connectivity in progress" color="#f59e0b" bg="rgba(245,158,11,0.12)" />}
      />
      <TabBar<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'market', label: 'Market' },
          { key: 'orders', label: 'My orders' },
          { key: 'watchlist', label: 'Watchlist' },
        ]}
      />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>
            Broker settlement is not yet automated: orders you place are captured with funds held
            and are executed/reconciled manually by operations. Nothing on this page is an executed
            trade unless its status says "executed". Market orders are refused when the price feed
            is stale; limit orders can always be placed.
          </Text>
        </View>

        {/* ── Market ── */}
        {tab === 'market' && (
          <View>
            <LabeledInput label="Search ticker or name" value={search} onChange={setSearch} placeholder="e.g. DANGCEM" maxLength={100} />
            <Text style={[styles.label, { marginTop: 10 }]}>Sector</Text>
            <ChipSelector<string>
              value={sector}
              onChange={setSector}
              options={[{ value: '', label: 'All sectors' }, ...((sectorsQ.data ?? []) as string[]).map((s) => ({ value: s, label: s }))]}
            />
            <TouchableOpacity style={styles.btnSecondary} onPress={() => stocksQ.refetch()} disabled={stocksQ.isFetching}>
              <Text style={styles.btnText}>{stocksQ.isFetching ? 'Refreshing...' : 'Refresh'}</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 12 }}>
              <ErrorBanner message={watchErr} />
              <SuccessNote message={watchMsg} />
              <ErrorBanner message={stocksQ.error ? investErrMsg(stocksQ.error) : null} />
            </View>
            {stocksQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!stocksQ.isLoading && !stocksQ.error && (stocksQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>No listings match.</Text>
            )}

            {(stocksQ.data ?? []).map((st: any) => {
              const change = Number(st.changePercent);
              return (
                <View key={st.id} style={styles.card}>
                  <View style={[styles.row, { gap: 6, flexWrap: 'wrap' }]}>
                    <Text style={styles.textMain}>{st.ticker}</Text>
                    <Text style={styles.textMuted}>{st.name}</Text>
                    <Badge label={st.sector} />
                    <PriceHonestyBadge stock={st} />
                  </View>
                  <Text style={[styles.textDim, { marginTop: 4 }]}>
                    Updated {fmtDateTime(st.lastUpdated)}
                    {st.marketCapNgn ? ` · mkt cap ₦${fmtMoney(st.marketCapNgn)}` : ''}
                  </Text>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <View>
                      <Text style={[styles.textMain, { fontSize: 16 }]}>₦{fmtMoney(st.currentPriceNgn)}</Text>
                      {Number.isFinite(change) && st.changePercent !== null ? (
                        <Text style={{ color: change >= 0 ? '#10b981' : '#ef4444', fontSize: 12, fontWeight: '600' }}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.row, { gap: 8 }]}>
                      <TouchableOpacity
                        style={[styles.btnSecondary, { marginTop: 0, paddingVertical: 8, paddingHorizontal: 14 }, watchBusyId === st.id && styles.btnDisabled]}
                        disabled={watchBusyId === st.id}
                        onPress={() => addWatch(st)}
                      >
                        <Text style={styles.btnText}>Watch</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, { marginTop: 0, paddingVertical: 8, paddingHorizontal: 14 }]}
                        onPress={() => setTicketStockId(ticketStockId === st.id ? null : st.id)}
                      >
                        <Text style={styles.btnText}>Trade</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {ticketStockId === st.id && <OrderTicket stock={st} onClose={() => setTicketStockId(null)} />}
                </View>
              );
            })}
          </View>
        )}

        {/* ── My orders ── */}
        {tab === 'orders' && (
          <View>
            <Text style={styles.label}>Status filter</Text>
            <ChipSelector<string>
              value={orderStatusFilter}
              onChange={setOrderStatusFilter}
              options={[
                { value: '', label: 'All' },
                { value: 'pending', label: 'pending' },
                { value: 'pending_broker', label: 'pending_broker (queued)' },
                { value: 'submitted', label: 'submitted' },
                { value: 'executed', label: 'executed' },
                { value: 'cancelled', label: 'cancelled' },
                { value: 'failed', label: 'failed' },
              ]}
            />
            <View style={{ marginTop: 12 }}>
              <ErrorBanner message={ordersQ.error ? investErrMsg(ordersQ.error) : null} />
              <ErrorBanner message={cancelErr} />
              <SuccessNote message={cancelMsg} />
            </View>
            {ordersQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!ordersQ.isLoading && !ordersQ.error && (ordersQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>No orders yet.</Text>
            )}
            {(ordersQ.data ?? []).map((o: any) => {
              const cancellable = o.status === 'pending' || o.status === 'pending_broker';
              return (
                <View key={o.id} style={styles.card}>
                  <View style={[styles.row, { gap: 6, flexWrap: 'wrap' }]}>
                    <Text style={styles.textMain}>
                      {String(o.orderType).replace('_', ' ').toUpperCase()} {o.ticker}
                    </Text>
                    <StatusBadge status={o.status} />
                    {o.status === 'pending_broker' && (
                      <Badge label="awaiting broker — ops reconciles manually" color="#f59e0b" bg="rgba(245,158,11,0.12)" />
                    )}
                    {o.status === 'submitted' && (
                      <Badge label="at broker — not yet executed" color="#38bdf8" bg="rgba(56,189,248,0.12)" />
                    )}
                  </View>
                  <Text style={[styles.textDim, { marginTop: 4 }]}>
                    {o.stockName} · {o.brokerName ?? '—'} · placed {fmtDateTime(o.createdAt)}
                    {o.executedAt ? ` · executed ${fmtDateTime(o.executedAt)}` : ' · not executed'}
                  </Text>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <Text style={styles.textBody}>
                      {o.quantityUnits} × ₦{fmtMoney(o.pricePerUnitNgn)} = <Text style={{ fontWeight: '700' }}>₦{fmtMoney(o.totalAmountNgn)}</Text>
                    </Text>
                    {cancellable && (
                      <TouchableOpacity
                        style={[styles.btnDanger, { marginTop: 0, paddingVertical: 8, paddingHorizontal: 14 }, cancelBusyId === o.id && styles.btnDisabled]}
                        disabled={cancelBusyId === o.id}
                        onPress={() => {
                          setCancelBusyId(o.id);
                          setCancelErr(null);
                          setCancelMsg(null);
                          cancelMutation.mutate({ orderId: o.id });
                        }}
                      >
                        <Text style={styles.btnText}>{cancelBusyId === o.id ? 'Cancelling...' : 'Cancel'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
            <Text style={[styles.textDim, { marginTop: 4, lineHeight: 16 }]}>
              Cancelling a pending or broker-queued buy order refunds the held NGN in the same
              transaction. Orders already submitted to the broker can only be recalled by
              operations.
            </Text>
          </View>
        )}

        {/* ── Watchlist ── */}
        {tab === 'watchlist' && (
          <View>
            <ErrorBanner message={watchlistQ.error ? investErrMsg(watchlistQ.error) : null} />
            <ErrorBanner message={watchErr} />
            {watchlistQ.isLoading ? <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} /> : null}
            {!watchlistQ.isLoading && !watchlistQ.error && (watchlistQ.data ?? []).length === 0 && (
              <Text style={styles.textMuted}>Your watchlist is empty — add listings from the Market tab.</Text>
            )}
            {(watchlistQ.data ?? []).map((w: any) => {
              const change = Number(w.changePercent);
              return (
                <View key={w.id} style={styles.card}>
                  <View style={[styles.row, { gap: 6, flexWrap: 'wrap' }]}>
                    <Text style={styles.textMain}>{w.ticker}</Text>
                    <Text style={styles.textMuted}>{w.name}</Text>
                    <Badge label={w.sector} />
                  </View>
                  <Text style={[styles.textDim, { marginTop: 4 }]}>
                    Added {fmtDateTime(w.createdAt)}
                    {w.alertPriceNgn ? ` · alert at ₦${fmtMoney(w.alertPriceNgn)}` : ''}
                    {w.notes ? ` · ${w.notes}` : ''}
                  </Text>
                  <View style={[styles.rowBetween, { marginTop: 8 }]}>
                    <View>
                      <Text style={styles.textMain}>₦{fmtMoney(w.currentPriceNgn)}</Text>
                      {Number.isFinite(change) && w.changePercent !== null ? (
                        <Text style={{ color: change >= 0 ? '#10b981' : '#ef4444', fontSize: 12, fontWeight: '600' }}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={[styles.btnSecondary, { marginTop: 0, paddingVertical: 8, paddingHorizontal: 14 }]}
                      onPress={() => {
                        setWatchErr(null);
                        removeWatchMutation.mutate({ watchlistId: w.id });
                      }}
                    >
                      <Text style={styles.btnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
