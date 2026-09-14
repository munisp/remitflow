import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  asList,
  bdc,
  CASH_CAP_USD,
  CASH_PORTION_MAX_PCT,
  errMsg,
  fmtDateTime,
  fmtMoney,
  moneyNum,
  PURPOSE_CODES,
  SOF_THRESHOLD_USD,
  type BdcTransaction,
  type DenominationItem,
  type PayoutQuoteResult,
  type PurposeCode,
} from "./api";
import {
  Badge,
  btnDangerCls,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  ErrorNote,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

type Tab = "buy" | "sell" | "payout" | "queue";

/** Payment-method auto-routing (SPEC §3.4 buyFx rules). */
function routePaymentMethod(
  amountUsd: number,
  customerType: "resident" | "non_resident",
): { method: string; note: string } {
  if (customerType === "non_resident") {
    return amountUsd <= CASH_CAP_USD
      ? { method: "cash", note: "Cash allowed (≤ $500); prepaid card also available for non-residents." }
      : { method: "prepaid_card", note: "Above $500 cash cap — routed to prepaid card / NIP transfer for non-resident." };
  }
  return amountUsd <= CASH_CAP_USD
    ? { method: "cash", note: "Within $500 cash cap — cash settlement allowed." }
    : { method: "nip_transfer", note: "Above $500 cash cap — routed to NIP transfer." };
}

const SofBanner: React.FC<{ amountUsd: number }> = ({ amountUsd }) =>
  amountUsd >= SOF_THRESHOLD_USD ? (
    <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
      <span className="font-medium">Source-of-Funds declaration required.</span>{" "}
      Amounts ≥ {fmtMoney(SOF_THRESHOLD_USD, "USD")} need an approved SoF
      declaration (bdc.compliance.submitSofDeclaration / MLRO approval) before
      this ticket can settle — the server returns PENDING with a declarationId
      otherwise.
    </div>
  ) : null;

interface DenomRow extends DenominationItem {
  key: number;
}

let denomKey = 0;
const newDenomRow = (currency: string): DenomRow => ({
  key: ++denomKey,
  currency,
  denominationMinor: "",
  noteCount: 0,
});

const DenominationPicker: React.FC<{
  currency: string;
  rows: DenomRow[];
  onChange: (rows: DenomRow[]) => void;
}> = ({ currency, rows, onChange }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <p className="text-xs font-medium text-slate-500">
        Denominations (currency + note denomination + note count)
      </p>
      <button
        type="button"
        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        onClick={() => onChange([...rows, newDenomRow(currency)])}
      >
        + Add row
      </button>
    </div>
    {rows.length === 0 && (
      <p className="text-xs text-slate-400">No denomination rows yet.</p>
    )}
    {rows.map((row) => (
      <div key={row.key} className="flex items-center gap-2">
        <input
          className={`${inputCls} w-20`}
          value={row.currency ?? currency}
          maxLength={3}
          onChange={(e) =>
            onChange(
              rows.map((r) =>
                r.key === row.key ? { ...r, currency: e.target.value.toUpperCase() } : r,
              ),
            )
          }
          placeholder="CCY"
        />
        <input
          className={`${inputCls} flex-1`}
          value={row.denominationMinor}
          inputMode="decimal"
          onChange={(e) =>
            onChange(
              rows.map((r) =>
                r.key === row.key ? { ...r, denominationMinor: e.target.value } : r,
              ),
            )
          }
          placeholder="Denomination (e.g. 100.00)"
        />
        <input
          className={`${inputCls} w-24`}
          value={row.noteCount || ""}
          inputMode="numeric"
          onChange={(e) =>
            onChange(
              rows.map((r) =>
                r.key === row.key ? { ...r, noteCount: Number(e.target.value.replace(/\D/g, "")) } : r,
              ),
            )
          }
          placeholder="Notes"
        />
        <button
          type="button"
          className="text-slate-300 hover:text-red-500 text-lg leading-none"
          onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
          aria-label="Remove row"
        >
          ×
        </button>
      </div>
    ))}
  </div>
);

const BdcTeller: React.FC = () => {
  const [tab, setTab] = useState<Tab>("buy");

  // ── shared ticket fields ──
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerType, setCustomerType] = useState<"resident" | "non_resident">("resident");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [denoms, setDenoms] = useState<DenomRow[]>([]);

  // ── sell-only fields ──
  const [purposeCode, setPurposeCode] = useState<PurposeCode>("PTA");
  const [evidenceRefs, setEvidenceRefs] = useState("");
  const [cashPortion, setCashPortion] = useState("");
  const [disburseMethod, setDisburseMethod] = useState<"prepaid_card" | "domiciliary">("prepaid_card");

  // ── results ──
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<unknown>(null);

  // ── IMTO payout ──
  const [imtoCode, setImtoCode] = useState("");
  const [imtoRef, setImtoRef] = useState("");
  const [quote, setQuote] = useState<PayoutQuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [payoutTotp, setPayoutTotp] = useState("");
  const [payoutResult, setPayoutResult] = useState<unknown>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  // ── queue / receipts ──
  const [queue, setQueue] = useState<BdcTransaction[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [actionTotp, setActionTotp] = useState<Record<number, string>>({});
  const [actionMsg, setActionMsg] = useState<Record<number, string>>({});
  const [receiptId, setReceiptId] = useState("");
  const [receipt, setReceipt] = useState<BdcTransaction | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const amountUsd = useMemo(() => moneyNum(amount), [amount]);
  const routed = useMemo(
    () => routePaymentMethod(amountUsd, customerType),
    [amountUsd, customerType],
  );
  const cashPortionPct = useMemo(() => {
    const fx = amountUsd;
    if (fx <= 0) return 0;
    return (moneyNum(cashPortion) / fx) * 100;
  }, [amountUsd, cashPortion]);

  const denomPayload = () =>
    denoms
      .filter((d) => d.denominationMinor && d.noteCount > 0)
      .map(({ currency: c, denominationMinor, noteCount }) => ({
        currency: c ?? currency,
        denominationMinor,
        noteCount,
      }));

  const submitBuy = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const res = await bdc.sales.buyFx.mutate({
        branchId: Number(branchId),
        customerId: Number(customerId),
        currency,
        fxAmountMinor: amount,
        rateMinor: rate || undefined,
        denominations: denomPayload(),
        paymentMethod: routed.method,
      });
      setSubmitResult(res);
    } catch (e) {
      setSubmitError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const submitSell = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const refs = evidenceRefs
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await bdc.sales.sellFx.mutate({
        branchId: Number(branchId),
        customerId: Number(customerId),
        currency,
        fxAmountMinor: amount,
        rateMinor: rate || undefined,
        purposeCode,
        evidenceRefs: refs,
        cashPortionMinor: cashPortion || "0",
        disbursementMethod: disburseMethod,
        denominations: denomPayload(),
      });
      setSubmitResult(res);
    } catch (e) {
      setSubmitError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const getQuote = async () => {
    setQuoteLoading(true);
    setPayoutError(null);
    setQuote(null);
    setPayoutResult(null);
    try {
      const q = await bdc.imto.payoutQuote.mutate({ imtoCode, reference: imtoRef });
      setQuote(q);
    } catch (e) {
      setPayoutError(errMsg(e));
    } finally {
      setQuoteLoading(false);
    }
  };

  const executePayout = async () => {
    if (!quote) return;
    setPayoutError(null);
    setPayoutResult(null);
    try {
      const res = await bdc.imto.executePayout.mutate({
        quoteId: quote.quoteId,
        totpCode: payoutTotp,
      });
      setPayoutResult(res);
    } catch (e) {
      setPayoutError(errMsg(e));
    }
  };

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await bdc.sales.listTransactions.query({ status: "pending" });
      setQueue(asList(res as BdcTransaction[] | { items: BdcTransaction[] }));
    } catch (e) {
      setQueueError(errMsg(e));
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "queue") loadQueue();
  }, [tab, loadQueue]);

  const queueAction = async (tx: BdcTransaction, kind: "confirm" | "reverse") => {
    const code = actionTotp[tx.id] ?? "";
    setActionMsg((m) => ({ ...m, [tx.id]: "" }));
    try {
      if (kind === "confirm") {
        await bdc.sales.confirmNairaLeg.mutate({ transactionId: tx.id, totpCode: code });
      } else {
        await bdc.sales.reverseTransaction.mutate({ transactionId: tx.id, totpCode: code });
      }
      setActionMsg((m) => ({ ...m, [tx.id]: kind === "confirm" ? "Naira leg confirmed." : "Transaction reversed." }));
      await loadQueue();
    } catch (e) {
      setActionMsg((m) => ({ ...m, [tx.id]: errMsg(e) }));
    }
  };

  const loadReceipt = async () => {
    setReceipt(null);
    setReceiptError(null);
    try {
      const tx = await bdc.sales.getTransaction.query({ id: Number(receiptId) });
      setReceipt(tx);
    } catch (e) {
      setReceiptError(errMsg(e));
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "buy", label: "Buy FX" },
    { id: "sell", label: "Sell FX" },
    { id: "payout", label: "IMTO payout" },
    { id: "queue", label: "Pending queue & receipts" },
  ];

  const ticketFields = (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label="Branch ID">
        <input className={inputCls} inputMode="numeric" value={branchId} onChange={(e) => setBranchId(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1" />
      </Field>
      <Field label="Customer ID">
        <input className={inputCls} inputMode="numeric" value={customerId} onChange={(e) => setCustomerId(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 42" />
      </Field>
      <Field label="Customer type">
        <select className={inputCls} value={customerType} onChange={(e) => setCustomerType(e.target.value as "resident" | "non_resident")}>
          <option value="resident">Resident</option>
          <option value="non_resident">Non-resident</option>
        </select>
      </Field>
      <Field label="Currency">
        <input className={inputCls} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
      </Field>
      <Field label="FX amount (decimal, 2dp)">
        <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2500.00" />
      </Field>
      <Field label="Rate (NGN per 1 FX unit)">
        <input className={inputCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="from rate board" />
      </Field>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Teller Console"
        subtitle="Buy / sell / IMTO payout tickets with denomination capture and payment-method routing"
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${tab === t.id ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "bg-white border border-slate-100 text-slate-600 hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "buy" && (
        <Card title="Buy FX ticket (bdc.sales.buyFx)">
          <div className="space-y-4">
            {ticketFields}
            <DenominationPicker currency={currency} rows={denoms} onChange={setDenoms} />
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-700">
              Payment-method auto-routing:{" "}
              <span className="font-mono font-medium">{routed.method}</span> — {routed.note}
            </div>
            <SofBanner amountUsd={amountUsd} />
            {submitError && <ErrorNote error={submitError} />}
            {submitResult != null && (
              <>
                <SuccessNote>Buy ticket accepted (see server status below — pending until the money leg confirms).</SuccessNote>
                <JsonView data={submitResult} />
              </>
            )}
            <button
              className={btnPrimaryCls}
              disabled={submitting || !branchId || !customerId || !amount}
              onClick={submitBuy}
            >
              {submitting ? "Submitting..." : "Submit buy ticket"}
            </button>
          </div>
        </Card>
      )}

      {tab === "sell" && (
        <Card title="Sell FX ticket (bdc.sales.sellFx)">
          <div className="space-y-4">
            {ticketFields}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Purpose code (mandatory)">
                <select className={inputCls} value={purposeCode} onChange={(e) => setPurposeCode(e.target.value as PurposeCode)}>
                  {PURPOSE_CODES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field
                label={`Cash portion (≤ ${CASH_PORTION_MAX_PCT}% of FX amount)`}
                hint={cashPortionPct > CASH_PORTION_MAX_PCT ? `Currently ${cashPortionPct.toFixed(1)}% — exceeds the ${CASH_PORTION_MAX_PCT}% cap; the server will reject.` : `${cashPortionPct.toFixed(1)}% of FX amount`}
              >
                <input className={inputCls} inputMode="decimal" value={cashPortion} onChange={(e) => setCashPortion(e.target.value)} placeholder="0.00" />
              </Field>
            </div>
            <Field
              label={purposeCode === "NONRESIDENT_REPATRIATION" ? "Evidence refs (receipt reference required)" : "Evidence refs (at least 1, comma or newline separated)"}
            >
              <textarea
                className={inputCls}
                rows={2}
                value={evidenceRefs}
                onChange={(e) => setEvidenceRefs(e.target.value)}
                placeholder="e.g. PTA-2024-001, ticket-ref-123"
              />
            </Field>
            <Field label="Balance disbursement method">
              <select className={inputCls} value={disburseMethod} onChange={(e) => setDisburseMethod(e.target.value as "prepaid_card" | "domiciliary")}>
                <option value="prepaid_card">Prepaid card</option>
                <option value="domiciliary">Domiciliary account</option>
              </select>
            </Field>
            <DenominationPicker currency={currency} rows={denoms} onChange={setDenoms} />
            <SofBanner amountUsd={amountUsd} />
            {submitError && <ErrorNote error={submitError} />}
            {submitResult != null && (
              <>
                <SuccessNote>Sell ticket accepted (see server status below — pending until the naira leg confirms).</SuccessNote>
                <JsonView data={submitResult} />
              </>
            )}
            <button
              className={btnPrimaryCls}
              disabled={submitting || !branchId || !customerId || !amount || !evidenceRefs.trim()}
              onClick={submitSell}
            >
              {submitting ? "Submitting..." : "Submit sell ticket"}
            </button>
          </div>
        </Card>
      )}

      {tab === "payout" && (
        <Card title="IMTO payout (bdc.imto.payoutQuote → executePayout)">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="IMTO code">
                <input className={inputCls} value={imtoCode} onChange={(e) => setImtoCode(e.target.value)} placeholder="e.g. WU" />
              </Field>
              <Field label="Payout reference">
                <input className={inputCls} value={imtoRef} onChange={(e) => setImtoRef(e.target.value)} placeholder="Mojaloop party reference" />
              </Field>
              <div className="flex items-end">
                <button className={btnSecondaryCls} disabled={quoteLoading || !imtoCode || !imtoRef} onClick={getQuote}>
                  {quoteLoading ? "Quoting..." : "Get payout quote"}
                </button>
              </div>
            </div>
            {quote && (
              <div className="p-4 bg-slate-50 rounded-xl space-y-1 text-sm">
                <p className="text-slate-700">
                  Naira payable: <span className="font-semibold tabular-nums">{fmtMoney(quote.nairaAmountMinor, "NGN")}</span>
                </p>
                <p className="text-slate-700">
                  Commission: <span className="font-semibold tabular-nums">{fmtMoney(quote.commissionMinor, "NGN")}</span>
                </p>
                <p className="text-xs text-slate-400">
                  Quote <span className="font-mono">{quote.quoteId}</span> — expires {fmtDateTime(quote.expiresAt)}
                </p>
              </div>
            )}
            {quote && (
              <div className="flex items-end gap-3">
                <TotpField value={payoutTotp} onChange={setPayoutTotp} />
                <button className={btnPrimaryCls} disabled={payoutTotp.length !== 6} onClick={executePayout}>
                  Execute payout
                </button>
              </div>
            )}
            {payoutError && <ErrorNote error={payoutError} />}
            {payoutResult != null && (
              <>
                <SuccessNote>Payout submitted — status stays pending until the Mojaloop transfer leg confirms.</SuccessNote>
                <JsonView data={payoutResult} />
              </>
            )}
          </div>
        </Card>
      )}

      {tab === "queue" && (
        <>
          <Card title="Pending queue (bdc.sales.listTransactions, status=pending)">
            {queueError && <ErrorNote error={queueError} />}
            {queueLoading ? (
              <Spinner label="Loading queue..." />
            ) : queue.length === 0 ? (
              <p className="text-center py-8 text-slate-400 text-sm">No pending transactions.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {queue.map((tx) => (
                  <div key={tx.id} className="py-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          #{tx.id} · {tx.txnType} · {fmtMoney(tx.fxAmountMinor, tx.currency)} @ {fmtMoney(tx.rateMinor, "NGN")}
                        </p>
                        <p className="text-xs text-slate-400">
                          {fmtDateTime(tx.createdAt)} · branch {tx.branchId}
                          {tx.paymentLeg?.method ? ` · ${tx.paymentLeg.method}` : ""}
                        </p>
                      </div>
                      <Badge tone={statusTone(tx.status)}>{tx.status}</Badge>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <TotpField
                        value={actionTotp[tx.id] ?? ""}
                        onChange={(code) => setActionTotp((m) => ({ ...m, [tx.id]: code }))}
                        label="TOTP (confirm / reverse)"
                      />
                      <button
                        className={btnSecondaryCls}
                        disabled={(actionTotp[tx.id] ?? "").length !== 6}
                        onClick={() => queueAction(tx, "confirm")}
                      >
                        Confirm naira leg
                      </button>
                      <button
                        className={btnDangerCls}
                        disabled={(actionTotp[tx.id] ?? "").length !== 6}
                        onClick={() => queueAction(tx, "reverse")}
                      >
                        Reverse
                      </button>
                      <button
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-2"
                        onClick={() => { setReceiptId(String(tx.id)); }}
                      >
                        View receipt →
                      </button>
                    </div>
                    {actionMsg[tx.id] && (
                      <p className="text-xs text-slate-500">{actionMsg[tx.id]}</p>
                    )}
                    <p className="text-xs text-slate-400">
                      Reversal is maker-checker enforced (checker ≠ maker) and only
                      allowed while pending/posted — settled tickets need the
                      orchestrator approval path and will be rejected by the server.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Receipt view (bdc.sales.getTransaction)">
            <div className="flex items-end gap-3">
              <div className="w-48">
                <Field label="Transaction ID">
                  <input className={inputCls} inputMode="numeric" value={receiptId} onChange={(e) => setReceiptId(e.target.value.replace(/\D/g, ""))} />
                </Field>
              </div>
              <button className={btnSecondaryCls} disabled={!receiptId} onClick={loadReceipt}>
                Load receipt
              </button>
            </div>
            {receiptError && <div className="mt-3"><ErrorNote error={receiptError} /></div>}
            {receipt && <div className="mt-3"><JsonView data={receipt} /></div>}
          </Card>
        </>
      )}
    </div>
  );
};

export default BdcTeller;
