import React, { useCallback, useEffect, useState } from "react";
import {
  asList,
  bdc,
  errMsg,
  fmtDateTime,
  fmtMoney,
  type BoardRow,
} from "./api";
import {
  Badge,
  Card,
  EndpointPending,
  ErrorNote,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
  btnPrimaryCls,
  btnSecondaryCls,
} from "./ui";

/** Staleness badge derived from publishedAt / expiresAt (SPEC §3.3). */
const StalenessBadge: React.FC<{
  publishedAt?: string | null;
  expiresAt?: string | null;
}> = ({ publishedAt, expiresAt }) => {
  if (!publishedAt) return <Badge>unpublished</Badge>;
  const now = Date.now();
  const expires = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  if (Number.isFinite(expires) && expires <= now) {
    return <Badge tone="bad">stale — expired {fmtDateTime(expiresAt)}</Badge>;
  }
  if (Number.isFinite(expires) && expires - now < 15 * 60 * 1000) {
    return <Badge tone="warn">expiring soon ({fmtDateTime(expiresAt)})</Badge>;
  }
  return <Badge tone="ok">live — published {fmtDateTime(publishedAt)}</Badge>;
};

const BdcRateBoard: React.FC = () => {
  const [branchId, setBranchId] = useState("");
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [fromCcy, setFromCcy] = useState("USD");
  const [toCcy, setToCcy] = useState("EUR");
  const [cross, setCross] = useState<unknown>(null);
  const [crossError, setCrossError] = useState<string | null>(null);
  const [crossLoading, setCrossLoading] = useState(false);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await bdc.rates.currentBoard.query(
        branchId ? { branchId: Number(branchId) } : {},
      );
      setRows(asList(res as BoardRow[] | { rows: BoardRow[] }));
      setLastRefresh(new Date());
    } catch (e) {
      setError(errMsg(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // Live board: refresh every 30s so staleness badges stay honest.
  useEffect(() => {
    const t = setInterval(loadBoard, 30_000);
    return () => clearInterval(t);
  }, [loadBoard]);

  const runCrossQuote = async () => {
    setCrossLoading(true);
    setCrossError(null);
    setCross(null);
    try {
      const res = await bdc.rates.crossQuote.query({ fromCcy, toCcy });
      setCross(res);
    } catch (e) {
      setCrossError(errMsg(e));
    } finally {
      setCrossLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Rate Board"
        subtitle="Live buy/sell board per branch — published quotes with staleness"
      />

      <Card>
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="w-full md:w-56">
            <Field label="Branch ID (blank = head board)">
              <input
                className={inputCls}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value.replace(/\D/g, ""))}
                placeholder="e.g. 1"
                inputMode="numeric"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <button className={btnPrimaryCls} onClick={loadBoard} disabled={loading}>
              Refresh board
            </button>
          </div>
          {lastRefresh && (
            <p className="text-xs text-slate-400 md:ml-auto">
              Last refreshed {lastRefresh.toLocaleTimeString()} (auto every 30s)
            </p>
          )}
        </div>
      </Card>

      {error && <ErrorNote error={error} />}

      <Card title="Current board (bdc.rates.currentBoard)">
        {loading ? (
          <Spinner label="Loading board..." />
        ) : rows.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">
            No published quotes for this branch.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-4 font-medium">Currency</th>
                  <th className="py-2 pr-4 font-medium">We buy at (NGN)</th>
                  <th className="py-2 pr-4 font-medium">We sell at (NGN)</th>
                  <th className="py-2 font-medium">Staleness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((row) => (
                  <tr key={row.currency}>
                    <td className="py-3 pr-4 font-semibold text-slate-900">
                      {row.currency}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-slate-700">
                      {row.buy ? fmtMoney(row.buy.rateMinor, "NGN") : "—"}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-slate-700">
                      {row.sell ? fmtMoney(row.sell.rateMinor, "NGN") : "—"}
                    </td>
                    <td className="py-3">
                      <StalenessBadge
                        publishedAt={row.publishedAt ?? row.sell?.publishedAt ?? row.buy?.publishedAt}
                        expiresAt={row.expiresAt ?? row.sell?.expiresAt ?? row.buy?.expiresAt}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Cross-rate checker (bdc.rates.crossQuote — two legs via naira mid)">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="w-full md:w-40">
            <Field label="From currency">
              <input
                className={inputCls}
                value={fromCcy}
                maxLength={3}
                onChange={(e) => setFromCcy(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <div className="w-full md:w-40">
            <Field label="To currency">
              <input
                className={inputCls}
                value={toCcy}
                maxLength={3}
                onChange={(e) => setToCcy(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <button
            className={btnSecondaryCls}
            onClick={runCrossQuote}
            disabled={crossLoading || fromCcy.length !== 3 || toCcy.length !== 3}
          >
            {crossLoading ? "Quoting..." : "Get cross quote"}
          </button>
        </div>
        {crossError && (
          <div className="mt-3">
            <ErrorNote error={crossError} />
          </div>
        )}
        {cross != null ? (
          <div className="mt-3">
            <p className="text-xs text-slate-400 mb-2">
              Both legs are returned with their own compliance parameters:
            </p>
            <JsonView data={cross} />
          </div>
        ) : (
          !crossError && (
            <div className="mt-3">
              <EndpointPending
                procedure="bdc.rates.crossQuote"
                note="Run a quote above. If the server reports the procedure missing, the B1 rates router has not been merged yet."
              />
            </div>
          )
        )}
      </Card>
    </div>
  );
};

export default BdcRateBoard;
