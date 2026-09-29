/**
 * W17-C2 — Admin insider-threat controls console (/admin/insider-threat,
 * AdminRoute-gated).
 *
 * First UI consumer of the mounted `insiderThreat` namespace
 * (server/routers/insiderThreatControls.ts — 25 procs across 7 sub-routers;
 * the 12 adminProcedure procs are wired here; the 13 protectedProcedure
 * user-scope procs — makerChecker.submit/getStatus, jitAccess.request/
 * checkAccess, geoTimeFence.check, dlp.checkAccess, webauthn.* — are
 * deliberately not consumed by an admin console):
 *   - dashboard:     insiderThreat.dashboard.overview (control totals)
 *   - maker-checker: makerChecker.listPending + approve / reject (TOTP)
 *   - JIT access:    jitAccess.listActive + revoke (TOTP)
 *   - geo/time fence: geoTimeFence.getConfig + breakGlass (TOTP, double-confirm)
 *   - DLP:           dlp.getEvents (blocked-only filter)
 *   - reversals:     delayedReversal.listPending + cancel (TOTP)
 *   - canary:        canary.checkAlert + triggerTest (confirm + TOTP)
 *
 * TOTP step-up follows the BDC console pattern (pages/bdc/TotpField.tsx):
 * the 6-digit code is forwarded as `totpCode` when entered; the PBAC
 * middleware enforces MFA fail-closed and any server "2FA_REQUIRED"/FORBIDDEN
 * error is surfaced verbatim. This console renders server data only — every
 * fetch failure is a dismissible red banner (PWA has no toast library), and
 * empty stores are shown as honest empty states.
 *
 * Visual/interaction standard: KycReviewConsole + BDC consoles (Tailwind,
 * rounded-2xl cards, indigo accents, shared primitives from pages/bdc/ui.tsx).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  insiderThreatApi,
  type BreakGlassResult,
  type CanaryAlert,
  type DelayedReversalRow,
  type DLPEvent,
  type GeoTimeFenceConfig,
  type InsiderThreatOverview,
  type JITAccessGrant,
  type MakerCheckerRequest,
} from "./api";
import TotpField from "../../bdc/TotpField";
import {
  Badge,
  btnDangerCls,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
} from "../../bdc/ui";

type Tab = "overview" | "makerChecker" | "jit" | "fence" | "dlp" | "reversals" | "canary";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "makerChecker", label: "Maker-checker queue" },
  { value: "jit", label: "JIT access" },
  { value: "fence", label: "Geo/time fence" },
  { value: "dlp", label: "DLP events" },
  { value: "reversals", label: "Delayed reversals" },
  { value: "canary", label: "Canary alerts" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const riskTone = (score: number) =>
  score >= 70 ? ("bad" as const) : score >= 40 ? ("warn" as const) : ("info" as const);

/** Dismissible red error banner — fail-closed pattern (pages/Beneficiaries.tsx). */
const ErrorBanner: React.FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => (
  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 flex items-start justify-between gap-4">
    <span className="text-sm whitespace-pre-wrap">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      className="text-red-500 hover:text-red-700 text-sm font-medium shrink-0"
    >
      Dismiss
    </button>
  </div>
);

const SuccessBanner: React.FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => (
  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 flex items-start justify-between gap-4">
    <span className="text-sm whitespace-pre-wrap">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      className="text-emerald-600 hover:text-emerald-800 text-sm font-medium shrink-0"
    >
      Dismiss
    </button>
  </div>
);

