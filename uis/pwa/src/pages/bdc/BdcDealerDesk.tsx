import React, { useCallback, useEffect, useState } from "react";
import {
  asList,
  bdc,
  BORROWING_CAP_PCT,
  errMsg,
  fmtCountdown,
  fmtDateTime,
  fmtMoney,
  moneyNum,
  msUntil,
  newIdempotencyKey,
  NOP_CAP_PCT,
  type BdcQuote,
  type EntitlementRow,
  type NfemBatch,
  type PositionNow,
} from "./api";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  EndpointPending,
  ErrorNote,
  Field,
  inputCls,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

/** Horizontal usage gauge with a cap marker. */
const Gauge: React.FC<{
  label: string;
  pct: number;
  capPct: number;
  valueText: string;
}> = ({ label, pct, capPct, valueText }) => {
  const over = pct > capPct;
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className={`text-xs font-semibold ${over ? "text-red-600" : "text-slate-700"}`}>
          {valueText} · {pct.toFixed(2)}% (cap {capPct}%)
        </p>
      </div>
      <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-red-500" : pct > capPct * 0.8 ? "bg-amber-400" : "bg-emerald-500"}`}
          style={{ width: `${width}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-slate-400"
          style={{ left: `${Math.min(100, capPct)}%` }}
        />
      </div>
    </div>
  );
};

const BdcDealerDesk: React.FC = () => {
  // ── rate bands ──
  const [bandCcy, setBandCcy] = useState("USD");
  const [bandBps, setBandBps] = useState("");
  const [bandTotp, setBandTotp] = useState("");
  const [bandMsg, setBandMsg] = useState<string | null>(null);
  const [bandErr, setBandErr] = useState<string | null>(null);

  // ── quotes ──
  const [qBranch, setQBranch] = useState("");
  const [qCcy, setQCcy] = useState("USD");
  const [qSide, setQSide] = useState<"buy" | "sell">("buy");
  const [qRate, setQRate] = useState("");
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<BdcQuote[]>([]);
  const [publishTotp, setPublishTotp] = useState<Record<number, string>>({});
  const [publishMsg, setPublishMsg] = useState<Record<number, string>>({});
  const [manualQuoteId, setManualQuoteId] = useState("");
  const [manualTotp, setManualTotp] = useState("");
  const [manualMsg, setManualMsg] = useState<string | null>(null);

  // ── NFEM ──
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [entErr, setEntErr] = useState<string | null>(null);
  const [nfBank, setNfBank] = useState("");
  const [nfAmount, setNfAmount] = useState("");
  const [nfRate, setNfRate] = useState("");
  const [nfTotp, setNfTotp] = useState("");
  const [nfErr, setNfErr] = useState<string | null>(null);
  const [batches, setBatches] = useState<NfemBatch[]>([]);
  const [batchTotp, setBatchTotp] = useState<Record<number, string>>({});
  const [batchReturnRef, setBatchReturnRef] = useState<Record<number, string>>({});
  const [batchMsg, setBatchMsg] = useState<Record<number, string>>({});
  const [manualBatchId, setManualBatchId] = useState("");
  const [, setTick] = useState(0);

  // ── position ──
  const [position, setPosition] = useState<PositionNow | null>(null);
  const [posErr, setPosErr] = useState<string | null>(null);

  // Live 24h countdown — re-render every second while batches are tracked.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const loadEntitlements = useCallback(async () => {
    setEntErr(null);
    try {
      const res = await bdc.sourcing.entitlementStatus.query({});
      setEntitlements(asList(res as EntitlementRow[] | { rows: EntitlementRow[] }));
    } catch (e) {
      setEntErr(errMsg(e));
    }
  }, []);

  const loadPosition = useCallback(async () => {
    setPosErr(null);
    try {
      setPosition(await bdc.sourcing.positionNow.query({}));
    } catch (e) {
      setPosErr(errMsg(e));
    }
  }, []);

  useEffect(() => {
    loadEntitlements();
    loadPosition();
    const t = setInterval(() => {
      loadEntitlements();
      loadPosition();
    }, 30_000);
    return () => clearInterval(t);
  }, [loadEntitlements, loadPosition]);

  const setBand = async () => {
    setBandMsg(null);
    setBandErr(null);
    try {
      await bdc.rates.setBand.mutate({
        currency: bandCcy,
        bandBps: Number(bandBps),
        totpCode: bandTotp,
      });
      setBandMsg(`Band for ${bandCcy} set to ${bandBps} bps.`);
      setBandTotp("");
    } catch (e) {
      setBandErr(errMsg(e));
    }
  };

  const createQuote = async () => {
    setQuoteErr(null);
    try {
      const q = await bdc.rates.createQuote.mutate({
        branchId: qBranch ? Number(qBranch) : undefined,
        currency: qCcy,
        side: qSide,
        rate: qRate,
      });
      setDrafts((d) => [q, ...d]);
    } catch (e) {
      // Band-breach rejections and fail-closed reference-rate outages surface here.
      setQuoteErr(errMsg(e));
    }
  };

  const publish = async (quoteId: number, code: string, manual = false) => {
    const setMsg = (m: string) =>
      manual ? setManualMsg(m) : setPublishMsg((s) => ({ ...s, [quoteId]: m }));
    setMsg("");
    try {
      await bdc.rates.publishQuote.mutate({ quoteId, totpCode: code });
      setMsg(`Quote #${quoteId} published.`);
      if (!manual) {
        setDrafts((d) => d.filter((q) => q.id !== quoteId));
      }
    } catch (e) {
      // Maker-checker enforcement (caller == makerId → server rejects) and
      // TOTP failures are shown verbatim so the checker sees the rule fired.
      setMsg(errMsg(e));
    }
  };

  const requestNfem = async () => {
    setNfErr(null);
    try {
      const batch = await bdc.sourcing.requestNfemPurchase.mutate({
        bankCode: nfBank,
        amountUsd: nfAmount,
        rate: nfRate,
        idempotencyKey: newIdempotencyKey(),
        totpCode: nfTotp,
      });
      setBatches((b) => [batch, ...b]);
      setNfTotp("");
      await loadEntitlements();
    } catch (e) {
      setNfErr(errMsg(e));
    }
  };

  const batchAction = async (batchId: number, kind: "liquidated" | "returned") => {
    const code = batchTotp[batchId] ?? manualBatchTotpFor(batchId);
    setBatchMsg((m) => ({ ...m, [batchId]: "" }));
    try {
      const updated =
        kind === "liquidated"
          ? await bdc.sourcing.markBatchLiquidated.mutate({ batchId, totpCode: code })
          : await bdc.sourcing.markBatchReturned.mutate({
              batchId,
              nairaReturnReference: batchReturnRef[batchId] ?? manualReturnRef,
              totpCode: code,
            });
      setBatches((b) => b.map((x) => (x.id === batchId ? { ...x, ...updated } : x)));
      setBatchMsg((m) => ({ ...m, [batchId]: `Batch #${batchId} marked ${kind}.` }));
    } catch (e) {
      setBatchMsg((m) => ({ ...m, [batchId]: errMsg(e) }));
    }
  };

  // For batches not tracked in this session the operator types the ID; the
  // TOTP entered in the batch row (or the shared manual field) is used.
  const [manualActionTotp, setManualActionTotp] = useState("");
  const [manualReturnRef, setManualReturnRef] = useState("");
  const manualBatchTotpFor = (_batchId: number) => manualActionTotp;

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Dealer Desk"
        subtitle="Rate bands, maker-checker quote publishing, NFEM sourcing and position limits"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Rate band (bdc.rates.setBand — dealer/admin + TOTP)">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <input className={inputCls} maxLength={3} value={bandCcy} onChange={(e) => setBandCcy(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Band (bps)">
                <input className={inputCls} inputMode="numeric" value={bandBps} onChange={(e) => setBandBps(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 200" />
              </Field>
            </div>
            <div className="flex items-end gap-3">
              <TotpField value={bandTotp} onChange={setBandTotp} />
              <button className={btnPrimaryCls} disabled={!bandBps || bandTotp.length !== 6} onClick={setBand}>
                Set band
              </button>
            </div>
            {bandMsg && <SuccessNote>{bandMsg}</SuccessNote>}
            {bandErr && <ErrorNote error={bandErr} />}
            <EndpointPending
              procedure="bdc.rates.listBands"
              note="No band-listing procedure exists in SPEC §3.3 — current bands are not displayable here. Quotes are validated server-side against the active band."
            />
          </div>
        </Card>

        <Card title="Position gauges (bdc.sourcing.positionNow)">
          {posErr && <ErrorNote error={posErr} />}
          {position ? (
            <div className="space-y-4">
              <Gauge
                label="Net Open Position (NOP)"
                pct={moneyNum(position.nopPct)}
                capPct={NOP_CAP_PCT}
                valueText={fmtMoney(position.nopUsd, "USD")}
              />
              <Gauge
                label="Borrowing"
                pct={moneyNum(position.borrowingPct)}
                capPct={BORROWING_CAP_PCT}
                valueText={fmtMoney(position.borrowingUsd, "NGN")}
              />
              {position.breaches?.length > 0 && (
                <ErrorNote error={`Breaches: ${position.breaches.join(", ")}`} />
              )}
              <p className="text-xs text-slate-400">
                Computed from TigerBeetle balances {position.stalenessLabel ? `· ${position.stalenessLabel}` : ""}
              </p>
            </div>
          ) : (
            !posErr && <Spinner label="Loading position..." />
          )}
        </Card>
      </div>

      <Card title="Draft quotes (bdc.rates.createQuote) + publish flow (maker-checker)">
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label="Branch ID (blank = head)">
              <input className={inputCls} inputMode="numeric" value={qBranch} onChange={(e) => setQBranch(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Currency">
              <input className={inputCls} maxLength={3} value={qCcy} onChange={(e) => setQCcy(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Side">
              <select className={inputCls} value={qSide} onChange={(e) => setQSide(e.target.value as "buy" | "sell")}>
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
            </Field>
            <Field label="Rate (NGN per unit, 2dp)">
              <input className={inputCls} inputMode="decimal" value={qRate} onChange={(e) => setQRate(e.target.value)} placeholder="e.g. 1525.50" />
            </Field>
            <div className="flex items-end">
              <button className={btnPrimaryCls} disabled={!qRate} onClick={createQuote}>
                Create draft
              </button>
            </div>
          </div>
          {quoteErr && <ErrorNote error={quoteErr} />}

          {drafts.length === 0 ? (
            <p className="text-sm text-slate-400">
              No drafts created in this session. Drafts created here appear below
              for a checker to publish.
            </p>
          ) : (
            <div className="divide-y divide-slate-50">
              {drafts.map((q) => (
                <div key={q.id} className="py-3 flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-48">
                    <p className="text-sm font-semibold text-slate-900">
                      #{q.id} · {q.side.toUpperCase()} {q.currency} @ {fmtMoney(q.rate, "NGN")}
                    </p>
                    <p className="text-xs text-slate-400">
                      maker #{q.makerId} · <Badge tone={statusTone(q.status)}>{q.status}</Badge>
                    </p>
                  </div>
                  <TotpField
                    value={publishTotp[q.id] ?? ""}
                    onChange={(c) => setPublishTotp((s) => ({ ...s, [q.id]: c }))}
                    label="Checker TOTP"
                  />
                  <button
                    className={btnSecondaryCls}
                    disabled={(publishTotp[q.id] ?? "").length !== 6}
                    onClick={() => publish(q.id, publishTotp[q.id] ?? "")}
                  >
                    Publish (checker)
                  </button>
                  {publishMsg[q.id] && (
                    <p className="w-full text-xs text-slate-500">{publishMsg[q.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-500 mb-2">
              Publish an existing draft by ID (e.g. one made by another dealer —
              the server rejects checker == maker):
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Field label="Quote ID">
                  <input className={inputCls} inputMode="numeric" value={manualQuoteId} onChange={(e) => setManualQuoteId(e.target.value.replace(/\D/g, ""))} />
                </Field>
              </div>
              <TotpField value={manualTotp} onChange={setManualTotp} label="Checker TOTP" />
              <button
                className={btnSecondaryCls}
                disabled={!manualQuoteId || manualTotp.length !== 6}
                onClick={() => publish(Number(manualQuoteId), manualTotp, true)}
              >
                Publish quote
              </button>
            </div>
            {manualMsg && <p className="text-xs text-slate-500 mt-2">{manualMsg}</p>}
          </div>
          <EndpointPending
            procedure="bdc.rates.listQuotes"
            note="SPEC §3.3 has no draft-listing procedure — only quotes created in this session (or by ID) can be published from this screen."
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="NFEM entitlement (bdc.sourcing.entitlementStatus)">
          {entErr && <ErrorNote error={entErr} />}
          {entitlements.length === 0 && !entErr ? (
            <p className="text-sm text-slate-400">No entitlement rows for this week yet.</p>
          ) : (
            <div className="space-y-4">
              {entitlements.map((row) => {
                const cap = moneyNum(row.capUsd);
                const used = moneyNum(row.usedUsd);
                const pct = cap > 0 ? (used / cap) * 100 : 0;
                return (
                  <div key={`${row.bankCode}-${row.weekStart}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {row.bankCode} · week of {row.weekStart}
                      </p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {fmtMoney(row.usedUsd, "USD")} / {fmtMoney(row.capUsd, "USD")} ({pct.toFixed(1)}%)
                      </p>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-indigo-500"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="NFEM purchase request (bdc.sourcing.requestNfemPurchase + TOTP)">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Bank code">
                <input className={inputCls} value={nfBank} onChange={(e) => setNfBank(e.target.value)} placeholder="e.g. GTB" />
              </Field>
              <Field label="Amount (USD, 2dp)">
                <input className={inputCls} inputMode="decimal" value={nfAmount} onChange={(e) => setNfAmount(e.target.value)} placeholder="≤ weekly entitlement" />
              </Field>
              <Field label="Rate (NGN per USD)">
                <input className={inputCls} inputMode="decimal" value={nfRate} onChange={(e) => setNfRate(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-end gap-3">
              <TotpField value={nfTotp} onChange={setNfTotp} />
              <button
                className={btnPrimaryCls}
                disabled={!nfBank || !nfAmount || !nfRate || nfTotp.length !== 6}
                onClick={requestNfem}
              >
                Request purchase
              </button>
            </div>
            {nfErr && <ErrorNote error={nfErr} />}
            <p className="text-xs text-slate-400">
              Over-entitlement requests are rejected (OVER_ENTITLEMENT). FXBT in
              sandbox returns a SIM- reference; the batch stays requested until
              funding is confirmed.
            </p>
          </div>
        </Card>
      </div>

      <Card title="NFEM batches — 24h liquidation countdown">
        {batches.length === 0 ? (
          <p className="text-sm text-slate-400">
            No batches requested in this session. Requested batches appear here
            with a live countdown to deadlineAt.
          </p>
        ) : (
          <div className="divide-y divide-slate-50">
            {batches.map((b) => {
              const remaining = msUntil(b.deadlineAt);
              const expired = Number.isFinite(remaining) && remaining <= 0;
              return (
                <div key={b.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        Batch #{b.id} · {fmtMoney(b.amountUsd, "USD")} @ {fmtMoney(b.rate, "NGN")}
                      </p>
                      <p className="text-xs text-slate-400">
                        {b.fxbtReference ? `FXBT ref ${b.fxbtReference} · ` : ""}
                        deadline {fmtDateTime(b.deadlineAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone(b.status)}>{b.status}</Badge>
                      {b.status === "selling" && b.deadlineAt && (
                        <Badge tone={expired ? "bad" : "warn"}>
                          {fmtCountdown(b.deadlineAt)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <TotpField
                      value={batchTotp[b.id] ?? ""}
                      onChange={(c) => setBatchTotp((s) => ({ ...s, [b.id]: c }))}
                      label="TOTP (liquidate / return)"
                    />
                    <button
                      className={btnSecondaryCls}
                      disabled={(batchTotp[b.id] ?? "").length !== 6}
                      onClick={() => batchAction(b.id, "liquidated")}
                    >
                      Mark liquidated
                    </button>
                    <input
                      className={`${inputCls} w-44`}
                      value={batchReturnRef[b.id] ?? ""}
                      onChange={(e) => setBatchReturnRef((s) => ({ ...s, [b.id]: e.target.value }))}
                      placeholder="Naira return reference"
                    />
                    <button
                      className={btnSecondaryCls}
                      disabled={(batchTotp[b.id] ?? "").length !== 6 || (batchReturnRef[b.id] ?? "").trim().length < 4}
                      onClick={() => batchAction(b.id, "returned")}
                    >
                      Mark returned
                    </button>
                  </div>
                  {batchMsg[b.id] && <p className="text-xs text-slate-500">{batchMsg[b.id]}</p>}
                </div>
              );
            })}
          </div>
        )}
        <div className="border-t border-slate-100 pt-4 mt-2">
          <p className="text-xs font-medium text-slate-500 mb-2">
            Act on a batch by ID (e.g. funded earlier / another session):
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Field label="Batch ID">
                <input className={inputCls} inputMode="numeric" value={manualBatchId} onChange={(e) => setManualBatchId(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            <TotpField value={manualActionTotp} onChange={setManualActionTotp} />
            <button
              className={btnSecondaryCls}
              disabled={!manualBatchId || manualActionTotp.length !== 6}
              onClick={() => batchAction(Number(manualBatchId), "liquidated")}
            >
              Liquidate
            </button>
            <input
              className={`${inputCls} w-44`}
              value={manualReturnRef}
              onChange={(e) => setManualReturnRef(e.target.value)}
              placeholder="Naira return reference"
            />
            <button
              className={btnSecondaryCls}
              disabled={!manualBatchId || manualActionTotp.length !== 6 || manualReturnRef.trim().length < 4}
              onClick={() => batchAction(Number(manualBatchId), "returned")}
            >
              Return
            </button>
          </div>
        </div>
        <div className="mt-3">
          <EndpointPending
            procedure="bdc.sourcing.listBatches"
            note="SPEC §3.5 has no batch-listing procedure — only batches created in this session show the live countdown."
          />
        </div>
      </Card>
    </div>
  );
};

export default BdcDealerDesk;
