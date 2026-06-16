import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, CheckCircle2, XCircle, AlertTriangle, Lock, Eye, FileText,
  Ban, Activity, Cpu, Zap, RefreshCw, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useTranslation } from 'react-i18next';

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800",
  high: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800",
  medium: "text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800",
  low: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",
  info: "text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-950/20 dark:border-slate-800",
};

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-green-600", "A": "text-green-500", "A-": "text-green-400",
  "B": "text-yellow-500", "C": "text-orange-500", "D": "text-red-500", "F": "text-red-700",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  PBAC_DENY: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  ATO_DETECTED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  CREDENTIAL_STUFFING: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  BEC_DETECTED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  VELOCITY_ANOMALY: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  ROUND_TRIP_DETECTED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  RATE_LIMIT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  SUSPICIOUS_UA: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
};

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const color = score >= 90 ? "bg-green-500" : score >= 75 ? "bg-yellow-500" : score >= 60 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-32 h-32 flex items-center justify-center rounded-full border-8 border-muted">
        <div className="text-center">
          <div className={`text-3xl font-bold ${GRADE_COLORS[grade] || "text-foreground"}`}>{grade}</div>
          <div className="text-sm text-muted-foreground">{score}/100</div>
        </div>
      </div>
      <Progress value={score} className={`w-32 h-2 ${color}`} />
    </div>
  );
}

