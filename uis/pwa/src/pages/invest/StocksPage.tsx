/**
 * /invest/stocks — NGX equities surface.
 *
 * Consumes the user-facing ngxStocks procedures (server/routers/investment.ts):
 *   listing browse (list / sectors / getByTicker search), watchlist
 *   (getWatchlist / addToWatchlist / removeFromWatchlist), order capture
 *   (placeOrder — tier-2 KYC + plan gate, TOTP for sells and buys above
 *   ₦1,000,000, stale-price refusal on market orders, idempotency key),
 *   positions/orders (getOrders) and cancellation with wallet refund
 *   (cancelOrder).
 *
 * HONESTY: broker settlement is NOT implemented backend-side
 * (ngxStocks.brokerWebhook always fails closed with NOT_IMPLEMENTED;
 * executions are reconciled manually by operations). This page therefore:
 *   - labels the surface "Broker connectivity in progress";
 *   - renders priceStale / priceSource badges so seed/indicative quotes are
 *     never presented as live;
 *   - never presents an order as an executed trade — order status is shown
 *     verbatim (pending_broker / submitted / ...), and brokerStatus
 *     "queued_for_ops" is explained as manual ops processing.
 * brokerWebhook and ingestPrices are deliberately not exposed in the user UI.
 */
import React, { useCallback, useEffect, useState } from "react";
import { errMsg, fmtDateTime, fmtMoney } from "../bdc/api";
import TotpField from "../bdc/TotpField";
import {
  Badge,
  Card,
  ErrorNote,
  Field,
  PageHeader,
  Spinner,
  SuccessNote,
  btnPrimaryCls,
  btnSecondaryCls,
  btnDangerCls,
  inputCls,
  statusTone,
} from "../bdc/ui";
import {
  newIdempotencyKey,
  ngxStocks,
  type NgxBroker,
  type NgxOrderResult,
  type NgxOrderRow,
  type NgxOrderType,
  type NgxStockRow,
  type WatchlistItem,
} from "./api";

const BROKERS: NgxBroker[] = ["Bamboo", "Trove", "Chaka", "Stanbic", "GTB"];
/** Mirrors the server: sells of any size and buys above this need 2FA. */
const TOTP_THRESHOLD_NGN = 1_000_000;

const PriceHonestyBadge: React.FC<{ stock: NgxStockRow }> = ({ stock }) => {
  if (stock.priceStale) {
    return (
      <Badge tone="bad">
        {stock.priceSource === "seed" ? "indicative seed price — stale" : "stale price"}
      </Badge>
    );
  }
  if (stock.priceSource === "seed") {
    return <Badge tone="warn">indicative seed price</Badge>;
  }
  return <Badge tone="ok">live feed price</Badge>;
};

// ── Order ticket ─────────────────────────────────────────────────────────────

