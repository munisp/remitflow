/**
 * /invest/bonds — diaspora bond surface.
 *
 * Wires the full user-facing lifecycle of the diasporaBond router
 * (server/routers/diasporaBond.ts):
 *   browse offerings (listBonds) → subscribe happens on the detail page
 *   (getBond / getSubscriptionQuote / subscribe) → my holdings
 *   (getMySubscriptions) with coupons (getCouponHistory), off-rail payment
 *   confirmation (confirmPayment, TOTP step-up), secondary-market listing
 *   (createSellOrder) and early redemption (requestEarlyRedemption, TOTP
 *   step-up) → secondary market browse/buy (listSecondaryOrders /
 *   fillBuyOrder, TOTP step-up).
 *
 * Admin-only procedures (adminConfirmPayment, processUpcomingCoupons) are
 * intentionally not exposed here.
 *
 * All backend guards are preserved and their errors surfaced verbatim:
 * tier-2 KYC + plan gate (assertFeatureEligible), whole-multiple-of-face-value
 * rule, guarded USD debits, TOTP step-up, tranche remaining cap.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  diasporaBond,
  type BondRow,
  type BondStatus,
  type CouponHistory,
  type MySubscriptionItem,
  type MySubscriptions,
  type SecondaryOrder,
} from "./api";

const MIN_SUBSCRIPTION_USD = 500;

// ── Holdings: per-subscription action panel ──────────────────────────────────

const SubscriptionPanel: React.FC<{
  item: MySubscriptionItem;
  onChanged: () => void;
}> = ({ item, onChanged }) => {
  const sub = item.subscription;
  const [coupons, setCoupons] = useState<CouponHistory | null>(null);
  const [couponsErr, setCouponsErr] = useState<string | null>(null);
  const [couponsLoading, setCouponsLoading] = useState(false);

  // Sell-order form
  const [sellUnits, setSellUnits] = useState("");
  const [sellAsk, setSellAsk] = useState("");
  const [sellDays, setSellDays] = useState("7");

  // Early-redemption form
  const [redeemReason, setRedeemReason] = useState("");
  const [redeemTotp, setRedeemTotp] = useState("");

  // Off-rail payment confirmation (pending_payment subscriptions)
  const [payRef, setPayRef] = useState("");
  const [payTotp, setPayTotp] = useState("");

  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [actMsg, setActMsg] = useState<string | null>(null);

  const loadCoupons = async () => {
    setCouponsLoading(true);
    setCouponsErr(null);
    try {
      setCoupons(await diasporaBond.getCouponHistory.query({ subscriptionId: sub.id }));
    } catch (e) {
      setCouponsErr(errMsg(e));
    } finally {
      setCouponsLoading(false);
    }
  };

  const createSell = async () => {
    setBusy(true);
    setActErr(null);
    setActMsg(null);
    try {
      const res = await diasporaBond.createSellOrder.mutate({
        subscriptionId: sub.id,
        unitsToSell: Number(sellUnits),
        askPriceUsd: Number(sellAsk),
        expiresInDays: Number(sellDays) || 7,
      });
      setActMsg(
        `Sell order #${res.order.id} created: ${res.order.units} unit(s) at $${fmtMoney(res.order.askPrice)} ask. ` +
          `Fair value $${fmtMoney(res.fairValue)} (${res.premiumDiscount >= 0 ? "+" : ""}${res.premiumDiscount.toFixed(2)}% vs fair). ` +
          `You receive the full ask $${fmtMoney(res.netProceeds)} — the 0.5% platform fee ($${fmtMoney(res.buyerPaidFee)}) is paid by the buyer on top.`,
      );
      setSellUnits("");
      setSellAsk("");
      onChanged();
    } catch (e) {
      // BAD_REQUEST: not active / too many units / fractional units.
      setActErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    setBusy(true);
    setActErr(null);
    setActMsg(null);
    try {
      const res = await diasporaBond.requestEarlyRedemption.mutate({
        subscriptionId: sub.id,
        reason: redeemReason || undefined,
        totpCode: redeemTotp || undefined,
      });
      setActMsg(
        `Early redemption completed: principal $${fmtMoney(res.principalUsd)} minus ${(res.penaltyRate * 100).toFixed(0)}% penalty ` +
          `($${fmtMoney(res.penalty)}) = $${fmtMoney(res.redemptionAmount)} credited to your USD wallet.`,
      );
      setRedeemTotp("");
      onChanged();
    } catch (e) {
      // PRECONDITION_FAILED: 2FA code required; UNAUTHORIZED: invalid code;
      // CONFLICT: already redeemed; PRECONDITION_FAILED: float unfunded.
      setActErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmPayment = async () => {
    setBusy(true);
    setActErr(null);
    setActMsg(null);
    try {
      await diasporaBond.confirmPayment.mutate({
        subscriptionId: sub.id,
        paymentReference: payRef,
        totpCode: payTotp || undefined,
      });
      setActMsg(
        "Payment confirmed — the subscription is now active and accrues coupons.",
      );
      setPayRef("");
      setPayTotp("");
      onChanged();
    } catch (e) {
      // PRECONDITION_FAILED: 2FA code required; CONFLICT: reference reused or
      // subscription no longer pending_payment.
      setActErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const isActive = sub.status === "active";

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
      {actErr && <ErrorNote error={actErr} />}
      {actMsg && <SuccessNote>{actMsg}</SuccessNote>}

      {/* Coupons */}
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-slate-700">Coupon payments</h3>
          <button
            className={btnSecondaryCls}
            onClick={loadCoupons}
            disabled={couponsLoading}
          >
            {coupons ? "Refresh coupons" : "Load coupons"}
          </button>
        </div>
        {couponsErr && <div className="mt-2"><ErrorNote error={couponsErr} /></div>}
        {couponsLoading && <Spinner label="Loading coupons..." />}
        {coupons && (
          <div className="mt-2">
            <p className="text-xs text-slate-500 mb-2">
              Total received: ${fmtMoney(coupons.totalReceived)} ·{" "}
              {coupons.coupons.length} coupon record(s)
            </p>
            {coupons.coupons.length === 0 ? (
              <p className="text-xs text-slate-400">
                No coupons recorded yet — coupon processing runs when each
                period falls due.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">Scheduled</th>
                    <th className="py-1 pr-2">Amount</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.coupons.map((c) => (
                    <tr key={c.id} className="border-t border-slate-50">
                      <td className="py-1 pr-2">{c.couponNumber}</td>
                      <td className="py-1 pr-2">{fmtDateTime(c.scheduledDate)}</td>
                      <td className="py-1 pr-2">${fmtMoney(c.netAmount)}</td>
                      <td className="py-1 pr-2">
                        <Badge tone={statusTone(c.status)}>{c.status ?? "—"}</Badge>
                      </td>
                      <td className="py-1">{c.paidDate ? fmtDateTime(c.paidDate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Off-rail payment confirmation */}
      {sub.status === "pending_payment" && (
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl space-y-3">
          <p className="text-sm text-amber-700">
            This subscription is awaiting payment confirmation. If you paid by
            bank transfer or card, enter the payment reference to activate it.
            Requires your 6-digit 2FA code.
          </p>
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <Field label="Payment reference">
              <input
                className={inputCls}
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. bank transfer receipt reference"
              />
            </Field>
            <TotpField value={payTotp} onChange={setPayTotp} />
            <button
              className={btnPrimaryCls}
              disabled={busy || payRef.trim().length < 4}
              onClick={confirmPayment}
            >
              Confirm payment
            </button>
          </div>
        </div>
      )}

      {isActive && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sell on secondary market */}
          <div className="p-3 bg-slate-50 rounded-xl space-y-3">
            <h3 className="text-xs font-semibold text-slate-700">
              Sell on secondary market
            </h3>
            <p className="text-xs text-slate-500">
              Units must be a whole number; you hold {sub.units}. You receive
              the full ask — the 0.5% platform fee is charged to the buyer.
            </p>
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <Field label="Units to sell">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={sellUnits}
                  onChange={(e) => setSellUnits(e.target.value.replace(/\D/g, ""))}
                  placeholder={String(sub.units)}
                />
              </Field>
              <Field label="Ask price per unit (USD)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={sellAsk}
                  onChange={(e) => setSellAsk(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder={item.bond?.faceValue ?? "1000.00"}
                />
              </Field>
              <Field label="Expires in (days)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={sellDays}
                  onChange={(e) => setSellDays(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <button
                className={btnPrimaryCls}
                disabled={
                  busy ||
                  !sellUnits ||
                  !sellAsk ||
                  Number(sellUnits) <= 0 ||
                  Number(sellUnits) > sub.units ||
                  Number(sellAsk) <= 0
                }
                onClick={createSell}
              >
                List sell order
              </button>
            </div>
          </div>

          {/* Early redemption */}
          <div className="p-3 bg-red-50/60 border border-red-100 rounded-xl space-y-3">
            <h3 className="text-xs font-semibold text-slate-700">
              Early redemption
            </h3>
            <p className="text-xs text-slate-500">
              Redeem before maturity: principal minus a 2% penalty is credited
              to your USD wallet immediately. Requires your 6-digit 2FA code.
              This cannot be undone.
            </p>
            <Field label="Reason (optional)">
              <input
                className={inputCls}
                value={redeemReason}
                onChange={(e) => setRedeemReason(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <div className="flex items-end gap-3">
              <TotpField value={redeemTotp} onChange={setRedeemTotp} />
              <button
                className={btnDangerCls}
                disabled={busy}
                onClick={redeem}
              >
                Redeem early
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────

type Tab = "offerings" | "holdings" | "secondary";

const BondsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("offerings");

  // Offerings
  const [statusFilter, setStatusFilter] = useState<BondStatus>("open");
  const [minYield, setMinYield] = useState("");
  const [bonds, setBonds] = useState<BondRow[]>([]);
  const [bondsLoading, setBondsLoading] = useState(true);
  const [bondsErr, setBondsErr] = useState<string | null>(null);

  // Holdings
  const [mine, setMine] = useState<MySubscriptions | null>(null);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineErr, setMineErr] = useState<string | null>(null);
  const [expandedSub, setExpandedSub] = useState<number | null>(null);

  // Secondary market
  const [orders, setOrders] = useState<SecondaryOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersErr, setOrdersErr] = useState<string | null>(null);
  const [fillBusy, setFillBusy] = useState<number | null>(null);
  const [fillErr, setFillErr] = useState<string | null>(null);
  const [fillMsg, setFillMsg] = useState<string | null>(null);
  const [fillTotp, setFillTotp] = useState<Record<number, string>>({});
  const [fillUnits, setFillUnits] = useState<Record<number, string>>({});

  const loadBonds = useCallback(async () => {
    setBondsLoading(true);
    setBondsErr(null);
    try {
      const res = await diasporaBond.listBonds.query({
        status: statusFilter,
        minYield: minYield ? Number(minYield) / 100 : undefined,
      });
      setBonds(res);
    } catch (e) {
      setBondsErr(errMsg(e));
      setBonds([]);
    } finally {
      setBondsLoading(false);
    }
  }, [statusFilter, minYield]);

  const loadMine = useCallback(async () => {
    setMineLoading(true);
    setMineErr(null);
    try {
      setMine(await diasporaBond.getMySubscriptions.query());
    } catch (e) {
      setMineErr(errMsg(e));
      setMine(null);
    } finally {
      setMineLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersErr(null);
    try {
      setOrders(await diasporaBond.listSecondaryOrders.query({ side: "all" }));
    } catch (e) {
      setOrdersErr(errMsg(e));
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "offerings") loadBonds();
    if (tab === "holdings") loadMine();
    if (tab === "secondary") loadOrders();
  }, [tab, loadBonds, loadMine, loadOrders]);

  const fill = async (order: SecondaryOrder) => {
    setFillBusy(order.id);
    setFillErr(null);
    setFillMsg(null);
    try {
      const unitsRaw = fillUnits[order.id];
      const res = await diasporaBond.fillBuyOrder.mutate({
        orderId: order.id,
        unitsToFill: unitsRaw ? Number(unitsRaw) : undefined,
        totpCode: fillTotp[order.id] || undefined,
      });
      setFillMsg(
        `Bought ${res.unitsAcquired} unit(s) for $${fmtMoney(res.totalCost)} + $${fmtMoney(res.platformFee)} platform fee. ` +
          `The units are now in your holdings as an active subscription.`,
      );
      setFillTotp((m) => ({ ...m, [order.id]: "" }));
      await loadOrders();
    } catch (e) {
      // PRECONDITION_FAILED: 2FA code required; BAD_REQUEST: own order /
      // expired / insufficient balance; CONFLICT: concurrent fill.
      setFillErr(errMsg(e));
    } finally {
      setFillBusy(null);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "offerings", label: "Offerings" },
    { key: "holdings", label: "My holdings" },
    { key: "secondary", label: "Secondary market" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diaspora Bonds"
        subtitle="Browse open offerings, subscribe from your USD wallet, track coupons, trade on the secondary market, or redeem early (2% penalty)."
      />

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

      {/* ── Offerings ── */}
      {tab === "offerings" && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <Field label="Status">
                <select
                  className={inputCls}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as BondStatus)}
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="matured">Matured</option>
                  <option value="all">All</option>
                </select>
              </Field>
              <Field label="Min coupon yield (%)" hint="Optional">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={minYield}
                  onChange={(e) => setMinYield(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="e.g. 6"
                />
              </Field>
              <button className={btnSecondaryCls} onClick={loadBonds} disabled={bondsLoading}>
                Refresh
              </button>
            </div>
          </Card>

          {bondsErr && <ErrorNote error={bondsErr} />}
          {bondsLoading && <Spinner label="Loading offerings..." />}
          {!bondsLoading && !bondsErr && bonds.length === 0 && (
            <p className="text-sm text-slate-400">
              No bonds match this filter.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {bonds.map((b) => {
              const fillPct =
                (Number(b.raisedAmount ?? 0) / Math.max(1, Number(b.targetRaise ?? 0))) * 100;
              return (
                <Link
                  key={b.id}
                  to={`/invest/bonds/${b.id}`}
                  className="block bg-white rounded-2xl border border-slate-100 p-5 hover:border-indigo-200 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{b.name}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {b.issuer}
                        {b.isin ? ` · ISIN ${b.isin}` : ""}
                        {b.creditRating ? ` · ${b.creditRating}` : ""}
                      </p>
                    </div>
                    <Badge tone={statusTone(b.status)}>{b.status ?? "—"}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                    <div>
                      <p className="text-xs text-slate-400">Coupon</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {(Number(b.couponRate) * 100).toFixed(2)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Face value</p>
                      <p className="text-sm font-semibold text-slate-900">
                        ${fmtMoney(b.faceValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Maturity</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {fmtDateTime(b.maturityDate).split(",")[0]}
                      </p>
                    </div>
                  </div>
                  {b.targetRaise && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>Raised ${fmtMoney(b.raisedAmount)}</span>
                        <span>{Math.min(100, fillPct).toFixed(0)}% of ${fmtMoney(b.targetRaise)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.min(100, fillPct)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-slate-400">
            Minimum subscription ${MIN_SUBSCRIPTION_USD.toLocaleString()} USD;
            amounts must be a whole multiple of the bond face value (backend
            enforced).
          </p>
        </div>
      )}

      {/* ── My holdings ── */}
      {tab === "holdings" && (
        <div className="space-y-4">
          {mineErr && <ErrorNote error={mineErr} />}
          {mineLoading && <Spinner label="Loading holdings..." />}
          {mine && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  ["Total invested", `$${fmtMoney(mine.summary.totalInvested)}`],
                  ["Current value", `$${fmtMoney(mine.summary.totalCurrentValue)}`],
                  [
                    "Unrealized P&L",
                    `${mine.summary.totalPnl >= 0 ? "+" : ""}$${fmtMoney(mine.summary.totalPnl)} (${mine.summary.totalPnlPct.toFixed(2)}%)`,
                  ],
                  [
                    "Positions",
                    `${mine.summary.activeCount} active · ${mine.summary.maturedCount} matured`,
                  ],
                ].map(([label, value]) => (
                  <Card key={label}>
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-lg font-semibold text-slate-900 mt-1">{value}</p>
                  </Card>
                ))}
              </div>

              {mine.subscriptions.length === 0 && (
                <p className="text-sm text-slate-400">
                  No subscriptions yet — browse the offerings tab to subscribe.
                </p>
              )}

              {mine.subscriptions.map((item) => {
                const sub = item.subscription;
                const expanded = expandedSub === sub.id;
                return (
                  <Card key={sub.id}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900">
                            {item.bond?.name ?? `Bond #${sub.bondId}`}
                          </h3>
                          <Badge tone={statusTone(sub.status)}>{sub.status ?? "—"}</Badge>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {sub.subscriptionRef} · {sub.units} unit(s) · purchased{" "}
                          {fmtDateTime(sub.purchasedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-slate-400">Current value</p>
                          <p className="text-sm font-semibold text-slate-900">
                            ${fmtMoney(item.currentValue)}{" "}
                            <span
                              className={
                                item.pnl >= 0 ? "text-emerald-600" : "text-red-600"
                              }
                            >
                              ({item.pnl >= 0 ? "+" : ""}
                              {fmtMoney(item.pnl)})
                            </span>
                          </p>
                        </div>
                        <button
                          className={btnSecondaryCls}
                          onClick={() =>
                            setExpandedSub(expanded ? null : sub.id)
                          }
                        >
                          {expanded ? "Hide actions" : "Actions"}
                        </button>
                      </div>
                    </div>
                    {expanded && (
                      <SubscriptionPanel item={item} onChanged={loadMine} />
                    )}
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── Secondary market ── */}
      {tab === "secondary" && (
        <div className="space-y-4">
          {ordersErr && <ErrorNote error={ordersErr} />}
          {fillErr && <ErrorNote error={fillErr} />}
          {fillMsg && <SuccessNote>{fillMsg}</SuccessNote>}
          {ordersLoading && <Spinner label="Loading open orders..." />}
          {!ordersLoading && !ordersErr && orders.length === 0 && (
            <p className="text-sm text-slate-400">
              No open secondary-market orders right now.
            </p>
          )}
          {orders.map((o) => (
            <Card key={o.id}>
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {o.bondName ?? `Bond #${o.bondId}`}
                    </h3>
                    <Badge tone={statusTone(o.status)}>{o.status ?? "—"}</Badge>
                    <Badge tone="info">{o.orderType ?? "sell"}</Badge>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {o.issuerName ? `${o.issuerName} · ` : ""}
                    {o.couponRate ? `coupon ${(Number(o.couponRate) * 100).toFixed(2)}% · ` : ""}
                    listed {fmtDateTime(o.createdAt)}
                    {o.expiresAt ? ` · expires ${fmtDateTime(o.expiresAt)}` : ""}
                  </p>
                  <p className="text-sm text-slate-700 mt-2">
                    {o.units} unit(s) @ ${fmtMoney(o.askPrice)} = $
                    {fmtMoney(o.totalValue)}{" "}
                    <span className="text-xs text-slate-400">
                      + 0.5% buyer fee (${fmtMoney(Number(o.totalValue ?? 0) * 0.005)})
                    </span>
                  </p>
                </div>
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                  <Field label="Units to buy (blank = all)">
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      value={fillUnits[o.id] ?? ""}
                      onChange={(e) =>
                        setFillUnits((m) => ({
                          ...m,
                          [o.id]: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                      placeholder={String(o.units)}
                    />
                  </Field>
                  <TotpField
                    value={fillTotp[o.id] ?? ""}
                    onChange={(v) => setFillTotp((m) => ({ ...m, [o.id]: v }))}
                  />
                  <button
                    className={btnPrimaryCls}
                    disabled={fillBusy === o.id}
                    onClick={() => fill(o)}
                  >
                    {fillBusy === o.id ? "Filling..." : "Buy units"}
                  </button>
                </div>
              </div>
            </Card>
          ))}
          <p className="text-xs text-slate-400">
            Fills are atomic and guarded server-side: your USD wallet is debited
            only if the order is still open and fully funded settlement is
            possible. Buying requires tier-2 KYC and your 6-digit 2FA code.
          </p>
        </div>
      )}
    </div>
  );
};

export default BondsPage;
