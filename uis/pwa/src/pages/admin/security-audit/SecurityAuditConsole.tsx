/**
 * W17-C2 — Admin security audit console (/admin/security-audit, AdminRoute-gated).
 *
 * First UI consumer of the mounted `securityAudit` namespace
 * (server/routers/securityAudit.ts — 16 procs; the 13 adminProcedure procs are
 * wired here; `myEntitlements` is protected/user-scope and
 * `requestSelfUnlock`/`verifySelfUnlock` are public locked-user self-service,
 * so none of those three are consumed by this console):
 *   - overview:  securityAudit.getVulnerabilityScore (score, grade, checks,
 *                per-check recommendations)
 *   - events:    securityAudit.getSecurityEvents (audit-log security.* rows),
 *                getPbacDenyEvents, getAnomalyAlerts, getAllSiemEvents (all
 *                SIEM-buffer projections with a type breakdown)
 *   - lockouts:  securityAudit.userLockoutStatus + admin actions unlockUser /
 *                resetLoginAttempts (TOTP step-up), lockoutHistory per user,
 *                lockoutTrends (7..365 days)
 *   - posture:   securityAudit.secretsRotation, securityAudit.geoBlockStatus
 *   - report:    securityAudit.getAuditReport (full section + compliance viewer)
 *
 * TOTP step-up follows the BDC console pattern (pages/bdc/TotpField.tsx):
 * the 6-digit code is forwarded as `totpCode` when entered; the PBAC
 * middleware enforces MFA fail-closed and any server "2FA_REQUIRED"/FORBIDDEN
 * error is surfaced verbatim. This console renders server data only — it never
 * fabricates events, scores, or lockout rows; every fetch failure is a
 * dismissible red banner (PWA has no toast library).
 *
 * Visual/interaction standard: KycReviewConsole + BDC consoles (Tailwind,
 * rounded-2xl cards, indigo accents, shared primitives from pages/bdc/ui.tsx).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  securityAuditApi,
  type AuditReport,
  type GeoBlockStatusResponse,
  type LockoutHistoryRow,
  type LockoutTrendPoint,
  type SecretsRotationResponse,
  type SecurityEventRow,
  type SiemEvent,
  type UserLockoutStatusResponse,
  type VulnerabilityScoreResponse,
} from "./api";
import TotpField from "../../bdc/TotpField";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
} from "../../bdc/ui";

type Tab = "overview" | "events" | "lockouts" | "posture" | "report";
type EventFeed = "security" | "pbac" | "anomaly" | "siem";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "overview", label: "Vulnerability score" },
  { value: "events", label: "Event viewers" },
  { value: "lockouts", label: "Lockouts" },
  { value: "posture", label: "Geo-block & secrets" },
  { value: "report", label: "Audit report" },
];

const EVENT_FEEDS: Array<{ value: EventFeed; label: string }> = [
  { value: "security", label: "Security events" },
  { value: "pbac", label: "PBAC denies" },
  { value: "anomaly", label: "Anomaly alerts" },
  { value: "siem", label: "All SIEM events" },
];

function fmtDate(v: string | Date | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const sevTone = (sev: string | null | undefined) => {
  switch ((sev ?? "").toLowerCase()) {
    case "critical":
    case "high":
      return "bad" as const;
    case "medium":
      return "warn" as const;
    case "low":
      return "info" as const;
    default:
      return "neutral" as const;
  }
};

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

const SecurityAuditConsole: React.FC = () => {
  const [tab, setTab] = useState<Tab>("overview");

  // ── overview ──
  const [vuln, setVuln] = useState<VulnerabilityScoreResponse | null>(null);
  const [vulnLoading, setVulnLoading] = useState(false);
  const [vulnErr, setVulnErr] = useState<string | null>(null);

  // ── events ──
  const [feed, setFeed] = useState<EventFeed>("security");
  const [feedLimit, setFeedLimit] = useState(100);
  const [securityEvents, setSecurityEvents] = useState<SecurityEventRow[] | null>(null);
  const [securityByType, setSecurityByType] = useState<Record<string, number>>({});
  const [siemEvents, setSiemEvents] = useState<SiemEvent[] | null>(null);
  const [siemByType, setSiemByType] = useState<Record<string, number>>({});
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState<string | null>(null);

  // ── lockouts ──
  const [lockouts, setLockouts] = useState<UserLockoutStatusResponse | null>(null);
  const [lockoutsLoading, setLockoutsLoading] = useState(false);
  const [lockoutsErr, setLockoutsErr] = useState<string | null>(null);
  const [historyUserId, setHistoryUserId] = useState("");
  const [history, setHistory] = useState<LockoutHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [trendDays, setTrendDays] = useState(30);
  const [trends, setTrends] = useState<LockoutTrendPoint[] | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsErr, setTrendsErr] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState("");
  const [totp, setTotp] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // ── posture ──
  const [secrets, setSecrets] = useState<SecretsRotationResponse | null>(null);
  const [geo, setGeo] = useState<GeoBlockStatusResponse | null>(null);
  const [postureLoading, setPostureLoading] = useState(false);
  const [postureErr, setPostureErr] = useState<string | null>(null);

  // ── report ──
  const [report, setReport] = useState<AuditReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportErr, setReportErr] = useState<string | null>(null);

  const loadVuln = useCallback(async () => {
    setVulnLoading(true);
    setVulnErr(null);
    try {
      setVuln(await securityAuditApi.securityAudit.getVulnerabilityScore.query());
    } catch (e) {
      setVuln(null);
      setVulnErr(errorMessage(e, "Vulnerability score could not be loaded. The admin API may be unavailable."));
    } finally {
      setVulnLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsErr(null);
    setSecurityEvents(null);
    setSiemEvents(null);
    try {
      if (feed === "security") {
        const res = await securityAuditApi.securityAudit.getSecurityEvents.query({ limit: feedLimit });
        setSecurityEvents(res.events);
        setSecurityByType(res.byType);
      } else if (feed === "pbac") {
        const res = await securityAuditApi.securityAudit.getPbacDenyEvents.query({ limit: feedLimit });
        setSiemEvents(res.events);
        setSiemByType({});
      } else if (feed === "anomaly") {
        const res = await securityAuditApi.securityAudit.getAnomalyAlerts.query({ limit: feedLimit });
        setSiemEvents(res.events);
        setSiemByType({});
      } else {
        const res = await securityAuditApi.securityAudit.getAllSiemEvents.query({ limit: feedLimit });
        setSiemEvents(res.events);
        setSiemByType(res.byType);
      }
    } catch (e) {
      setEventsErr(errorMessage(e, "Security events could not be loaded. The admin API may be unavailable."));
    } finally {
      setEventsLoading(false);
    }
  }, [feed, feedLimit]);

  const loadLockouts = useCallback(async () => {
    setLockoutsLoading(true);
    setLockoutsErr(null);
    try {
      setLockouts(await securityAuditApi.securityAudit.userLockoutStatus.query());
    } catch (e) {
      setLockouts(null);
      setLockoutsErr(errorMessage(e, "Lockout status could not be loaded. The admin API may be unavailable."));
    } finally {
      setLockoutsLoading(false);
    }
  }, []);

  const loadTrends = useCallback(async () => {
    setTrendsLoading(true);
    setTrendsErr(null);
    try {
      const res = await securityAuditApi.securityAudit.lockoutTrends.query({ days: trendDays });
      setTrends(res.trends);
    } catch (e) {
      setTrends(null);
      setTrendsErr(errorMessage(e, "Lockout trends could not be loaded."));
    } finally {
      setTrendsLoading(false);
    }
  }, [trendDays]);

  const loadPosture = useCallback(async () => {
    setPostureLoading(true);
    setPostureErr(null);
    try {
      const [secretsRes, geoRes] = await Promise.all([
        securityAuditApi.securityAudit.secretsRotation.query(),
        securityAuditApi.securityAudit.geoBlockStatus.query(),
      ]);
      setSecrets(secretsRes);
      setGeo(geoRes);
    } catch (e) {
      setSecrets(null);
      setGeo(null);
      setPostureErr(errorMessage(e, "Posture data could not be loaded. The admin API may be unavailable."));
    } finally {
      setPostureLoading(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    setReportErr(null);
    try {
      setReport(await securityAuditApi.securityAudit.getAuditReport.query());
    } catch (e) {
      setReport(null);
      setReportErr(errorMessage(e, "Audit report could not be loaded. The admin API may be unavailable."));
    } finally {
      setReportLoading(false);
    }
  }, []);

  // Load the active tab's data on first visit to that tab.
  useEffect(() => {
    if (tab === "overview" && !vuln && !vulnLoading && !vulnErr) void loadVuln();
    if (tab === "events") void loadEvents();
    if (tab === "lockouts") {
      if (!lockouts && !lockoutsLoading && !lockoutsErr) void loadLockouts();
      if (!trends && !trendsLoading && !trendsErr) void loadTrends();
    }
    if (tab === "posture" && !secrets && !postureLoading && !postureErr) void loadPosture();
    if (tab === "report" && !report && !reportLoading && !reportErr) void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, feed, feedLimit]);

  const loadHistory = async () => {
    const userId = Number(historyUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      setHistoryErr("Enter a valid positive numeric user ID.");
      return;
    }
    setHistoryLoading(true);
    setHistoryErr(null);
    setHistory(null);
    try {
      setHistory(await securityAuditApi.securityAudit.lockoutHistory.query({ userId }));
    } catch (e) {
      setHistoryErr(errorMessage(e, "Lockout history could not be loaded."));
    } finally {
      setHistoryLoading(false);
    }
  };

  const runLockoutAction = async (kind: "unlock" | "reset") => {
    const userId = Number(actionUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      setActionErr("Enter a valid positive numeric user ID.");
      return;
    }
    setActionBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const totpCode = totp.length === 6 ? totp : undefined;
      if (kind === "unlock") {
        await securityAuditApi.securityAudit.unlockUser.mutate({
          userId,
          ...(totpCode ? { totpCode } : {}),
        });
        setActionMsg(`User ${userId} unlocked (server verified).`);
      } else {
        await securityAuditApi.securityAudit.resetLoginAttempts.mutate({
          userId,
          ...(totpCode ? { totpCode } : {}),
        });
        setActionMsg(`Login attempts reset for user ${userId} (server verified).`);
      }
      setTotp("");
      void loadLockouts();
    } catch (e) {
      // Surfaces server 2FA_REQUIRED / FORBIDDEN verbatim — fail closed.
      setActionErr(errorMessage(e, "Action failed."));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Audit Console"
        subtitle="Vulnerability scoring, SIEM/PBAC event viewers, lockout administration, geo-block and secrets posture."
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
          {vulnErr && <ErrorBanner message={vulnErr} onDismiss={() => setVulnErr(null)} />}
          {vulnLoading && <Spinner label="Loading vulnerability score..." />}
          {vuln && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card>
                  <p className="text-xs text-slate-500">Score</p>
                  <p className="text-2xl font-bold text-slate-900">{vuln.score}/100</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">Grade</p>
                  <p className="text-2xl font-bold text-slate-900">{vuln.grade}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">Checks passed</p>
                  <p className="text-2xl font-bold text-emerald-600">
                    {vuln.summary.passed}/{vuln.summary.totalChecks}
                  </p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">Critical issues</p>
                  <p className="text-2xl font-bold text-red-600">{vuln.summary.criticalIssues}</p>
                </Card>
                <Card>
                  <p className="text-xs text-slate-500">High issues</p>
                  <p className="text-2xl font-bold text-amber-600">{vuln.summary.highIssues}</p>
                </Card>
              </div>
              <Card title="Security header checks">
                <div className="space-y-2">
                  {vuln.checks.map((c) => (
                    <div key={c.name} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-50 pb-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">{c.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={sevTone(c.severity)}>{c.severity}</Badge>
                        <Badge tone={c.passed ? "ok" : "bad"}>{c.passed ? "pass" : "fail"}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              {vuln.recommendations.length > 0 && (
                <Card title="Recommendations">
                  <ul className="space-y-2">
                    {vuln.recommendations.map((r) => (
                      <li key={r.check} className="flex items-start gap-2 text-sm text-slate-700">
                        <Badge tone={sevTone(r.severity)}>{r.severity}</Badge>
                        <span>{r.action}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
          {!vulnLoading && !vuln && !vulnErr && (
            <button type="button" onClick={() => void loadVuln()} className={btnPrimaryCls}>
              Load vulnerability score
            </button>
          )}
        </div>
      )}

      {tab === "events" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Feed">
              <select
                value={feed}
                onChange={(e) => setFeed(e.target.value as EventFeed)}
                className={inputCls}
              >
                {EVENT_FEEDS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Limit">
              <select
                value={feedLimit}
                onChange={(e) => setFeedLimit(Number(e.target.value))}
                className={inputCls}
              >
                {[50, 100, 200, 500].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
            <button type="button" onClick={() => void loadEvents()} className={btnSecondaryCls} disabled={eventsLoading}>
              Refresh
            </button>
          </div>
          {eventsErr && <ErrorBanner message={eventsErr} onDismiss={() => setEventsErr(null)} />}
          {eventsLoading && <Spinner label="Loading events..." />}

          {!eventsLoading && feed === "security" && securityEvents && (
            <Card title={`Security events (${securityEvents.length})`}>
              {Object.keys(securityByType).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {Object.entries(securityByType).map(([t, n]) => (
                    <Badge key={t} tone="info">{t}: {n}</Badge>
                  ))}
                </div>
              )}
              {securityEvents.length === 0 ? (
                <p className="text-sm text-slate-500">No security events returned by the server.</p>
              ) : (
                <div className="space-y-2">
                  {securityEvents.map((ev, i) => (
                    <div key={`${ev.type}-${i}`} className="rounded-xl border border-slate-100 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{ev.type}</span>
                        <span className="text-xs text-slate-400">{fmtDate(ev.timestamp)}</span>
                      </div>
                      {(ev.ip || ev.path) && (
                        <p className="text-xs text-slate-500 mt-1">
                          {ev.ip && <>IP {ev.ip} </>}
                          {ev.path && <>· {ev.path}</>}
                        </p>
                      )}
                      {ev.details && <p className="text-xs text-slate-600 mt-1">{ev.details}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {!eventsLoading && feed !== "security" && siemEvents && (
            <Card title={`${EVENT_FEEDS.find((f) => f.value === feed)?.label} (${siemEvents.length})`}>
              {Object.keys(siemByType).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {Object.entries(siemByType).map(([t, n]) => (
                    <Badge key={t} tone="info">{t}: {n}</Badge>
                  ))}
                </div>
              )}
              {siemEvents.length === 0 ? (
                <p className="text-sm text-slate-500">No SIEM events of this class in the server buffer.</p>
              ) : (
                <div className="space-y-2">
                  {siemEvents.map((ev, i) => (
                    <div key={`${ev.type}-${ev.ts}-${i}`} className="rounded-xl border border-slate-100 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{ev.type}</span>
                          <Badge tone={sevTone(ev.severity)}>{ev.severity}</Badge>
                        </div>
                        <span className="text-xs text-slate-400">{fmtDate(ev.ts)}</span>
                      </div>
                      {ev.detail && <p className="text-xs text-slate-600 mt-1">{ev.detail}</p>}
                      <p className="text-xs text-slate-400 mt-1">
                        {ev.userId !== undefined && <>user {ev.userId} </>}
                        {ev.ip && <>· IP {ev.ip} </>}
                        {ev.path && <>· {ev.path}</>}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "lockouts" && (
        <div className="space-y-4">
          {lockoutsErr && <ErrorBanner message={lockoutsErr} onDismiss={() => setLockoutsErr(null)} />}
          {lockoutsLoading && <Spinner label="Loading lockout status..." />}
          {lockouts && (
            <Card title={`User lockouts — ${lockouts.activeLockouts} active / ${lockouts.totalLockouts} total (checked ${fmtDate(lockouts.checkedAt)})`}>
              {lockouts.lockouts.length === 0 ? (
                <p className="text-sm text-slate-500">No lockout records returned by the server.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                        <th className="py-2 pr-3">User</th>
                        <th className="py-2 pr-3">Failed attempts</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Locked at</th>
                        <th className="py-2 pr-3">Expires</th>
                        <th className="py-2 pr-3">Unlocked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lockouts.lockouts.map((l) => (
                        <tr key={l.id} className="border-b border-slate-50">
                          <td className="py-2 pr-3 font-medium text-slate-900">{l.userId}</td>
                          <td className="py-2 pr-3">{l.failedAttempts}</td>
                          <td className="py-2 pr-3">
                            <Badge tone={l.isLocked ? "bad" : "ok"}>{l.isLocked ? "locked" : "clear"}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-xs text-slate-500">{fmtDate(l.lockedAt)}</td>
                          <td className="py-2 pr-3 text-xs text-slate-500">{fmtDate(l.lockExpiresAt)}</td>
                          <td className="py-2 pr-3 text-xs text-slate-500">
                            {l.unlockedAt ? `${fmtDate(l.unlockedAt)}${l.unlockedByAdminId ? ` (admin ${l.unlockedByAdminId})` : ""}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button type="button" onClick={() => void loadLockouts()} className={`${btnSecondaryCls} mt-3`} disabled={lockoutsLoading}>
                Refresh
              </button>
            </Card>
          )}

          <Card title="Admin actions — unlock / reset attempts (TOTP step-up)">
            {actionErr && <div className="mb-3"><ErrorBanner message={actionErr} onDismiss={() => setActionErr(null)} /></div>}
            {actionMsg && (
              <div className="mb-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700 flex items-start justify-between gap-4">
                <span>{actionMsg}</span>
                <button type="button" onClick={() => setActionMsg(null)} className="text-emerald-600 text-sm font-medium shrink-0">Dismiss</button>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-4">
              <Field label="User ID">
                <input
                  value={actionUserId}
                  onChange={(e) => setActionUserId(e.target.value.replace(/\D/g, ""))}
                  className={inputCls}
                  placeholder="e.g. 42"
                  inputMode="numeric"
                />
              </Field>
              <TotpField value={totp} onChange={setTotp} disabled={actionBusy} />
              <button
                type="button"
                onClick={() => void runLockoutAction("unlock")}
                className={btnPrimaryCls}
                disabled={actionBusy || !actionUserId}
              >
                Unlock user
              </button>
              <button
                type="button"
                onClick={() => void runLockoutAction("reset")}
                className={btnSecondaryCls}
                disabled={actionBusy || !actionUserId}
              >
                Reset login attempts
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Admin mutations require TOTP step-up — the server fails closed with 2FA_REQUIRED when a policy demands MFA.
            </p>
          </Card>

          <Card title="Per-user lockout history">
            {historyErr && <div className="mb-3"><ErrorBanner message={historyErr} onDismiss={() => setHistoryErr(null)} /></div>}
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <Field label="User ID">
                <input
                  value={historyUserId}
                  onChange={(e) => setHistoryUserId(e.target.value.replace(/\D/g, ""))}
                  className={inputCls}
                  placeholder="e.g. 42"
                  inputMode="numeric"
                />
              </Field>
              <button type="button" onClick={() => void loadHistory()} className={btnSecondaryCls} disabled={historyLoading || !historyUserId}>
                Load history
              </button>
            </div>
            {historyLoading && <Spinner label="Loading history..." />}
            {history && (
              history.length === 0 ? (
                <p className="text-sm text-slate-500">No lockout history rows for this user.</p>
              ) : (
                <JsonView data={history} />
              )
            )}
          </Card>

          <Card title={`Lockout trends (last ${trendDays} days)`}>
            {trendsErr && <div className="mb-3"><ErrorBanner message={trendsErr} onDismiss={() => setTrendsErr(null)} /></div>}
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <Field label="Window">
                <select value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))} className={inputCls}>
                  {[7, 14, 30, 90, 180, 365].map((d) => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </select>
              </Field>
              <button type="button" onClick={() => void loadTrends()} className={btnSecondaryCls} disabled={trendsLoading}>
                Refresh
              </button>
            </div>
            {trendsLoading && <Spinner label="Loading trends..." />}
            {trends && (
              trends.length === 0 ? (
                <p className="text-sm text-slate-500">No lockouts recorded in this window.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Lockouts</th>
                        <th className="py-2 pr-3">Failed attempts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trends.map((t) => (
                        <tr key={t.date} className="border-b border-slate-50">
                          <td className="py-2 pr-3">{t.date}</td>
                          <td className="py-2 pr-3">{t.lockouts}</td>
                          <td className="py-2 pr-3">{t.attempts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </Card>
        </div>
      )}

      {tab === "posture" && (
        <div className="space-y-4">
          {postureErr && <ErrorBanner message={postureErr} onDismiss={() => setPostureErr(null)} />}
          {postureLoading && <Spinner label="Loading posture data..." />}
          {secrets && (
            <Card title={`Secrets rotation (checked ${fmtDate(secrets.checkedAt)})`}>
              <div className="flex flex-wrap gap-2 mb-3">
                <Badge tone="ok">ok: {secrets.summary.ok}</Badge>
                <Badge tone="warn">warn: {secrets.summary.warn}</Badge>
                <Badge tone="bad">expired: {secrets.summary.expired}</Badge>
                <Badge tone="neutral">total: {secrets.summary.total}</Badge>
              </div>
              {secrets.secrets.length === 0 ? (
                <p className="text-sm text-slate-500">No secret rotation entries returned by the server.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                        <th className="py-2 pr-3">Secret</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Age (days)</th>
                        <th className="py-2 pr-3">Expires in (days)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {secrets.secrets.map((s) => (
                        <tr key={s.name} className="border-b border-slate-50">
                          <td className="py-2 pr-3 font-mono text-xs">{s.name}</td>
                          <td className="py-2 pr-3">
                            <Badge tone={s.status === "ok" ? "ok" : s.status === "warn" ? "warn" : "bad"}>{s.status}</Badge>
                          </td>
                          <td className="py-2 pr-3">{s.ageDays}</td>
                          <td className="py-2 pr-3">{s.expiresInDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {geo && (
            <Card title={`Geo-block status — ${geo.totalBlocked} blocked countries`}>
              <p className="text-xs text-slate-400 mb-3">
                Feed: {geo.feedSource} · last updated {fmtDate(geo.lastUpdated)}
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {geo.blockedCountries.map((c) => (
                  <Badge key={c.code} tone="bad">{c.code} — {c.name} ({c.reason})</Badge>
                ))}
              </div>
              <h3 className="text-xs font-semibold text-slate-500 mb-2">Recent block events</h3>
              {geo.recentBlockEvents.length === 0 ? (
                <p className="text-sm text-slate-500">No geo-block events in the SIEM buffer.</p>
              ) : (
                <div className="space-y-2">
                  {geo.recentBlockEvents.map((ev, i) => (
                    <div key={`${ev.ts}-${i}`} className="rounded-xl border border-slate-100 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{ev.type}</span>
                        <span className="text-xs text-slate-400">{fmtDate(ev.ts)}</span>
                      </div>
                      {ev.detail && <p className="text-xs text-slate-600 mt-1">{ev.detail}</p>}
                    </div>
                  ))}
                </div>
              )}
              {Object.keys(geo.blockCountsByCountry).length > 0 && (
                <>
                  <h3 className="text-xs font-semibold text-slate-500 mt-4 mb-2">Blocks by country</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(geo.blockCountsByCountry).map(([c, n]) => (
                      <Badge key={c} tone="warn">{c}: {n}</Badge>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "report" && (
        <div className="space-y-4">
          {reportErr && <ErrorBanner message={reportErr} onDismiss={() => setReportErr(null)} />}
          {reportLoading && <Spinner label="Generating audit report..." />}
          {report && (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500">{report.platform} · generated {fmtDate(report.generatedAt)}</p>
                    <p className="text-2xl font-bold text-slate-900">
                      Overall {report.overallScore}/100 ({report.grade})
                    </p>
                  </div>
                  <button type="button" onClick={() => void loadReport()} className={btnSecondaryCls} disabled={reportLoading}>
                    Regenerate
                  </button>
                </div>
              </Card>
              {report.sections.map((s) => (
                <Card key={s.name} title={`${s.name} — ${s.score}/100 (${s.grade})`}>
                  <div className="space-y-2">
                    {s.checks.map((c) => (
                      <div key={c.name} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-50 pb-2">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{c.name}</p>
                          <p className="text-xs text-slate-500">{c.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={sevTone(c.severity)}>{c.severity}</Badge>
                          <Badge tone={c.passed ? "ok" : "bad"}>{c.passed ? "pass" : "fail"}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
              <Card title="Compliance status">
                <div className="grid md:grid-cols-2 gap-3">
                  {Object.entries(report.complianceStatus).map(([key, v]) => (
                    <div key={key} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900 uppercase">{key.replace(/_/g, " ")}</span>
                        <Badge tone={v.compliant ? "ok" : "bad"}>{v.compliant ? "compliant" : "not compliant"}</Badge>
                      </div>
                      {v.level && <p className="text-xs text-slate-500 mt-1">Level: {v.level}</p>}
                      <p className="text-xs text-slate-500 mt-1">{v.notes}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SecurityAuditConsole;
