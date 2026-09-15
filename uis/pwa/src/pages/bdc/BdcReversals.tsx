import React, { useCallback, useEffect, useState } from "react";
import {
  bdc,
  errMsg,
  fmtDateTime,
  type BdcReversal,
  type ReversalExecutionResult,
  type ReversalStatus,
} from "./api";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  ErrorNote,
  Field,
  inputCls,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";
import { useAuthStore } from "../../stores/authStore";

const STATUS_FILTERS: readonly ReversalStatus[] = [
  "requested",
  "approved",
  "posted",
  "failed",
  "rejected",
];

/**
 * BDC settled-transaction reversals (SPEC-wave12 §4.1 / §6.1).
 *
 * Maker-checker: bdc.reversals.requestReversal creates a 'requested' record;
 * bdc.reversals.approveReversal (checker ≠ maker — the server enforces
 * FORBIDDEN, the UI merely disables the button on your own rows) flips it and
 * runs the compensating money path. Terminal states are rendered honestly:
 * 'failed' shows the recorded failureReason, 'posted' means the money
 * actually moved back.
 */
const BdcReversals: React.FC = () => {
  const { user } = useAuthStore();
  // authStore User.id is a string; the server's requestedBy is the numeric id.
  const myUserId = Number(user?.id);

  // ── list ──
  const [rows, setRows] = useState<BdcReversal[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  // ── request form ──
  const [reqTxnId, setReqTxnId] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [reqTotp, setReqTotp] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqMsg, setReqMsg] = useState<string | null>(null);
  const [reqErr, setReqErr] = useState<string | null>(null);

  // ── per-row approve ──
  const [approveTotp, setApproveTotp] = useState<Record<number, string>>({});
  const [rowMsg, setRowMsg] = useState<Record<number, { kind: "ok" | "err"; text: string }>>({});

  const load = useCallback(
    async (cursor?: number) => {
      setListLoading(true);
      setListErr(null);
      try {
        const res = await bdc.reversals.listReversals.query({
          ...(statusFilter ? { status: statusFilter as ReversalStatus } : {}),
          ...(cursor ? { cursor } : {}),
        });
        setRows((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (e) {
        setListErr(errMsg(e));
        if (!cursor) setRows([]);
      } finally {
        setListLoading(false);
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    load();
  }, [load]);

  const requestReversal = async () => {
    setReqBusy(true);
    setReqMsg(null);
    setReqErr(null);
    try {
      const res = await bdc.reversals.requestReversal.mutate({
        transactionId: Number(reqTxnId),
        reason: reqReason,
        totpCode: reqTotp,
      });
      setReqMsg(
        `Reversal #${res.reversalId} requested for transaction ${res.transactionId} — awaiting checker approval.`,
      );
      setReqTxnId("");
      setReqReason("");
      setReqTotp("");
      await load();
    } catch (e) {
      // Honest failures: not settled → BAD_REQUEST pointing at
      // sales.reverseTransaction; duplicate open reversal → CONFLICT.
      setReqErr(errMsg(e));
    } finally {
      setReqBusy(false);
    }
  };

  const approve = async (reversalId: number) => {
    const code = approveTotp[reversalId] ?? "";
    setRowMsg((m) => ({ ...m, [reversalId]: { kind: "ok", text: "Approving…" } }));
    try {
      const res: ReversalExecutionResult = await bdc.reversals.approveReversal.mutate({
        reversalId,
        totpCode: code,
      });
      // The approval executes the money path inline — surface its honest
      // outcome instead of claiming success.
      const text =
        res.status === "reversed"
          ? `Reversal #${res.reversalId} posted — transaction ${res.transactionId} reversed.`
          : res.status === "already_posted"
            ? `Reversal #${res.reversalId} was already posted.`
            : `Reversal #${res.reversalId} FAILED during execution: ${res.failureReason ?? "unknown reason"}`;
      setRowMsg((m) => ({
        ...m,
        [reversalId]: { kind: res.status === "failed" ? "err" : "ok", text },
      }));
      setApproveTotp((m) => ({ ...m, [reversalId]: "" }));
      await load();
    } catch (e) {
      setRowMsg((m) => ({ ...m, [reversalId]: { kind: "err", text: errMsg(e) } }));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Reversals"
        subtitle="Maker-checker reversal of settled BDC transactions (bdc.reversals.*)"
      />

      <Card title="Request reversal (bdc.reversals.requestReversal + TOTP)">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Only <span className="font-mono">settled</span> transactions use this
            flow — pending/posted transactions stay on
            bdc.sales.reverseTransaction. One open reversal per transaction.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Transaction ID">
              <input
                className={inputCls}
                inputMode="numeric"
                value={reqTxnId}
                onChange={(e) => setReqTxnId(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Reason (4–500 chars)">
              <input
                className={inputCls}
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                placeholder="Why must this settled transaction be reversed?"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <TotpField value={reqTotp} onChange={setReqTotp} label="TOTP step-up" />
            <button
              className={btnPrimaryCls}
              disabled={!reqTxnId || reqReason.trim().length < 4 || reqTotp.length !== 6 || reqBusy}
              onClick={requestReversal}
            >
              {reqBusy ? "Requesting…" : "Request reversal"}
            </button>
          </div>
          {reqMsg && <SuccessNote>{reqMsg}</SuccessNote>}
          {reqErr && <ErrorNote error={reqErr} />}
        </div>
      </Card>

      <Card title="Reversals (bdc.reversals.listReversals)">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <Field label="Status filter">
                <select
                  className={inputCls}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">all</option>
                  {STATUS_FILTERS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <button className={btnSecondaryCls} onClick={() => load()}>
              Refresh list
            </button>
          </div>
          {listErr && <ErrorNote error={listErr} />}
          {listLoading && rows.length === 0 ? (
            <Spinner label="Loading reversals…" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">No reversals found.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {rows.map((r) => {
                const mine = Number.isFinite(myUserId) && r.requestedBy === myUserId;
                const approvable = r.status === "requested" && !mine;
                return (
                  <div key={r.id} className="py-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          #{r.id} · txn {r.txnId} · {r.reversalType}
                        </p>
                        <p className="text-xs text-slate-400">
                          requested by user {r.requestedBy}
                          {r.approvedBy != null ? ` · approved by user ${r.approvedBy}` : ""}
                          {r.railReference ? ` · rail ref ${r.railReference}` : ""}
                          {r.createdAt ? ` · ${fmtDateTime(r.createdAt)}` : ""}
                        </p>
                      </div>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </div>
                    <p className="text-sm text-slate-600">{r.reason}</p>
                    {r.status === "failed" && r.failureReason && (
                      <ErrorNote error={`Reversal execution failed: ${r.failureReason}`} />
                    )}
                    {r.status === "requested" && (
                      <div className="flex flex-wrap items-end gap-2">
                        {mine ? (
                          <p className="text-xs text-amber-600">
                            You requested this reversal — maker-checker requires a
                            different user to approve it.
                          </p>
                        ) : (
                          <>
                            <TotpField
                              value={approveTotp[r.id] ?? ""}
                              onChange={(c) => setApproveTotp((m) => ({ ...m, [r.id]: c }))}
                              label="Checker TOTP"
                            />
                            <button
                              className={btnPrimaryCls}
                              disabled={!approvable || (approveTotp[r.id] ?? "").length !== 6}
                              onClick={() => approve(r.id)}
                            >
                              Approve & execute
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {rowMsg[r.id] &&
                      (rowMsg[r.id].kind === "ok" ? (
                        <SuccessNote>{rowMsg[r.id].text}</SuccessNote>
                      ) : (
                        <ErrorNote error={rowMsg[r.id].text} />
                      ))}
                  </div>
                );
              })}
            </div>
          )}
          {nextCursor != null && (
            <button
              className={btnSecondaryCls}
              disabled={listLoading}
              onClick={() => load(nextCursor)}
            >
              {listLoading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
};

export default BdcReversals;