const InsiderThreatConsole: React.FC = () => {
  const [tab, setTab] = useState<Tab>("overview");

  // ── overview ──
  const [overview, setOverview] = useState<InsiderThreatOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewErr, setOverviewErr] = useState<string | null>(null);

  // ── maker-checker ──
  const [mcRequests, setMcRequests] = useState<MakerCheckerRequest[] | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcErr, setMcErr] = useState<string | null>(null);
  const [mcTotp, setMcTotp] = useState("");
  const [mcRejectReasons, setMcRejectReasons] = useState<Record<string, string>>({});
  const [mcBusyId, setMcBusyId] = useState<string | null>(null);
  const [mcActionErr, setMcActionErr] = useState<string | null>(null);
  const [mcActionMsg, setMcActionMsg] = useState<string | null>(null);

  // ── JIT access ──
  const [jitGrants, setJitGrants] = useState<JITAccessGrant[] | null>(null);
  const [jitLoading, setJitLoading] = useState(false);
  const [jitErr, setJitErr] = useState<string | null>(null);
  const [jitTotp, setJitTotp] = useState("");
  const [jitBusyId, setJitBusyId] = useState<string | null>(null);
  const [jitActionErr, setJitActionErr] = useState<string | null>(null);
  const [jitActionMsg, setJitActionMsg] = useState<string | null>(null);

  // ── geo/time fence ──
  const [fence, setFence] = useState<GeoTimeFenceConfig | null>(null);
  const [fenceLoading, setFenceLoading] = useState(false);
  const [fenceErr, setFenceErr] = useState<string | null>(null);
  const [bgArmed, setBgArmed] = useState(false); // first confirm step
  const [bgReason, setBgReason] = useState("");
  const [bgIncidentId, setBgIncidentId] = useState("");
  const [bgTotp, setBgTotp] = useState("");
  const [bgBusy, setBgBusy] = useState(false);
  const [bgErr, setBgErr] = useState<string | null>(null);
  const [bgResult, setBgResult] = useState<BreakGlassResult | null>(null);

  // ── DLP ──
  const [dlpEvents, setDlpEvents] = useState<DLPEvent[] | null>(null);
  const [dlpTotal, setDlpTotal] = useState(0);
  const [dlpBlockedOnly, setDlpBlockedOnly] = useState(false);
  const [dlpLoading, setDlpLoading] = useState(false);
  const [dlpErr, setDlpErr] = useState<string | null>(null);

  // ── delayed reversals ──
  const [reversals, setReversals] = useState<DelayedReversalRow[] | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [revErr, setRevErr] = useState<string | null>(null);
  const [revTotp, setRevTotp] = useState("");
  const [revReasons, setRevReasons] = useState<Record<string, string>>({});
  const [revBusyId, setRevBusyId] = useState<string | null>(null);
  const [revActionErr, setRevActionErr] = useState<string | null>(null);
  const [revActionMsg, setRevActionMsg] = useState<string | null>(null);

  // ── canary ──
  const [canaryAlerts, setCanaryAlerts] = useState<CanaryAlert[] | null>(null);
  const [canaryMeta, setCanaryMeta] = useState<{ total: number; tablesMonitored: number } | null>(null);
  const [canaryLoading, setCanaryLoading] = useState(false);
  const [canaryErr, setCanaryErr] = useState<string | null>(null);
  const [canaryTotp, setCanaryTotp] = useState("");
  const [canaryBusy, setCanaryBusy] = useState(false);
  const [canaryActionErr, setCanaryActionErr] = useState<string | null>(null);
  const [canaryActionMsg, setCanaryActionMsg] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewErr(null);
    try {
      setOverview(await insiderThreatApi.insiderThreat.dashboard.overview.query());
    } catch (e) {
      setOverview(null);
      setOverviewErr(errorMessage(e, "Insider-threat overview could not be loaded. The admin API may be unavailable."));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadMakerChecker = useCallback(async () => {
    setMcLoading(true);
    setMcErr(null);
    try {
      const res = await insiderThreatApi.insiderThreat.makerChecker.listPending.query();
      setMcRequests(res.requests);
    } catch (e) {
      setMcRequests(null);
      setMcErr(errorMessage(e, "Maker-checker queue could not be loaded."));
    } finally {
      setMcLoading(false);
    }
  }, []);

  const loadJit = useCallback(async () => {
    setJitLoading(true);
    setJitErr(null);
    try {
      const res = await insiderThreatApi.insiderThreat.jitAccess.listActive.query();
      setJitGrants(res.grants);
    } catch (e) {
      setJitGrants(null);
      setJitErr(errorMessage(e, "Active JIT grants could not be loaded."));
    } finally {
      setJitLoading(false);
    }
  }, []);

  const loadFence = useCallback(async () => {
    setFenceLoading(true);
    setFenceErr(null);
    try {
      setFence(await insiderThreatApi.insiderThreat.geoTimeFence.getConfig.query());
    } catch (e) {
      setFence(null);
      setFenceErr(errorMessage(e, "Geo/time fence config could not be loaded."));
    } finally {
      setFenceLoading(false);
    }
  }, []);

  const loadDlp = useCallback(async () => {
    setDlpLoading(true);
    setDlpErr(null);
    try {
      const res = await insiderThreatApi.insiderThreat.dlp.getEvents.query({
        limit: 50,
        blockedOnly: dlpBlockedOnly,
      });
      setDlpEvents(res.events);
      setDlpTotal(res.total);
    } catch (e) {
      setDlpEvents(null);
      setDlpErr(errorMessage(e, "DLP events could not be loaded."));
    } finally {
      setDlpLoading(false);
    }
  }, [dlpBlockedOnly]);

  const loadReversals = useCallback(async () => {
    setRevLoading(true);
    setRevErr(null);
    try {
      const res = await insiderThreatApi.insiderThreat.delayedReversal.listPending.query();
      setReversals(res.reversals);
    } catch (e) {
      setReversals(null);
      setRevErr(errorMessage(e, "Pending delayed reversals could not be loaded."));
    } finally {
      setRevLoading(false);
    }
  }, []);

  const loadCanary = useCallback(async () => {
    setCanaryLoading(true);
    setCanaryErr(null);
    try {
      const res = await insiderThreatApi.insiderThreat.canary.checkAlert.query();
      setCanaryAlerts(res.alerts);
      setCanaryMeta({ total: res.total, tablesMonitored: res.tablesMonitored });
    } catch (e) {
      setCanaryAlerts(null);
      setCanaryMeta(null);
      setCanaryErr(errorMessage(e, "Canary alerts could not be loaded."));
    } finally {
      setCanaryLoading(false);
    }
  }, []);

  // Load the active tab's data on first visit to that tab.
  useEffect(() => {
    if (tab === "overview" && !overview && !overviewLoading && !overviewErr) void loadOverview();
    if (tab === "makerChecker" && !mcRequests && !mcLoading && !mcErr) void loadMakerChecker();
    if (tab === "jit" && !jitGrants && !jitLoading && !jitErr) void loadJit();
    if (tab === "fence" && !fence && !fenceLoading && !fenceErr) void loadFence();
    if (tab === "dlp") void loadDlp();
    if (tab === "reversals" && !reversals && !revLoading && !revErr) void loadReversals();
    if (tab === "canary" && !canaryAlerts && !canaryLoading && !canaryErr) void loadCanary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dlpBlockedOnly]);

  // ── mutations ──

  const mcApprove = async (req: MakerCheckerRequest) => {
    setMcBusyId(req.id);
    setMcActionErr(null);
    setMcActionMsg(null);
    try {
      const totpCode = mcTotp.length === 6 ? mcTotp : undefined;
      const res = await insiderThreatApi.insiderThreat.makerChecker.approve.mutate({
        requestId: req.id,
        ...(totpCode ? { totpCode } : {}),
      });
      setMcActionMsg(res.message);
      setMcTotp("");
      void loadMakerChecker();
    } catch (e) {
      setMcActionErr(errorMessage(e, "Approve failed."));
    } finally {
      setMcBusyId(null);
    }
  };

  const mcReject = async (req: MakerCheckerRequest) => {
    const reason = (mcRejectReasons[req.id] ?? "").trim();
    if (reason.length < 5) {
      setMcActionErr("Rejection reason must be at least 5 characters.");
      return;
    }
    setMcBusyId(req.id);
    setMcActionErr(null);
    setMcActionMsg(null);
    try {
      const totpCode = mcTotp.length === 6 ? mcTotp : undefined;
      await insiderThreatApi.insiderThreat.makerChecker.reject.mutate({
        requestId: req.id,
        reason,
        ...(totpCode ? { totpCode } : {}),
      });
      setMcActionMsg(`Request ${req.id} rejected.`);
      setMcRejectReasons((m) => ({ ...m, [req.id]: "" }));
      setMcTotp("");
      void loadMakerChecker();
    } catch (e) {
      setMcActionErr(errorMessage(e, "Reject failed."));
    } finally {
      setMcBusyId(null);
    }
  };

  const jitRevoke = async (grant: JITAccessGrant) => {
    setJitBusyId(grant.id);
    setJitActionErr(null);
    setJitActionMsg(null);
    try {
      const totpCode = jitTotp.length === 6 ? jitTotp : undefined;
      await insiderThreatApi.insiderThreat.jitAccess.revoke.mutate({
        grantId: grant.id,
        ...(totpCode ? { totpCode } : {}),
      });
      setJitActionMsg(`JIT grant ${grant.id} revoked.`);
      setJitTotp("");
      void loadJit();
    } catch (e) {
      setJitActionErr(errorMessage(e, "Revoke failed."));
    } finally {
      setJitBusyId(null);
    }
  };

  const runBreakGlass = async () => {
    const reason = bgReason.trim();
    if (reason.length < 20) {
      setBgErr("Break-glass reason must be at least 20 characters (server-enforced).");
      return;
    }
    setBgBusy(true);
    setBgErr(null);
    try {
      const totpCode = bgTotp.length === 6 ? bgTotp : undefined;
      const res = await insiderThreatApi.insiderThreat.geoTimeFence.breakGlass.mutate({
        reason,
        ...(bgIncidentId.trim() ? { incidentId: bgIncidentId.trim() } : {}),
        ...(totpCode ? { totpCode } : {}),
      });
      setBgResult(res);
      setBgArmed(false);
      setBgReason("");
      setBgIncidentId("");
      setBgTotp("");
    } catch (e) {
      setBgErr(errorMessage(e, "Break-glass request failed."));
    } finally {
      setBgBusy(false);
    }
  };

  const revCancel = async (rev: DelayedReversalRow) => {
    const reason = (revReasons[rev.id] ?? "").trim();
    if (reason.length < 5) {
      setRevActionErr("Cancellation reason must be at least 5 characters.");
      return;
    }
    setRevBusyId(rev.id);
    setRevActionErr(null);
    setRevActionMsg(null);
    try {
      const totpCode = revTotp.length === 6 ? revTotp : undefined;
      await insiderThreatApi.insiderThreat.delayedReversal.cancel.mutate({
        reversalId: rev.id,
        reason,
        ...(totpCode ? { totpCode } : {}),
      });
      setRevActionMsg(`Delayed reversal ${rev.id} cancelled before execution.`);
      setRevReasons((m) => ({ ...m, [rev.id]: "" }));
      setRevTotp("");
      void loadReversals();
    } catch (e) {
      setRevActionErr(errorMessage(e, "Cancel failed."));
    } finally {
      setRevBusyId(null);
    }
  };

  const triggerCanaryTest = async () => {
    if (!window.confirm("Trigger a canary token test alert? This writes a critical-severity alert to the canary store.")) {
      return;
    }
    setCanaryBusy(true);
    setCanaryActionErr(null);
    setCanaryActionMsg(null);
    try {
      const totpCode = canaryTotp.length === 6 ? canaryTotp : undefined;
      const res = await insiderThreatApi.insiderThreat.canary.triggerTest.mutate({
        ...(totpCode ? { totpCode } : {}),
      });
      setCanaryActionMsg(`Test canary triggered (alert ${res.alertId}).`);
      setCanaryTotp("");
      void loadCanary();
    } catch (e) {
      setCanaryActionErr(errorMessage(e, "Canary test trigger failed."));
    } finally {
      setCanaryBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insider Threat Controls"
        subtitle="Maker-checker dual authorization, JIT privileged access, geo/time fencing, DLP, delayed reversals, and canary tokens."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={tab === t.value ? btnPrimaryCls : btnSecondaryCls}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          {overviewErr && <ErrorBanner message={overviewErr} onDismiss={() => setOverviewErr(null)} />}
          {overviewLoading && <Spinner label="Loading overview..." />}
          {overview && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Card>
                  <p className="text-xs text-slate-500">Pending maker-checker</p>
                  <p className="text-2xl font-bold text-slate-900">{overview.pendingMakerCheckerRequests}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">Active JIT grants</p>
                  <p className="text-2xl font-bold text-slate-900">{overview.activeJITGrants}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">DLP blocked events</p>
                  <p className="text-2xl font-bold text-red-600">{overview.dlpBlockedEvents}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">Pending high-value reversals</p>
                  <p className="text-2xl font-bold text-amber-600">{overview.pendingHighValueReversals}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">Canary alerts</p>
                  <p className="text-2xl font-bold text-red-600">{overview.canaryAlertsTotal}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">WebAuthn keys registered</p>
                  <p className="text-2xl font-bold text-slate-900">{overview.webauthnKeysRegistered}</p>
                </Card>
              </div>
              <Card>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={overview.geoTimeFenceActive ? "ok" : "neutral"}>
                    geo/time fence {overview.geoTimeFenceActive ? "active" : "inactive"}
                  </Badge>
                  <Badge tone={overview.withinBusinessHours ? "ok" : "warn"}>
                    {overview.withinBusinessHours ? "within business hours (UTC)" : "outside business hours (UTC)"}
                  </Badge>
                </div>
                <button type="button" onClick={() => void loadOverview()} className={`${btnSecondaryCls} mt-3`} disabled={overviewLoading}>
                  Refresh
                </button>
              </Card>
            </>
          )}
        </div>
      )}

      {tab === "makerChecker" && (
        <div className="space-y-4">
          {mcErr && <ErrorBanner message={mcErr} onDismiss={() => setMcErr(null)} />}
          {mcActionErr && <ErrorBanner message={mcActionErr} onDismiss={() => setMcActionErr(null)} />}
          {mcActionMsg && <SuccessBanner message={mcActionMsg} onDismiss={() => setMcActionMsg(null)} />}
          <Card title="TOTP step-up for approve / reject">
            <TotpField value={mcTotp} onChange={setMcTotp} disabled={mcBusyId !== null} />
            <p className="text-xs text-slate-400 mt-2">
              Admin mutations require TOTP step-up — the server fails closed with 2FA_REQUIRED when a policy demands MFA.
            </p>
          </Card>
          {mcLoading && <Spinner label="Loading pending requests..." />}
          {mcRequests && (
            <Card title={`Pending dual-authorization requests (${mcRequests.length})`}>
              {mcRequests.length === 0 ? (
                <p className="text-sm text-slate-500">No pending maker-checker requests.</p>
              ) : (
                <div className="space-y-3">
                  {mcRequests.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-100 p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{r.id}</span>
                          <Badge tone="info">{r.operationType}</Badge>
                          <Badge tone={riskTone(r.riskScore)}>risk {r.riskScore}/100</Badge>
                        </div>
                        <span className="text-xs text-slate-400">expires {fmtDate(r.expiresAt)}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        requested by user {r.requestedBy} at {fmtDate(r.requestedAt)} · approvals {r.currentApprovals}/{r.requiredApprovers}
                      </p>
                      {typeof r.payload.justification === "string" && (
                        <p className="text-sm text-slate-700">Justification: {r.payload.justification}</p>
                      )}
                      <details>
                        <summary className="text-xs text-indigo-600 cursor-pointer">Payload</summary>
                        <JsonView data={r.payload} />
                      </details>
                      <div className="flex flex-wrap items-end gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => void mcApprove(r)}
                          className={btnPrimaryCls}
                          disabled={mcBusyId !== null}
                        >
                          {mcBusyId === r.id ? "Working…" : "Approve"}
                        </button>
                        <Field label="Reject reason (min 5 chars)">
                          <input
                            value={mcRejectReasons[r.id] ?? ""}
                            onChange={(e) => setMcRejectReasons((m) => ({ ...m, [r.id]: e.target.value }))}
                            className={inputCls}
                            placeholder="Why is this rejected?"
                          />
                        </Field>
                        <button
                          type="button"
                          onClick={() => void mcReject(r)}
                          className={btnDangerCls}
                          disabled={mcBusyId !== null}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => void loadMakerChecker()} className={`${btnSecondaryCls} mt-3`} disabled={mcLoading}>
                Refresh
              </button>
            </Card>
          )}
        </div>
      )}

      {tab === "jit" && (
        <div className="space-y-4">
          {jitErr && <ErrorBanner message={jitErr} onDismiss={() => setJitErr(null)} />}
          {jitActionErr && <ErrorBanner message={jitActionErr} onDismiss={() => setJitActionErr(null)} />}
          {jitActionMsg && <SuccessBanner message={jitActionMsg} onDismiss={() => setJitActionMsg(null)} />}
          <Card title="TOTP step-up for revoke">
            <TotpField value={jitTotp} onChange={setJitTotp} disabled={jitBusyId !== null} />
          </Card>
          {jitLoading && <Spinner label="Loading active grants..." />}
          {jitGrants && (
            <Card title={`Active JIT privileged-access grants (${jitGrants.length})`}>
              {jitGrants.length === 0 ? (
                <p className="text-sm text-slate-500">No active JIT grants.</p>
              ) : (
                <div className="space-y-3">
                  {jitGrants.map((g) => (
                    <div key={g.id} className="rounded-xl border border-slate-100 p-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge tone="info">{g.privilege}</Badge>
                          <span className="text-sm font-medium text-slate-900">user {g.userId}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          granted {fmtDate(g.grantedAt)} · expires {fmtDate(g.expiresAt)} · {g.actionsPerformed} actions performed
                        </p>
                        <p className="text-xs text-slate-600 mt-1">Reason: {g.reason}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void jitRevoke(g)}
                        className={btnDangerCls}
                        disabled={jitBusyId !== null}
                      >
                        {jitBusyId === g.id ? "Revoking…" : "Revoke"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => void loadJit()} className={`${btnSecondaryCls} mt-3`} disabled={jitLoading}>
                Refresh
              </button>
            </Card>
          )}
        </div>
      )}

      {tab === "fence" && (
        <div className="space-y-4">
          {fenceErr && <ErrorBanner message={fenceErr} onDismiss={() => setFenceErr(null)} />}
          {fenceLoading && <Spinner label="Loading fence config..." />}
          {fence && (
            <Card title="Geo + time fence configuration (server-reported)">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">Allowed countries</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {fence.allowedCountries.map((c) => (
                      <Badge key={c} tone="info">{c}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">Allowed IPs</h3>
                  {fence.allowedIPs.length === 0 ? (
                    <p className="text-sm text-slate-500">No IP restriction configured (server default).</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {fence.allowedIPs.map((ip) => (
                        <Badge key={ip} tone="neutral">{ip}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">Business hours (UTC)</h3>
                  <p className="text-sm text-slate-900">
                    {String(fence.businessHoursStart).padStart(2, "0")}:00 – {String(fence.businessHoursEnd).padStart(2, "0")}:00
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">Allowed days</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {fence.allowedDays.map((d) => (
                      <Badge key={d} tone="neutral">{DAY_NAMES[d] ?? d}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <Badge tone={fence.breakGlassEnabled ? "warn" : "ok"}>
                  break-glass {fence.breakGlassEnabled ? "enabled" : "disabled"}
                </Badge>
              </div>
            </Card>
          )}

          <Card title="Break-glass access (double-confirm, TOTP step-up)">
            {bgErr && <div className="mb-3"><ErrorBanner message={bgErr} onDismiss={() => setBgErr(null)} /></div>}
            {bgResult && (
              <div className="mb-3">
                <SuccessBanner
                  message={`Break-glass bypass ${bgResult.bypassId} granted to user ${bgResult.userId}, expires ${fmtDate(bgResult.expiresAt)}. ${bgResult.auditNote}`}
                  onDismiss={() => setBgResult(null)}
                />
              </div>
            )}
            {!bgArmed ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">
                  Break-glass creates a time-limited (1 hour) bypass of the geo/time fence with a full audit
                  trail. A post-incident review is required within 48 hours.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    // First of two explicit confirmations.
                    if (window.confirm("Arm break-glass access? You will need to confirm again with a reason and TOTP code.")) {
                      setBgArmed(true);
                    }
                  }}
                  className={btnDangerCls}
                  disabled={fence !== null && !fence.breakGlassEnabled}
                >
                  Arm break-glass…
                </button>
                {fence !== null && !fence.breakGlassEnabled && (
                  <p className="text-xs text-slate-400">Break-glass is disabled in the server fence configuration.</p>
                )}
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/50 p-4">
                <p className="text-sm font-medium text-red-700">
                  Final confirmation — this action is audited and creates a live bypass.
                </p>
                <Field label="Reason (min 20 characters, required)" hint="Include ticket/incident reference.">
                  <textarea
                    value={bgReason}
                    onChange={(e) => setBgReason(e.target.value)}
                    className={inputCls}
                    rows={3}
                    placeholder="e.g. Incident INC-1234: admin locked out of region during failover…"
                  />
                </Field>
                <Field label="Incident ID (optional)">
                  <input
                    value={bgIncidentId}
                    onChange={(e) => setBgIncidentId(e.target.value)}
                    className={inputCls}
                    placeholder="INC-1234"
                  />
                </Field>
                <TotpField value={bgTotp} onChange={setBgTotp} disabled={bgBusy} />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => void runBreakGlass()}
                    className={btnDangerCls}
                    disabled={bgBusy || bgReason.trim().length < 20}
                  >
                    {bgBusy ? "Requesting…" : "Confirm break-glass"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBgArmed(false);
                      setBgErr(null);
                    }}
                    className={btnSecondaryCls}
                    disabled={bgBusy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "dlp" && (
        <div className="space-y-4">
          {dlpErr && <ErrorBanner message={dlpErr} onDismiss={() => setDlpErr(null)} />}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={dlpBlockedOnly}
                onChange={(e) => setDlpBlockedOnly(e.target.checked)}
              />
              Blocked events only
            </label>
            <button type="button" onClick={() => void loadDlp()} className={btnSecondaryCls} disabled={dlpLoading}>
              Refresh
            </button>
          </div>
          {dlpLoading && <Spinner label="Loading DLP events..." />}
          {dlpEvents && (
            <Card title={`DLP events (showing ${dlpEvents.length} of ${dlpTotal})`}>
              {dlpEvents.length === 0 ? (
                <p className="text-sm text-slate-500">No DLP events{dlpBlockedOnly ? " matching the blocked-only filter" : ""} in the server store.</p>
              ) : (
                <div className="space-y-2">
                  {dlpEvents.map((ev) => (
                    <div key={ev.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{ev.action}</span>
                          <Badge tone="neutral">{ev.table}</Badge>
                          <Badge tone={ev.blocked ? "bad" : "ok"}>{ev.blocked ? "blocked" : "allowed"}</Badge>
                        </div>
                        <span className="text-xs text-slate-400">{fmtDate(ev.timestamp)}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        user {ev.userId} · {ev.recordCount} record{ev.recordCount === 1 ? "" : "s"}
                      </p>
                      {ev.reason && <p className="text-xs text-red-600 mt-1">{ev.reason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "reversals" && (
        <div className="space-y-4">
          {revErr && <ErrorBanner message={revErr} onDismiss={() => setRevErr(null)} />}
          {revActionErr && <ErrorBanner message={revActionErr} onDismiss={() => setRevActionErr(null)} />}
          {revActionMsg && <SuccessBanner message={revActionMsg} onDismiss={() => setRevActionMsg(null)} />}
          <Card title="TOTP step-up for cancel">
            <TotpField value={revTotp} onChange={setRevTotp} disabled={revBusyId !== null} />
          </Card>
          {revLoading && <Spinner label="Loading pending reversals..." />}
          {reversals && (
            <Card title={`Pending high-value reversals (${reversals.length})`}>
              {reversals.length === 0 ? (
                <p className="text-sm text-slate-500">No pending delayed reversals.</p>
              ) : (
                <div className="space-y-3">
                  {reversals.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-100 p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{r.id}</span>
                          <Badge tone="warn">executes {fmtDate(r.executeAt)}</Badge>
                        </div>
                        <span className="text-sm font-semibold text-slate-900">${r.amount.toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        transfer ref <span className="font-mono">{r.transferRef}</span> · requested by user {r.requestedBy} at {fmtDate(r.requestedAt)}
                      </p>
                      <div className="flex flex-wrap items-end gap-3 pt-1">
                        <Field label="Cancel reason (min 5 chars)">
                          <input
                            value={revReasons[r.id] ?? ""}
                            onChange={(e) => setRevReasons((m) => ({ ...m, [r.id]: e.target.value }))}
                            className={inputCls}
                            placeholder="Why is this reversal cancelled?"
                          />
                        </Field>
                        <button
                          type="button"
                          onClick={() => void revCancel(r)}
                          className={btnDangerCls}
                          disabled={revBusyId !== null}
                        >
                          {revBusyId === r.id ? "Cancelling…" : "Cancel before execution"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => void loadReversals()} className={`${btnSecondaryCls} mt-3`} disabled={revLoading}>
                Refresh
              </button>
            </Card>
          )}
        </div>
      )}

      {tab === "canary" && (
        <div className="space-y-4">
          {canaryErr && <ErrorBanner message={canaryErr} onDismiss={() => setCanaryErr(null)} />}
          {canaryActionErr && <ErrorBanner message={canaryActionErr} onDismiss={() => setCanaryActionErr(null)} />}
          {canaryActionMsg && <SuccessBanner message={canaryActionMsg} onDismiss={() => setCanaryActionMsg(null)} />}
          <Card title="Trigger test canary (confirm + TOTP step-up)">
            <div className="flex flex-wrap items-end gap-4">
              <TotpField value={canaryTotp} onChange={setCanaryTotp} disabled={canaryBusy} />
              <button type="button" onClick={() => void triggerCanaryTest()} className={btnDangerCls} disabled={canaryBusy}>
                {canaryBusy ? "Triggering…" : "Trigger test alert"}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Writes a critical-severity test alert into the canary store to verify the detection path end-to-end.
            </p>
          </Card>
          {canaryLoading && <Spinner label="Loading canary alerts..." />}
          {canaryAlerts && canaryMeta && (
            <Card title={`Canary alerts (${canaryMeta.total} total · ${canaryMeta.tablesMonitored} PII tables monitored)`}>
              {canaryAlerts.length === 0 ? (
                <p className="text-sm text-slate-500">No canary alerts — no honey-record access detected.</p>
              ) : (
                <div className="space-y-2">
                  {canaryAlerts.map((a) => (
                    <div key={a.id} className="rounded-xl border border-red-100 bg-red-50/40 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone="bad">{a.severity}</Badge>
                          <span className="font-medium text-slate-900">{a.canaryRecordId}</span>
                        </div>
                        <span className="text-xs text-slate-400">{fmtDate(a.accessedAt)}</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        accessed by user {a.accessedBy} from {a.ipAddress}
                      </p>
                      <p className="text-xs font-mono text-slate-500 mt-1">{a.query}</p>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => void loadCanary()} className={`${btnSecondaryCls} mt-3`} disabled={canaryLoading}>
                Refresh
              </button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default InsiderThreatConsole;
