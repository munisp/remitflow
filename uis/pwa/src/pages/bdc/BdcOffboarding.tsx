import React, { useCallback, useEffect, useState } from "react";
import {
  bdc,
  errMsg,
  fmtDateTime,
  type BdcOffboardingRecord,
  type OffboardingBlocker,
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
  PageHeader,
  Spinner,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

function offboardingTone(status: string): "ok" | "warn" | "bad" | "neutral" {
  switch (status) {
    case "completed":
      return "bad"; // terminal — the tenant is offboarded
    case "blocked":
      return "bad";
    case "requested":
    case "in_progress":
      return "warn";
    default:
      return "neutral";
  }
}

const BLOCKER_LABELS: Record<string, string> = {
  non_zero_position: "Non-zero FX position",
  open_nfem_batches: "Open NFEM purchase batches",
  unsettled_imto_payouts: "Unsettled IMTO payouts",
  open_regulatory_returns: "Open regulatory returns",
};

/**
 * BDC tenant offboarding (SPEC-wave12 §4.7 / §6.1).
 *
 * requestOffboarding upserts the record to 'requested' and starts the
 * blocker-evaluation workflow; the workflow settles to 'completed' (terminal)
 * or 'blocked' with the full blocker list in blockers jsonb — rendered here
 * verbatim (type + detail + ids). cancelOffboarding honestly DELETES a
 * non-terminal record (the schema has no 'cancelled' status).
 */
const BdcOffboarding: React.FC = () => {
  const [tenantId, setTenantId] = useState("");
  const [record, setRecord] = useState<BdcOffboardingRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [pageMsg, setPageMsg] = useState<string | null>(null);
  const [reqTotp, setReqTotp] = useState("");
  const [cancelTotp, setCancelTotp] = useState("");

  const refresh = useCallback(
    async (tid: number) => {
      setBusy(true);
      setPageErr(null);
      try {
        const res = await bdc.offboarding.getOffboardingStatus.query({ tenantId: tid });
        setRecord(res.offboarding);
        setLoaded(true);
      } catch (e) {
        setPageErr(errMsg(e));
        setRecord(null);
        setLoaded(true);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    // No auto-load: the procedure needs an explicit tenant id.
  }, []);

  const load = () => {
    setPageMsg(null);
    refresh(Number(tenantId));
  };

  const request = async () => {
    setPageErr(null);
    setPageMsg(null);
    try {
      const res = await bdc.offboarding.requestOffboarding.mutate({
        tenantId: Number(tenantId),
        totpCode: reqTotp,
      });
      // Honest started-state: blocker evaluation runs in the workflow.
      setPageMsg(
        res.workflowStarted
          ? `Offboarding #${res.offboardingId} requested — blocker evaluation started; refresh to see the settled state.`
          : `Offboarding #${res.offboardingId} requested, but the evaluation workflow did not start (Temporal unavailable) — the record honestly stays 'requested'; re-request to re-drive.`,
      );
      setReqTotp("");
      await refresh(Number(tenantId));
    } catch (e) {
      // PRECONDITION_FAILED when a completed offboarding is re-requested.
      setPageErr(errMsg(e));
    }
  };

  const cancel = async () => {
    setPageErr(null);
    setPageMsg(null);
    try {
      const res = await bdc.offboarding.cancelOffboarding.mutate({
        tenantId: Number(tenantId),
        totpCode: cancelTotp,
      });
      setPageMsg(
        `Offboarding cancelled from status '${res.previousStatus}' — the record was removed; the tenant has no offboarding in flight.`,
      );
      setCancelTotp("");
      await refresh(Number(tenantId));
    } catch (e) {
      // CONFLICT: not cancellable from in_progress/completed, or none in flight.
      setPageErr(errMsg(e));
    }
  };

  const blockers: OffboardingBlocker[] = Array.isArray(record?.blockers)
    ? record!.blockers
    : [];
  const cancellable = record?.status === "requested" || record?.status === "blocked";

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Tenant Offboarding"
        subtitle="Request, monitor and cancel tenant offboarding (bdc.offboarding.*)"
      />

      <Card title="Tenant lookup (bdc.offboarding.getOffboardingStatus)">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label="Tenant ID">
              <input
                className={inputCls}
                inputMode="numeric"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          <button className={btnSecondaryCls} disabled={!tenantId || busy} onClick={load}>
            {busy ? "Loading…" : "Load status"}
          </button>
        </div>
      </Card>

      {pageErr && <ErrorNote error={pageErr} />}
      {pageMsg && <SuccessNote>{pageMsg}</SuccessNote>}

      {busy && !loaded && <Spinner label="Loading offboarding status…" />}

      {loaded && !busy && (
        <>
          {record === null ? (
            <Card>
              <p className="text-sm text-slate-500">
                No offboarding record for tenant {tenantId} — the tenant is
                active with no offboarding in flight.
              </p>
            </Card>
          ) : (
            <Card title={`Offboarding #${record.id} — tenant ${record.tenantId}`}>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={offboardingTone(record.status)}>{record.status}</Badge>
                  {record.status === "completed" && (
                    <span className="text-sm text-red-600 font-medium">
                      Terminal — this tenant is offboarded; all BDC operations are
                      refused server-side (assertTenantActive).
                    </span>
                  )}
                  {record.status === "in_progress" && (
                    <span className="text-sm text-amber-600">
                      Blocker evaluation in flight — refresh for the settled state.
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  initiated by user {record.initiatedBy}
                  {record.createdAt ? ` · requested ${fmtDateTime(record.createdAt)}` : ""}
                  {record.completedAt ? ` · completed ${fmtDateTime(record.completedAt)}` : ""}
                </p>

                {record.status === "blocked" && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-900">
                      Blockers ({blockers.length}) — resolve these, then re-request:
                    </p>
                    {blockers.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        The record is 'blocked' but carries no blocker entries.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {blockers.map((b, i) => (
                          <li
                            key={`${b.type}-${i}`}
                            className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm"
                          >
                            <p className="font-medium text-red-700">
                              {BLOCKER_LABELS[b.type] ?? b.type}
                              {typeof b.count === "number" ? ` (${b.count})` : ""}
                            </p>
                            <p className="text-red-600">{b.detail}</p>
                            {Array.isArray(b.ids) && b.ids.length > 0 && (
                              <p className="text-xs text-red-400 mt-1 font-mono">
                                ids: {b.ids.join(", ")}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Request offboarding (bdc.offboarding.requestOffboarding + TOTP)">
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Starts the blocker-evaluation workflow (non-zero position, open
                  NFEM batches, unsettled IMTO payouts, open regulatory returns).
                  A completed offboarding is terminal and cannot be re-requested.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <TotpField value={reqTotp} onChange={setReqTotp} label="Admin TOTP" />
                  <button
                    className={btnPrimaryCls}
                    disabled={!tenantId || reqTotp.length !== 6 || record?.status === "completed"}
                    onClick={request}
                  >
                    Request offboarding
                  </button>
                </div>
              </div>
            </Card>

            <Card title="Cancel offboarding (bdc.offboarding.cancelOffboarding + TOTP)">
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Only possible from 'requested' or 'blocked' — cancellation
                  removes the record (there is no 'cancelled' status).
                  'completed' is terminal.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <TotpField value={cancelTotp} onChange={setCancelTotp} label="Admin TOTP" />
                  <button
                    className={btnDangerCls}
                    disabled={!tenantId || cancelTotp.length !== 6 || !cancellable}
                    onClick={cancel}
                  >
                    Cancel offboarding
                  </button>
                </div>
                {record != null && !cancellable && (
                  <p className="text-xs text-slate-400">
                    Current status '{record.status}' is not cancellable.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default BdcOffboarding;