function SiemEventRow({ event }: { event: any }) {
  const colorClass = EVENT_TYPE_COLORS[event.type] ?? "bg-slate-100 text-slate-800";
  const severityColor = SEVERITY_COLORS[event.severity] ?? SEVERITY_COLORS.info;
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
      <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${
        event.severity === "critical" ? "text-red-500" :
        event.severity === "high" ? "text-orange-500" :
        event.severity === "medium" ? "text-yellow-500" : "text-slate-400"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs font-mono ${colorClass}`}>{event.type}</Badge>
          <Badge variant="outline" className={`text-xs ${severityColor}`}>{event.severity}</Badge>
          {event.ip && <span className="text-muted-foreground text-xs font-mono">{event.ip}</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">{event.detail}</div>
        <div className="text-xs text-muted-foreground/60 mt-0.5">
          {event.path && <span className="font-mono">{event.path} — </span>}
          {new Date(event.ts).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export default function SecurityDashboard() {
  const { t } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);
  const queryOpts = { refetchInterval: 30_000 };

  const { data: report, isLoading, isError } = trpc.securityAudit.getAuditReport.useQuery(undefined, queryOpts);
  const { data: events } = trpc.securityAudit.getSecurityEvents.useQuery({ limit: 50 }, queryOpts);
  const { data: pbacDenies } = trpc.securityAudit.getPbacDenyEvents.useQuery({ limit: 100 }, queryOpts);
  const { data: anomalies } = trpc.securityAudit.getAnomalyAlerts.useQuery({ limit: 100 }, queryOpts);
  const { data: siemAll } = trpc.securityAudit.getAllSiemEvents.useQuery({ limit: 200 }, queryOpts);
  // v147: New security feature data
  const { data: secretsRotation } = trpc.securityAudit.secretsRotation.useQuery(undefined, queryOpts);
  const { data: geoBlockStatus } = trpc.securityAudit.geoBlockStatus.useQuery(undefined, queryOpts);
  const { data: userLockouts } = trpc.securityAudit.userLockoutStatus.useQuery(undefined, queryOpts);
  // v151: Lockout trends chart with date-range picker
  const [trendDays, setTrendDays] = useState<7 | 30 | 90 | 365>(30);
  const { data: lockoutTrends } = trpc.securityAudit.lockoutTrends.useQuery({ days: trendDays }, queryOpts);
  const unlockUserMutation = trpc.securityAudit.unlockUser.useMutation({
    onSuccess: () => { setRefreshKey(k => k + 1); },
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading security dashboard...</div>
        </div>
      </DashboardLayout>
    );
  }

  const totalThreats = (pbacDenies?.total ?? 0) + (anomalies?.total ?? 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6" />
              Security Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
              PBAC enforcement, threat detection, SIEM events, and compliance status
            </p>
          </div>
          <div className="flex items-center gap-3">
            {report && (
              <div className="text-right text-xs text-muted-foreground">
                <div>Last audit: {new Date(report.generatedAt).toLocaleString()}</div>
                <div>Platform: {report.platform}</div>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Shield className="h-3.5 w-3.5" /> Security Score
            </div>
            <div className={`text-2xl font-bold ${GRADE_COLORS[report?.grade ?? ""] || ""}`}>
              {report?.grade ?? "—"} <span className="text-base font-normal text-muted-foreground">({report?.overallScore ?? 0}/100)</span>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Ban className="h-3.5 w-3.5" /> PBAC Denials
            </div>
            <div className={`text-2xl font-bold ${(pbacDenies?.total ?? 0) > 0 ? "text-red-600" : "text-green-600"}`}>
              {pbacDenies?.total ?? 0}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Activity className="h-3.5 w-3.5" /> Anomaly Alerts
            </div>
            <div className={`text-2xl font-bold ${(anomalies?.total ?? 0) > 0 ? "text-orange-600" : "text-green-600"}`}>
              {anomalies?.total ?? 0}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Zap className="h-3.5 w-3.5" /> Total Threats
            </div>
            <div className={`text-2xl font-bold ${totalThreats > 0 ? "text-red-600" : "text-green-600"}`}>
              {totalThreats}
            </div>
          </Card>
        </div>

        {/* Section Score Cards */}
        {report && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="md:col-span-1 flex flex-col items-center justify-center p-6">
              <ScoreGauge score={report.overallScore} grade={report.grade} />
              <p className="text-sm text-muted-foreground mt-2 text-center">Overall Security Score</p>
            </Card>
            <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
              {report.sections.map((section: any) => (
                <Card key={section.name} className="p-3">
                  <div className="text-xs text-muted-foreground truncate">{section.name}</div>
                  <div className={`text-2xl font-bold ${GRADE_COLORS[section.grade] || ""}`}>
                    {section.grade}
                  </div>
                  <div className="text-sm text-muted-foreground">{section.score}/100</div>
                  <Progress value={section.score} className="h-1 mt-1" />
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="pbac">
          <TabsList className="grid w-full grid-cols-9">
            <TabsTrigger value="pbac" className="flex items-center gap-1.5">
              <Ban className="h-3.5 w-3.5" />
              PBAC Denials
              {(pbacDenies?.total ?? 0) > 0 && (
                <Badge className="ml-1 h-4 px-1 text-xs bg-red-500">{pbacDenies?.total}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="anomalies" className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Anomalies
              {(anomalies?.total ?? 0) > 0 && (
                <Badge className="ml-1 h-4 px-1 text-xs bg-orange-500">{anomalies?.total}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="siem">
              <Cpu className="h-3.5 w-3.5 mr-1" />
              SIEM
            </TabsTrigger>
            <TabsTrigger value="checks">Security Checks</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="recommendations">
              <FileText className="h-3.5 w-3.5 mr-1" />
              Fixes
            </TabsTrigger>
            <TabsTrigger value="secrets">Secrets</TabsTrigger>
            <TabsTrigger value="geoblock">Geo-Block</TabsTrigger>
            <TabsTrigger value="lockouts">Lockouts</TabsTrigger>
          </TabsList>

          {/* PBAC Denials Tab */}
          <TabsContent value="pbac" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Ban className="h-4 w-4 text-red-500" />
                  PBAC Policy Denials
                </CardTitle>
                <CardDescription>
                  Requests blocked by Policy-Based Access Control — {pbacDenies?.total ?? 0} events in buffer
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!pbacDenies?.events?.length ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p className="font-medium text-green-600">No PBAC denials recorded</p>
                    <p className="text-xs mt-1">All access requests are within policy bounds</p>
                  </div>
                ) : (
                  <div className="space-y-0 max-h-[480px] overflow-y-auto">
                    {pbacDenies.events.map((event: any, i: number) => (
                      <SiemEventRow key={i} event={event} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Anomaly Alerts Tab */}
          <TabsContent value="anomalies" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-orange-500" />
                  ML Anomaly Detector Alerts
                </CardTitle>
                <CardDescription>
                  ATO, credential stuffing, BEC, velocity anomalies, round-tripping — {anomalies?.total ?? 0} events
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!anomalies?.events?.length ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p className="font-medium text-green-600">No anomalies detected</p>
                    <p className="text-xs mt-1">Python Isolation Forest model reports normal behaviour</p>
                  </div>
                ) : (
                  <div className="space-y-0 max-h-[480px] overflow-y-auto">
                    {anomalies.events.map((event: any, i: number) => (
                      <SiemEventRow key={i} event={event} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SIEM Tab */}
          <TabsContent value="siem" className="mt-4 space-y-4">
            {/* Event type breakdown */}
            {siemAll?.byType && Object.keys(siemAll.byType).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Event Type Breakdown</CardTitle>
                  <CardDescription>{siemAll.total} total events in SIEM buffer</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(siemAll.byType).sort(([, a]: any, [, b]: any) => b - a).map(([type, count]: any) => (
                      <div key={type} className={`rounded-lg border p-2.5 text-xs ${EVENT_TYPE_COLORS[type] ?? "bg-slate-50 text-slate-700 border-slate-200"}`}>
                        <div className="font-mono font-semibold truncate">{type}</div>
                        <div className="text-lg font-bold mt-0.5">{count}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  All SIEM Events (newest first)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!siemAll?.events?.length ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p>No SIEM events in buffer</p>
                    <p className="text-xs mt-1">Events appear here as the platform processes requests</p>
                  </div>
                ) : (
                  <div className="space-y-0 max-h-[520px] overflow-y-auto">
                    {siemAll.events.map((event: any, i: number) => (
                      <SiemEventRow key={i} event={event} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Checks Tab */}
          <TabsContent value="checks" className="space-y-4 mt-4">
            {report?.sections.map((section: any) => (
              <Card key={section.name}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{section.name}</span>
                    <Badge variant="outline" className={GRADE_COLORS[section.grade]}>
                      Grade {section.grade} — {section.score}/100
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {section.checks.map((check: any) => (
                      <div key={check.name} className="flex items-start gap-3 py-1.5 border-b last:border-0">
                        {check.passed
                          ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                          : <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{check.name}</span>
                            <Badge
                              variant="outline"
                              className={`text-xs px-1.5 py-0 ${SEVERITY_COLORS[check.severity as keyof typeof SEVERITY_COLORS]}`}
                            >
                              {check.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{check.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {report?.complianceStatus && Object.entries(report.complianceStatus).map(([key, val]: [string, any]) => (
                <Card key={key} className={`border ${val.compliant ? "border-green-200 bg-green-50/50 dark:bg-green-950/10" : "border-orange-200 bg-orange-50/50 dark:bg-orange-950/10"}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span className="uppercase font-bold">{key.replace(/_/g, " ")}</span>
                      {val.compliant
                        ? <Badge className="bg-green-500">Compliant</Badge>
                        : <Badge variant="destructive">Partial</Badge>}
                    </CardTitle>
                    {val.level && <CardDescription>Level: {val.level}</CardDescription>}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{val.notes}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Recommendations Tab */}
          <TabsContent value="recommendations" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Security Recommendations
                </CardTitle>
                <CardDescription>Items requiring attention to improve the security posture</CardDescription>
              </CardHeader>
              <CardContent>
                {report?.sections.flatMap((s: any) =>
                  s.checks.filter((c: any) => !c.passed).map((c: any) => ({ section: s.name, ...c }))
                ).length === 0 ? (
                  <div className="text-center py-8 text-green-600">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
                    <p className="font-medium">All security checks passed!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {report?.sections.flatMap((s: any) =>
                      s.checks.filter((c: any) => !c.passed).map((c: any) => ({ section: s.name, ...c }))
                    ).map((rec: any, i: number) => (
                      <div key={i} className={`rounded-lg border p-3 ${SEVERITY_COLORS[rec.severity as keyof typeof SEVERITY_COLORS]}`}>
                        <div className="flex items-center gap-2 font-medium text-sm">
                          <Lock className="h-4 w-4" />
                          {rec.name}
                          <Badge variant="outline" className="ml-auto text-xs">{rec.severity}</Badge>
                        </div>
                        <p className="text-xs mt-1">{rec.description}</p>
                        <p className="text-xs mt-1 opacity-75">Section: {rec.section}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Secrets Rotation Tab */}
          <TabsContent value="secrets" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" />Secrets Rotation Status</CardTitle>
                <CardDescription>Credentials approaching or past their 90-day rotation deadline</CardDescription>
              </CardHeader>
              <CardContent>
                {secretsRotation ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 p-3 text-center">
                        <div className="text-2xl font-bold text-green-600">{secretsRotation.summary.ok}</div>
                        <div className="text-xs text-muted-foreground">OK</div>
                      </div>
                      <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 p-3 text-center">
                        <div className="text-2xl font-bold text-yellow-600">{secretsRotation.summary.warn}</div>
                        <div className="text-xs text-muted-foreground">Warn (76-90d)</div>
                      </div>
                      <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 p-3 text-center">
                        <div className="text-2xl font-bold text-red-600">{secretsRotation.summary.expired}</div>
                        <div className="text-xs text-muted-foreground">Expired (&gt;90d)</div>
                      </div>
                    </div>
                    {secretsRotation.secrets.map((s: any, i: number) => (
                      <div key={i} className={`flex items-center justify-between rounded-lg border p-3 ${
                        s.status === "expired" ? "border-red-200 bg-red-50 dark:bg-red-950/20" :
                        s.status === "warn" ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20" :
                        "border-green-200 bg-green-50 dark:bg-green-950/20"
                      }`}>
                        <div>
                          <div className="font-medium text-sm">{s.name}</div>
                          <div className="text-xs text-muted-foreground">{s.ageDays}d old · {s.expiresInDays > 0 ? `${s.expiresInDays}d until expiry` : "EXPIRED"}</div>
                        </div>
                        <Badge className={s.status === "expired" ? "bg-red-500" : s.status === "warn" ? "bg-yellow-500" : "bg-green-500"}>
                          {s.status.toUpperCase()}
                        </Badge>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground mt-2">Checked: {new Date(secretsRotation.checkedAt).toLocaleString()}</p>
                  </div>
                ) : <div className="text-muted-foreground text-sm">Loading...</div>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Geo-Block Tab */}
          <TabsContent value="geoblock" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Ban className="h-4 w-4" />Geo-Block Status</CardTitle>
                <CardDescription>OFAC SDN + FATF Blacklist — {geoBlockStatus?.totalBlocked ?? 0} countries blocked</CardDescription>
              </CardHeader>
              <CardContent>
                {geoBlockStatus ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {geoBlockStatus.blockedCountries.map((c: any) => (
                        <div key={c.code} className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-2 text-center">
                          <div className="font-bold text-sm text-red-700">{c.code}</div>
                          <div className="text-xs text-muted-foreground truncate">{c.name}</div>
                          <div className="text-xs text-red-500">{c.reason}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Source: {geoBlockStatus.feedSource}</p>
                  </div>
                ) : <div className="text-muted-foreground text-sm">Loading...</div>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* User Lockouts Tab */}
          <TabsContent value="lockouts" className="mt-4">
            <div className="space-y-4">
              {/* Lockout Trends Chart — v151 with date-range picker */}
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Lockout Trends (Last {trendDays} Days)</CardTitle>
                      <CardDescription>Daily lockout events and failed login attempts — a spike may indicate a credential-stuffing attack</CardDescription>
                    </div>
                    <div className="flex gap-1">
                      {([7, 30, 90, 365] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() => setTrendDays(d)}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            trendDays === d
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:border-primary"
                          }`}
                        >
                          {d === 365 ? "1Y" : `${d}D`}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {lockoutTrends && lockoutTrends.trends.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={lockoutTrends.trends} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d?.slice(5) ?? d} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip
                          formatter={(value: any, name: string) => [value, name === "lockouts" ? "Lockouts" : "Failed Attempts"]}
                          labelFormatter={(label) => `Date: ${label}`}
                        />
                        <Bar dataKey="lockouts" fill="#ef4444" name="lockouts" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="attempts" fill="#f97316" name="attempts" radius={[3, 3, 0, 0]} opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-8 text-green-600">
                      <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
                      <p className="font-medium">No lockout events in the last 30 days</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Active Lockouts Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />User Lockout Management</CardTitle>
                  <CardDescription>Accounts locked after 5 failed login attempts (30-minute lockout)</CardDescription>
                </CardHeader>
                <CardContent>
                  {userLockouts ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 mb-3">
                        <Badge variant="outline">{userLockouts.totalLockouts} total records</Badge>
                        <Badge className={userLockouts.activeLockouts > 0 ? "bg-red-500" : "bg-green-500"}>
                          {userLockouts.activeLockouts} active lockouts
                        </Badge>
                      </div>
                      {(userLockouts.lockouts ?? []).filter((l: any) => l.isLocked).length === 0 ? (
                        <div className="text-center py-8 text-green-600">
                          <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
                          <p className="font-medium">No active lockouts</p>
                        </div>
                      ) : (
                        (userLockouts.lockouts ?? []).filter((l: any) => l.isLocked).map((l: any, i: number) => (
                          <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <div className="text-sm font-medium">User #{l.userId}</div>
                              <div className="text-xs text-muted-foreground">{l.failedAttempts} failed attempts</div>
                              <div className="text-xs text-muted-foreground/60">
                                Locked: {l.lockedAt ? new Date(l.lockedAt).toLocaleString() : "—"}
                                {l.lockExpiresAt && ` · Expires: ${new Date(l.lockExpiresAt).toLocaleString()}`}
                              </div>
                            </div>
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => unlockUserMutation.mutate({ userId: l.userId })}>
                              Unlock
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  ) : <div className="text-muted-foreground text-sm">Loading...</div>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