const OrderTicket: React.FC<{
  stock: NgxStockRow;
  onClose: () => void;
  onPlaced: () => void;
}> = ({ stock, onClose, onPlaced }) => {
  const [orderType, setOrderType] = useState<NgxOrderType>("buy");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(stock.currentPriceNgn);
  const [broker, setBroker] = useState<NgxBroker>("Bamboo");
  const [notes, setNotes] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NgxOrderResult | null>(null);
  // One idempotency key per ticket opening — a retried submit replays the
  // same order server-side instead of double-debiting.
  const [idemKey] = useState(newIdempotencyKey);

  const isBuy = orderType === "buy" || orderType === "limit_buy";
  const isMarket = orderType === "buy" || orderType === "sell";
  const totalNgn = (Number(qty) || 0) * (Number(price) || 0);
  const totpLikelyRequired = !isBuy || totalNgn > TOTP_THRESHOLD_NGN;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await ngxStocks.placeOrder.mutate({
        stockId: stock.id,
        orderType,
        quantityUnits: qty,
        pricePerUnitNgn: price,
        brokerName: broker,
        notes: notes || undefined,
        idempotencyKey: idemKey,
        totpCode: totp || undefined,
      });
      setResult(res);
      setTotp("");
      onPlaced();
    } catch (e) {
      // Surfaced verbatim: tier-2 KYC/plan gate, TOTP_REQUIRED (FORBIDDEN),
      // "Price data stale — place a limit order" (BAD_REQUEST), insufficient
      // NGN balance, invalid unsigned decimals.
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-3">
        <SuccessNote>
          {result.brokerStatus === "submitted"
            ? `Order #${result.id} accepted by ${result.brokerName ?? "the broker"} (status: submitted). It is not an executed trade yet — execution is confirmed separately.`
            : `Order #${result.id} captured and funds held (status: ${result.status}). Broker connectivity is in progress — execution is queued for manual processing by operations. This is NOT an executed trade.`}
        </SuccessNote>
        {result.brokerMessage && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
            {result.brokerMessage}
          </p>
        )}
        <p className="text-xs text-slate-400">
          {result.orderType.toUpperCase()} {result.quantityUnits} × ₦
          {fmtMoney(result.pricePerUnitNgn)} = ₦{fmtMoney(result.totalAmountNgn)}
          {result.totalAmountUsd ? ` (≈ $${fmtMoney(result.totalAmountUsd)})` : ""}
          {result.idempotent ? " · idempotent replay of your previous submit" : ""}
        </p>
        <button className={btnSecondaryCls} onClick={onClose}>
          Close ticket
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Order type">
          <select
            className={inputCls}
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as NgxOrderType)}
          >
            <option value="buy">Buy (market)</option>
            <option value="sell">Sell (market)</option>
            <option value="limit_buy">Limit buy</option>
            <option value="limit_sell">Limit sell</option>
          </select>
        </Field>
        <Field label="Broker">
          <select
            className={inputCls}
            value={broker}
            onChange={(e) => setBroker(e.target.value as NgxBroker)}
          >
            {BROKERS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity (units)">
          <input
            className={inputCls}
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="e.g. 100"
          />
        </Field>
        <Field
          label="Price per unit (NGN)"
          hint={isMarket ? "Market orders trade at the displayed price and are refused if it is stale" : "Limit orders proceed at your price"}
        >
          <input
            className={inputCls}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
        />
      </Field>
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <TotpField
          value={totp}
          onChange={setTotp}
          label={
            totpLikelyRequired
              ? "TOTP step-up code (required for this order)"
              : "TOTP step-up code (if enrolled)"
          }
        />
        <div className="text-sm text-slate-600">
          Estimated total:{" "}
          <span className="font-semibold">₦{fmtMoney(totalNgn)}</span>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
      <div className="flex items-center gap-2">
        <button
          className={btnPrimaryCls}
          disabled={busy || !qty || !price || Number(qty) <= 0 || Number(price) <= 0}
          onClick={submit}
        >
          {busy ? "Placing order..." : `Place ${orderType.replace("_", " ")} order`}
        </button>
        <button className={btnSecondaryCls} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-slate-400">
        {isBuy
          ? "Your NGN wallet is debited at order time as the hold backing this order; cancelling a queued order refunds it."
          : "Sell orders reduce your position when executed by the broker/operations."}{" "}
        Tier-2 KYC and an eligible plan are required. Broker settlement is in
        progress — an accepted order is a captured instruction, not an executed
        trade.
      </p>
    </div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────

type Tab = "market" | "orders" | "watchlist";

const StocksPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("market");

  // Market
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [sectors, setSectors] = useState<string[]>([]);
  const [stocks, setStocks] = useState<NgxStockRow[]>([]);
  const [stocksLoading, setStocksLoading] = useState(true);
  const [stocksErr, setStocksErr] = useState<string | null>(null);
  const [ticketStock, setTicketStock] = useState<NgxStockRow | null>(null);
  const [watchBusy, setWatchBusy] = useState<number | null>(null);
  const [watchMsg, setWatchMsg] = useState<string | null>(null);
  const [watchErr, setWatchErr] = useState<string | null>(null);

  // Orders
  const [orders, setOrders] = useState<NgxOrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersErr, setOrdersErr] = useState<string | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState("");
  const [cancelBusy, setCancelBusy] = useState<number | null>(null);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  // Watchlist
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [wlLoading, setWlLoading] = useState(false);
  const [wlErr, setWlErr] = useState<string | null>(null);

  const loadStocks = useCallback(async () => {
    setStocksLoading(true);
    setStocksErr(null);
    try {
      const res = await ngxStocks.list.query({
        search: search || undefined,
        sector: sector || undefined,
        limit: 50,
        offset: 0,
      });
      setStocks(res);
    } catch (e) {
      setStocksErr(errMsg(e));
      setStocks([]);
    } finally {
      setStocksLoading(false);
    }
  }, [search, sector]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersErr(null);
    try {
      setOrders(
        await ngxStocks.getOrders.query({
          status: orderStatusFilter || undefined,
          limit: 50,
          offset: 0,
        }),
      );
    } catch (e) {
      setOrdersErr(errMsg(e));
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [orderStatusFilter]);

  const loadWatchlist = useCallback(async () => {
    setWlLoading(true);
    setWlErr(null);
    try {
      setWatchlist(await ngxStocks.getWatchlist.query());
    } catch (e) {
      setWlErr(errMsg(e));
      setWatchlist([]);
    } finally {
      setWlLoading(false);
    }
  }, []);

  useEffect(() => {
    ngxStocks.sectors
      .query()
      .then(setSectors)
      .catch(() => setSectors([]));
  }, []);

  useEffect(() => {
    if (tab === "market") loadStocks();
    if (tab === "orders") loadOrders();
    if (tab === "watchlist") loadWatchlist();
  }, [tab, loadStocks, loadOrders, loadWatchlist]);

  const addWatch = async (stock: NgxStockRow) => {
    setWatchBusy(stock.id);
    setWatchErr(null);
    setWatchMsg(null);
    try {
      await ngxStocks.addToWatchlist.mutate({ stockId: stock.id });
      setWatchMsg(`${stock.ticker} added to your watchlist.`);
    } catch (e) {
      // CONFLICT: already in watchlist.
      setWatchErr(errMsg(e));
    } finally {
      setWatchBusy(null);
    }
  };

  const removeWatch = async (watchlistId: number) => {
    setWlErr(null);
    try {
      await ngxStocks.removeFromWatchlist.mutate({ watchlistId });
      await loadWatchlist();
    } catch (e) {
      setWlErr(errMsg(e));
    }
  };

  const cancelOrder = async (orderId: number) => {
    setCancelBusy(orderId);
    setCancelErr(null);
    setCancelMsg(null);
    try {
      const res = await ngxStocks.cancelOrder.mutate({ orderId });
      setCancelMsg(
        res.refunded
          ? `Order #${orderId} cancelled and the held NGN was refunded to your wallet.`
          : `Order #${orderId} cancelled (no wallet refund applicable).`,
      );
      await loadOrders();
    } catch (e) {
      // BAD_REQUEST: already submitted to broker — ops must recall.
      setCancelErr(errMsg(e));
    } finally {
      setCancelBusy(null);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "market", label: "Market" },
    { key: "orders", label: "My orders" },
    { key: "watchlist", label: "Watchlist" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="NGX Stocks"
          subtitle="Nigerian Exchange equities — browse, watchlist, and place orders from your NGN wallet."
        />
        <Badge tone="warn">Broker connectivity in progress</Badge>
      </div>

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
        Broker settlement is not yet automated: orders you place are captured
        with funds held and are executed/reconciled manually by operations.
        Nothing on this page is an executed trade unless its status says
        &quot;executed&quot;. Market orders are refused when the price feed is
        stale; limit orders can always be placed.
      </div>

      <div className="flex gap-2 border-b border-slate-100">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors ${
              tab === t.key
                ? "bg-indigo-50 text-indigo-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Market ── */}
      {tab === "market" && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <Field label="Search ticker or name">
                <input
                  className={inputCls}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. DANGCEM"
                  maxLength={100}
                />
              </Field>
              <Field label="Sector">
                <select
                  className={inputCls}
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                >
                  <option value="">All sectors</option>
                  {sectors.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <button className={btnSecondaryCls} onClick={loadStocks} disabled={stocksLoading}>
                Refresh
              </button>
            </div>
          </Card>

          {watchErr && <ErrorNote error={watchErr} />}
          {watchMsg && <SuccessNote>{watchMsg}</SuccessNote>}
          {stocksErr && <ErrorNote error={stocksErr} />}
          {stocksLoading && <Spinner label="Loading listings..." />}
          {!stocksLoading && !stocksErr && stocks.length === 0 && (
            <p className="text-sm text-slate-400">No listings match.</p>
          )}

          <div className="space-y-3">
            {stocks.map((s) => {
              const change = Number(s.changePercent);
              return (
                <Card key={s.id}>
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">{s.ticker}</span>
                        <span className="text-sm text-slate-500">{s.name}</span>
                        <Badge tone="neutral">{s.sector}</Badge>
                        <PriceHonestyBadge stock={s} />
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Updated {fmtDateTime(s.lastUpdated)}
                        {s.marketCapNgn ? ` · mkt cap ₦${fmtMoney(s.marketCapNgn)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-lg font-semibold text-slate-900">
                          ₦{fmtMoney(s.currentPriceNgn)}
                        </p>
                        {Number.isFinite(change) && s.changePercent !== null && (
                          <p
                            className={`text-xs font-medium ${
                              change >= 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {change >= 0 ? "+" : ""}
                            {change.toFixed(2)}%
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          className={btnSecondaryCls}
                          disabled={watchBusy === s.id}
                          onClick={() => addWatch(s)}
                        >
                          Watch
                        </button>
                        <button
                          className={btnPrimaryCls}
                          onClick={() =>
                            setTicketStock(ticketStock?.id === s.id ? null : s)
                          }
                        >
                          Trade
                        </button>
                      </div>
                    </div>
                  </div>
                  {ticketStock?.id === s.id && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <OrderTicket
                        stock={s}
                        onClose={() => setTicketStock(null)}
                        onPlaced={loadOrders}
                      />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── My orders ── */}
      {tab === "orders" && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <Field label="Status filter">
                <select
                  className={inputCls}
                  value={orderStatusFilter}
                  onChange={(e) => setOrderStatusFilter(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="pending">pending</option>
                  <option value="pending_broker">pending_broker (queued)</option>
                  <option value="submitted">submitted</option>
                  <option value="executed">executed</option>
                  <option value="cancelled">cancelled</option>
                  <option value="failed">failed</option>
                </select>
              </Field>
              <button className={btnSecondaryCls} onClick={loadOrders} disabled={ordersLoading}>
                Refresh
              </button>
            </div>
          </Card>
          {ordersErr && <ErrorNote error={ordersErr} />}
          {cancelErr && <ErrorNote error={cancelErr} />}
          {cancelMsg && <SuccessNote>{cancelMsg}</SuccessNote>}
          {ordersLoading && <Spinner label="Loading orders..." />}
          {!ordersLoading && !ordersErr && orders.length === 0 && (
            <p className="text-sm text-slate-400">No orders yet.</p>
          )}
          {orders.map((o) => {
            const cancellable = o.status === "pending" || o.status === "pending_broker";
            return (
              <Card key={o.id}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        {o.orderType.replace("_", " ").toUpperCase()} {o.ticker}
                      </span>
                      <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                      {o.status === "pending_broker" && (
                        <Badge tone="warn">awaiting broker — ops reconciles manually</Badge>
                      )}
                      {o.status === "submitted" && (
                        <Badge tone="info">at broker — not yet executed</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {o.stockName} · {o.brokerName ?? "—"} · placed {fmtDateTime(o.createdAt)}
                      {o.executedAt ? ` · executed ${fmtDateTime(o.executedAt)}` : " · not executed"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm text-slate-700">
                      {o.quantityUnits} × ₦{fmtMoney(o.pricePerUnitNgn)} ={" "}
                      <span className="font-semibold">₦{fmtMoney(o.totalAmountNgn)}</span>
                    </div>
                    {cancellable && (
                      <button
                        className={btnDangerCls}
                        disabled={cancelBusy === o.id}
                        onClick={() => cancelOrder(o.id)}
                      >
                        {cancelBusy === o.id ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
          <p className="text-xs text-slate-400">
            Cancelling a pending or broker-queued buy order refunds the held NGN
            in the same transaction. Orders already submitted to the broker can
            only be recalled by operations.
          </p>
        </div>
      )}

      {/* ── Watchlist ── */}
      {tab === "watchlist" && (
        <div className="space-y-4">
          {wlErr && <ErrorNote error={wlErr} />}
          {wlLoading && <Spinner label="Loading watchlist..." />}
          {!wlLoading && !wlErr && watchlist.length === 0 && (
            <p className="text-sm text-slate-400">
              Your watchlist is empty — add listings from the Market tab.
            </p>
          )}
          {watchlist.map((w) => {
            const change = Number(w.changePercent);
            return (
              <Card key={w.id}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{w.ticker}</span>
                      <span className="text-sm text-slate-500">{w.name}</span>
                      <Badge tone="neutral">{w.sector}</Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Added {fmtDateTime(w.createdAt)}
                      {w.alertPriceNgn ? ` · alert at ₦${fmtMoney(w.alertPriceNgn)}` : ""}
                      {w.notes ? ` · ${w.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">
                        ₦{fmtMoney(w.currentPriceNgn)}
                      </p>
                      {Number.isFinite(change) && w.changePercent !== null && (
                        <p
                          className={`text-xs font-medium ${
                            change >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {change >= 0 ? "+" : ""}
                          {change.toFixed(2)}%
                        </p>
                      )}
                    </div>
                    <button
                      className={btnSecondaryCls}
                      onClick={() => removeWatch(w.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StocksPage;
