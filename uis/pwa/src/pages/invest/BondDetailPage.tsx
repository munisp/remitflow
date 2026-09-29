/**
 * /invest/bonds/:bondId — bond detail + subscribe flow.
 *
 * Consumes diasporaBond.getBond (detail + live pricing), getSubscriptionQuote
 * (pre-trade estimate) and subscribe (KYC-gated, guarded USD debit, TOTP
 * step-up). All backend rejections — terms not accepted, below minimum, not
 * a whole multiple of face value, tranche remaining cap, KYC gate, 2FA
 * required/invalid, insufficient balance, float not provisioned — are shown
 * verbatim. The subscription result honestly distinguishes "active" (wallet
 * debit settled) from "pending_payment" (off-rail payment still to be
 * confirmed).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  inputCls,
  statusTone,
} from "../bdc/ui";
import {
  diasporaBond,
  type BondDetail,
  type SubscribeResult,
  type SubscriptionQuote,
} from "./api";

const MIN_SUBSCRIPTION_USD = 500;

const BondDetailPage: React.FC = () => {
  const { bondId } = useParams<{ bondId: string }>();
  const id = Number(bondId);

  const [bond, setBond] = useState<BondDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amountUsd, setAmountUsd] = useState("");
  const [quote, setQuote] = useState<SubscriptionQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [paymentSource, setPaymentSource] = useState<"wallet" | "bank_transfer" | "card">("wallet");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [totp, setTotp] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [subErr, setSubErr] = useState<string | null>(null);
  const [subResult, setSubResult] = useState<SubscribeResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBond(await diasporaBond.getBond.query({ id }));
    } catch (e) {
      setError(errMsg(e));
      setBond(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (Number.isInteger(id) && id > 0) load();
    else {
      setError("Invalid bond id");
      setLoading(false);
    }
  }, [id, load]);

  const runQuote = async () => {
    setQuoteLoading(true);
    setQuoteErr(null);
    setQuote(null);
    try {
      const res = await diasporaBond.getSubscriptionQuote.query({
        bondId: id,
        amountUsd: Number(amountUsd),
      });
      setQuote(res);
    } catch (e) {
      // BAD_REQUEST: below minimum / above tranche remaining / bond not open.
      setQuoteErr(errMsg(e));
    } finally {
      setQuoteLoading(false);
    }
  };

  const subscribe = async () => {
    setSubscribing(true);
    setSubErr(null);
    setSubResult(null);
    try {
      const res = await diasporaBond.subscribe.mutate({
        bondId: id,
        amountUsd: Number(amountUsd),
        paymentSource,
        acceptedTerms,
        totpCode: totp || undefined,
      });
      setSubResult(res);
      setTotp("");
      await load();
    } catch (e) {
      // FORBIDDEN: KYC required; PRECONDITION_FAILED: 2FA code required;
      // UNAUTHORIZED: invalid 2FA; BAD_REQUEST: amount/balance rules;
      // CONFLICT: concurrent debit; PRECONDITION_FAILED: float not provisioned.
      setSubErr(errMsg(e));
    } finally {
      setSubscribing(false);
    }
  };

  if (loading) return <Spinner label="Loading bond..." />;
  if (error) return <ErrorNote error={error} />;
  if (!bond) return null;

  const isOpen = bond.status === "open";
  const faceValue = Number(bond.faceValue);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/invest/bonds" className="text-sm text-indigo-600 hover:underline">
          ← All bond offerings
        </Link>
      </div>

      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title={bond.name}
          subtitle={`${bond.issuer}${bond.isin ? ` · ISIN ${bond.isin}` : ""}${bond.creditRating ? ` · rated ${bond.creditRating}${bond.ratingAgency ? ` by ${bond.ratingAgency}` : ""}` : ""}`}
        />
        <Badge tone={statusTone(bond.status)}>{bond.status ?? "—"}</Badge>
      </div>

      {bond.description && (
        <Card>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{bond.description}</p>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Coupon rate", `${(Number(bond.couponRate) * 100).toFixed(2)}% ${bond.couponFrequency ?? ""}`],
          ["Face value", `$${fmtMoney(bond.faceValue)}`],
          ["Maturity", fmtDateTime(bond.maturityDate).split(",")[0]],
          ["Next coupon", fmtDateTime(bond.nextCouponDate).split(",")[0]],
          ["Clean price", `$${fmtMoney(bond.pricing.cleanPrice)}`],
          ["Dirty price", `$${fmtMoney(bond.pricing.dirtyPrice)}`],
          ["YTM (indicative)", `${(bond.pricing.yieldToMaturity * 100).toFixed(2)}%`],
          ["Mod. duration", bond.pricing.modifiedDuration.toFixed(2)],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="text-sm font-semibold text-slate-900 mt-1">{value}</p>
          </Card>
        ))}
      </div>

      <Card title="Raise progress">
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>Raised ${fmtMoney(bond.raisedAmount)}</span>
          <span>
            {bond.fillPercentage.toFixed(1)}% of ${fmtMoney(bond.targetRaise)}
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full"
            style={{ width: `${bond.fillPercentage}%` }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Offer window {fmtDateTime(bond.offerOpenDate).split(",")[0]} →{" "}
          {fmtDateTime(bond.offerCloseDate).split(",")[0]}
          {bond.eligibleCountries && bond.eligibleCountries.length > 0
            ? ` · eligible countries: ${bond.eligibleCountries.join(", ")}`
            : ""}
          {bond.isTaxExempt ? " · tax-exempt" : ""}
        </p>
        {bond.prospectusUrl && (
          <a
            href={bond.prospectusUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-2 text-sm text-indigo-600 hover:underline"
          >
            View prospectus →
          </a>
        )}
      </Card>

      {/* ── Subscribe ── */}
      <Card title="Subscribe">
        {!isOpen ? (
          <p className="text-sm text-slate-500">
            This bond is not open for subscription (status: {bond.status ?? "unknown"}).
            Secondary-market orders may still be available on{" "}
            <Link to="/invest/bonds" className="text-indigo-600 hover:underline">
              the bonds page
            </Link>
            .
          </p>
        ) : subResult ? (
          <div className="space-y-3">
            <SuccessNote>
              {subResult.subscription.status === "active"
                ? `Subscription ${subResult.subscription.subscriptionRef} is ACTIVE — $${fmtMoney(subResult.quote.amountUsd)} + $${fmtMoney(subResult.quote.platformFee)} fee debited from your USD wallet. First coupon estimated ${fmtDateTime(subResult.quote.nextCouponDate)}.`
                : `Subscription ${subResult.subscription.subscriptionRef} created as PENDING PAYMENT — no wallet funds moved. Pay via your chosen rail, then confirm the payment reference from My holdings.`}
            </SuccessNote>
            <div className="flex gap-2">
              <Link to="/invest/bonds" className={btnSecondaryCls}>
                Go to my holdings
              </Link>
              <button
                className={btnSecondaryCls}
                onClick={() => setSubResult(null)}
              >
                Subscribe again
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <Field
                label="Amount (USD)"
                hint={`Min $${MIN_SUBSCRIPTION_USD.toLocaleString()} · whole multiple of face value $${fmtMoney(bond.faceValue)} (backend enforced)`}
              >
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder={bond.faceValue}
                />
              </Field>
              <button
                className={btnSecondaryCls}
                disabled={
                  quoteLoading || !amountUsd || Number(amountUsd) <= 0
                }
                onClick={runQuote}
              >
                {quoteLoading ? "Quoting..." : "Get quote"}
              </button>
            </div>

            {quoteErr && <ErrorNote error={quoteErr} />}
            {quote && (
              <div className="p-3 bg-slate-50 rounded-xl text-sm text-slate-700 grid grid-cols-2 md:grid-cols-4 gap-2">
                <span>Units: {quote.units}</span>
                <span>Coupon/period: ${fmtMoney(quote.couponPerPeriod)}</span>
                <span>Annual coupon: ${fmtMoney(quote.annualCoupon)}</span>
                <span>Platform fee: ${fmtMoney(quote.platformFee)}</span>
                <span>Years to maturity: {quote.yearsToMaturity}</span>
                <span>Est. total coupons: ${fmtMoney(quote.totalCouponsEstimate)}</span>
                <span>Est. total return: ${fmtMoney(quote.totalReturnEstimate)}</span>
                <span>Next coupon: {fmtDateTime(quote.nextCouponDate).split(",")[0]}</span>
              </div>
            )}

            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <Field label="Payment source">
                <select
                  className={inputCls}
                  value={paymentSource}
                  onChange={(e) => setPaymentSource(e.target.value as typeof paymentSource)}
                >
                  <option value="wallet">USD wallet (immediate debit)</option>
                  <option value="bank_transfer">Bank transfer (off-rail)</option>
                  <option value="card">Card (off-rail)</option>
                </select>
              </Field>
              <TotpField value={totp} onChange={setTotp} />
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
              />
              <span>
                I accept the bond subscription terms. I understand subscribing
                requires approved KYC, that wallet payment debits my USD wallet
                immediately (plus the 0.1% platform fee), and that early
                redemption incurs a 2% penalty.
              </span>
            </label>

            {subErr && <ErrorNote error={subErr} />}

            <div className="flex items-center gap-3">
              <button
                className={btnPrimaryCls}
                disabled={
                  subscribing ||
                  !acceptedTerms ||
                  !amountUsd ||
                  Number(amountUsd) <= 0 ||
                  Number(amountUsd) % faceValue !== 0
                }
                onClick={subscribe}
              >
                {subscribing ? "Subscribing..." : "Subscribe"}
              </button>
              {amountUsd && Number(amountUsd) % faceValue !== 0 && (
                <p className="text-xs text-amber-600">
                  Amount must be a whole multiple of ${fmtMoney(bond.faceValue)}
                </p>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Guarded server-side: tier-2 KYC + plan check, balance check, and
              an atomic debit that cannot overdraw. If you have 2FA enrolled,
              your 6-digit code is required.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
};

export default BondDetailPage;
