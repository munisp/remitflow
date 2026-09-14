import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  asList,
  bdc,
  BORROWING_CAP_PCT,
  errMsg,
  fmtDateTime,
  fmtMoney,
  moneyNum,
  NOP_CAP_PCT,
  type BdcTransaction,
  type PositionNow,
  type RegulatoryReturn,
} from "./api";
import {
  Badge,
  btnPrimaryCls,
  Card,
  EndpointPending,
  ErrorNote,
  Field,
  inputCls,
  PageHeader,
  Spinner,
  statusTone,
} from "./ui";

const Tile: React.FC<{
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "ok" | "warn" | "bad";
}> = ({ label, value, sub, tone = "default" }) => {
  const ring =
    tone === "ok"
      ? "border-emerald-100"
      : tone === "warn"
        ? "border-amber-100"
        : tone === "bad"
          ? "border-red-100"
          : "border-slate-100";
  const val =
    tone === "ok"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-red-600"
          : "text-slate-900";
  return (
    <div className={`bg-white rounded-2xl border ${ring} p-5`}>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-1 ${val}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const BdcMdDashboard: React.FC = () => {
  const today = useMemo(() => new Date(), []);
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 86400_000), []);
  const [from, setFrom] = useState(isoDate(weekAgo));
  const [to, setTo] = useState(isoDate(today));

  const [txns, setTxns] = useState<BdcTransaction[]>([]);
  const [txErr, setTxErr] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(false);

  const [position, setPosition] = useState<PositionNow | null>(null);
  const [posErr, setPosErr] = useState<string | null>(null);

  const [returns, setReturns] = useState<RegulatoryReturn[]>([]);
  const [retErr, setRetErr] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setTxLoading(true);
    setTxErr(null);
    setPosErr(null);
    setRetErr(null);
    try {
      const res = await bdc.sales.listTransactions.query({ from, to, limit: 500 });
      setTxns(asList(res as BdcTransaction[] | { items: BdcTransaction[] }));
    } catch (e) {
      setTxErr(errMsg(e));
      setTxns([]);
    } finally {
      setTxLoading(false);
    }
    try {
      setPosition(await bdc.sourcing.positionNow.query({}));
    } catch (e) {
      setPosErr(errMsg(e));
    }
    try {
      const res = await bdc.reporting.listReturns.query({});
      setReturns(asList(res as RegulatoryReturn[] | { items: RegulatoryReturn[] }));
    } catch (e) {
      setRetErr(errMsg(e));
    }
  }, [from, to]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── client-side P&L aggregation over the date range ──
  const agg = useMemo(() => {
    const settled = txns.filter((t) => t.status !== "reversed" && t.status !== "failed");
    const sum = (rows: BdcTransaction[], f: (t: BdcTransaction) => string | number) =>
      rows.reduce((a, t) => a + moneyNum(f(t)), 0);
    const buys = settled.filter((t) => t.txnType === "buy_fx");
    const sells = settled.filter((t) => t.txnType === "sell_fx");
    const payouts = settled.filter((t) => t.txnType === "imto_payout");
    const nfem = settled.filter((t) => t.txnType.startsWith("nfem_"));
    // Spread estimate: naira paid out on sells minus naira taken in on buys is
    // not a real P&L — show gross volumes and the spread proxy per USD traded.
    return {
      count: settled.length,
      buyFxUsd: sum(buys, (t) => t.fxAmountMinor),
      sellFxUsd: sum(sells, (t) => t.fxAmountMinor),
      buyNaira: sum(buys, (t) => t.nairaAmountMinor),
      sellNaira: sum(sells, (t) => t.nairaAmountMinor),
      payoutNaira: sum(payouts, (t) => t.nairaAmountMinor),
      payoutCount: payouts.length,
      nfemUsd: sum(nfem, (t) => t.fxAmountMinor),
      pendingCount: txns.filter((t) => t.status === "pending").length,
    };
  }, [txns]);

  const league = useMemo(() => {
    const byBranch = new Map<number, { naira: number; count: number }>();
    for (const t of txns) {
      if (t.status === "reversed" || t.status === "failed") continue;
      const row = byBranch.get(t.branchId) ?? { naira: 0, count: 0 };
      row.naira += moneyNum(t.nairaAmountMinor);
      row.count += 1;
      byBranch.set(t.branchId, row);
    }
    return [...byBranch.entries()]
      .map(([branchId, v]) => ({ branchId, ...v }))
      .sort((a, b) => b.naira - a.naira);
  }, [txns]);

  const compliance = useMemo(() => {
    const filed = returns.filter((r) => r.status === "acknowledged").length;
    const due = returns.filter((r) =>
      ["draft", "staged", "quarantined", "failed"].includes(r.status),
    ).length;
    const inFlight = returns.filter((r) => r.status === "submitted").length;
    return { filed, due, inFlight };
  }, [returns]);

  const nopPct = position ? moneyNum(position.nopPct) : 0;
  const borPct = position ? moneyNum(position.borrowingPct) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC MD Dashboard"
        subtitle="P&L, position vs limits, branch league table and compliance status"
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field label="From">
              <input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
          <div className="w-44">
            <Field label="To">
              <input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <button className={btnPrimaryCls} onClick={loadAll} disabled={txLoading}>
            {txLoading ? "Loading..." : "Reload"}
          </button>
          <p className="text-xs text-slate-400">
            P&L tiles aggregate bdc.sales.listTransactions client-side over the
            selected range.
          </p>
        </div>
      </Card>

      {txErr && <ErrorNote error={txErr} />}

      {txLoading ? (
        <Spinner label="Aggregating transactions..." />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="FX bought (USD equiv.)" value={fmtMoney(agg.buyFxUsd, "USD")} sub={`${fmtMoney(agg.buyNaira, "NGN")} paid out`} />
          <Tile label="FX sold (USD equiv.)" value={fmtMoney(agg.sellFxUsd, "USD")} sub={`${fmtMoney(agg.sellNaira, "NGN")} taken in`} />
          <Tile label="IMTO payouts" value={fmtMoney(agg.payoutNaira, "NGN")} sub={`${agg.payoutCount} payouts`} />
          <Tile label="NFEM sourced" value={fmtMoney(agg.nfemUsd, "USD")} sub={`${agg.count} txns · ${agg.pendingCount} pending`} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile
          label={`NOP vs ${NOP_CAP_PCT}% cap`}
          value={position ? `${nopPct.toFixed(2)}%` : "—"}
          sub={position ? fmtMoney(position.nopUsdMinor, "USD") : posErr ? "position unavailable" : undefined}
          tone={!position ? "default" : nopPct > NOP_CAP_PCT ? "bad" : nopPct > NOP_CAP_PCT * 0.8 ? "warn" : "ok"}
        />
        <Tile
          label={`Borrowing vs ${BORROWING_CAP_PCT}% cap`}
          value={position ? `${borPct.toFixed(2)}%` : "—"}
          sub={position ? fmtMoney(position.borrowingMinor, "NGN") : posErr ? "position unavailable" : undefined}
          tone={!position ? "default" : borPct > BORROWING_CAP_PCT ? "bad" : borPct > BORROWING_CAP_PCT * 0.8 ? "warn" : "ok"}
        />
        <Tile
          label="Returns filed (acknowledged)"
          value={String(compliance.filed)}
          sub={retErr ? "returns unavailable" : `${compliance.inFlight} submitted awaiting ack`}
          tone={retErr ? "default" : "ok"}
        />
        <Tile
          label="Returns due / attention"
          value={String(compliance.due)}
          sub="draft, staged, quarantined or failed"
          tone={compliance.due > 0 ? "warn" : "ok"}
        />
      </div>

      {posErr && <ErrorNote error={posErr} />}
      {position && position.breaches?.length > 0 && (
        <ErrorNote error={`Position breaches: ${position.breaches.join(", ")}`} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Branch league table (naira volume in range)">
          {league.length === 0 ? (
            <p className="text-sm text-slate-400">No transactions in range.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {league.map((row, i) => (
                <div key={row.branchId} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-500"}`}>
                      {i + 1}
                    </span>
                    <p className="text-sm font-semibold text-slate-900">Branch #{row.branchId}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums text-slate-900">{fmtMoney(row.naira, "NGN")}</p>
                    <p className="text-xs text-slate-400">{row.count} txns</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Compliance status">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-700">Regulatory returns</p>
              <div className="flex gap-2">
                <Badge tone="ok">{compliance.filed} filed</Badge>
                <Badge tone={compliance.due > 0 ? "warn" : "neutral"}>{compliance.due} due</Badge>
              </div>
            </div>
            {returns.filter((r) => ["quarantined", "failed"].includes(r.status)).map((r) => (
              <p key={r.id} className="text-xs text-red-600">
                Return #{r.id} ({r.returnType.toUpperCase()}) {r.status}
                {r.errorDetail ? ` — ${r.errorDetail}` : ""} · last activity {fmtDateTime(r.submittedAt ?? r.ackAt)}
              </p>
            ))}
            <EndpointPending
              procedure="bdc.compliance.listSofDeclarations"
              note="Open SoF declaration count cannot be shown — no listing procedure in SPEC §3.8."
            />
            <EndpointPending
              procedure="bdc.compliance.listStrs"
              note="Open STR count cannot be shown — no listing procedure in SPEC §3.8 (fileStr only)."
            />
            <div className="flex items-center justify-between text-sm">
              <p className="text-slate-700">Open compliance items status</p>
              <Badge tone={statusTone(compliance.due > 0 ? "pending" : "active")}>
                {compliance.due > 0 ? "attention needed" : "clear"}
              </Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default BdcMdDashboard;
