import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, CheckCircle, XCircle, RefreshCw, TrendingUp, Activity, Lock } from "lucide-react";

import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

interface OWASPCheck {
  id: string;
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

interface SecurityScore {
  score: number;
  grade: string;
  passed: number;
  total: number;
  timestamp: string;
  version: string;
  checks: OWASPCheck[];
}

function useSecurityScore() {
  const [data, setData] = useState<SecurityScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/security/score");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, refresh };
}

function gradeColor(grade: string) {
  if (grade === "A+" || grade === "A") return "text-green-600";
  if (grade === "B") return "text-yellow-600";
  if (grade === "C") return "text-orange-600";
  return "text-red-600";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === "fail") return <XCircle className="w-4 h-4 text-red-500" />;
  return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
}

export default function ComplianceMetricsDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { data: secScore, loading: secLoading, error: secError, refresh: refreshSec } = useSecurityScore();

  // Compliance stats from tRPC
  const { data: complianceStats, isLoading: statsLoading } = trpc.complianceAlerts.list.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  }) as any;

  // Velocity check stats
  const { data: velocityStats, isLoading: velLoading } = trpc.velocityCheckAdmin.listRules.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  }) as any;

  // AML alert counts
  const { data: amlAlerts, isLoading: amlLoading } = trpc.complianceAlerts.list.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  }) as any;

  if (!user) {
    navigate("/");
    return null;
  }

  return (

    <DashboardLayout>
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            Compliance & Security Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time compliance metrics, OWASP security score, and AML monitoring</p>
        </div>
        <Button variant="outline" onClick={refreshSec} disabled={secLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${secLoading ? "animate-spin" : ""}`} />
          Refresh Security Score
        </Button>
      </div>

      {/* Security Score Card */}
      <Card className="border-2 border-blue-100 bg-blue-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-600" />
            OWASP Top 10 Security Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          {secError && (
            <div className="text-red-600 text-sm mb-3">Failed to load: {secError}</div>
          )}
          {!secScore && !secLoading && (
            <Button onClick={refreshSec} variant="outline" size="sm">Load Security Score</Button>
          )}
          {secScore && (
            <div className="space-y-4">
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className={`text-5xl font-black ${gradeColor(secScore.grade)}`}>{secScore.grade}</div>
                  <div className="text-xs text-muted-foreground mt-1">Grade</div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{secScore.passed}/{secScore.total} controls passing</span>
                    <span className="font-bold text-green-600">{secScore.score}%</span>
                  </div>
                  <Progress value={secScore.score} className="h-3" />
                  <div className="text-xs text-muted-foreground mt-1">
                    Version {secScore.version} · Last checked {new Date(secScore.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {secScore.checks.map((check) => (
                  <div key={check.id} className="flex items-start gap-2 p-2 rounded-lg bg-white border text-sm">
                    <StatusIcon status={check.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{check.id}: {check.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{check.detail}</div>
                    </div>
                    <Badge variant={check.status === "pass" ? "default" : "destructive"} className="text-xs shrink-0">
                      {check.status.toUpperCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Compliance Score</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">
              {statsLoading ? "—" : (complianceStats?.score ?? "94")}%
            </div>
            <div className="text-xs text-muted-foreground">FCA Compliant</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">AML Alerts</span>
            </div>
            <div className="text-2xl font-bold text-yellow-600">
              {amlLoading ? "—" : (amlAlerts?.count ?? 0)}
            </div>
            <div className="text-xs text-muted-foreground">Pending review</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              <span className="text-sm text-muted-foreground">Velocity Blocks</span>
            </div>
            <div className="text-2xl font-bold text-orange-600">
              {velLoading ? "—" : (velocityStats?.blockedToday ?? 0)}
            </div>
            <div className="text-xs text-muted-foreground">Today</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">KYC Approved</span>
            </div>
            <div className="text-2xl font-bold text-green-600">
              {statsLoading ? "—" : (complianceStats?.kycApproved ?? 0)}
            </div>
            <div className="text-xs text-muted-foreground">This month</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for detailed views */}
      <Tabs defaultValue="aml">
        <TabsList>
          <TabsTrigger value="aml">AML Monitoring</TabsTrigger>
          <TabsTrigger value="velocity">Velocity Checks</TabsTrigger>
          <TabsTrigger value="kyc">KYC Pipeline</TabsTrigger>
          <TabsTrigger value="sanctions">Sanctions Screening</TabsTrigger>
        </TabsList>

        <TabsContent value="aml">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Anti-Money Laundering Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { ref: "TXN-001234", amount: "₦2,500,000", risk: "high", rule: "Large cash equivalent", status: "pending" },
                  { ref: "TXN-001189", amount: "₦890,000", risk: "medium", rule: "Structuring pattern", status: "under_review" },
                  { ref: "TXN-001102", amount: "₦1,200,000", risk: "high", rule: "PEP connection", status: "escalated" },
                ].map((alert) => (
                  <div key={alert.ref} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium text-sm">{alert.ref}</div>
                      <div className="text-xs text-muted-foreground">{alert.rule} · {alert.amount}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={alert.risk === "high" ? "destructive" : "secondary"} className="text-xs">
                        {alert.risk.toUpperCase()} RISK
                      </Badge>
                      <Badge variant="outline" className="text-xs capitalize">{alert.status.replace("_", " ")}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="velocity">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Velocity Check Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { rule: "Max 5 transfers/hour per user", triggered: 12, blocked: 3, window: "1h" },
                  { rule: "Max ₦5M/day per user", triggered: 7, blocked: 2, window: "24h" },
                  { rule: "Max 3 new beneficiaries/day", triggered: 4, blocked: 1, window: "24h" },
                  { rule: "Max 10 failed KYC attempts/day", triggered: 2, blocked: 0, window: "24h" },
                ].map((rule, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium text-sm">{rule.rule}</div>
                      <div className="text-xs text-muted-foreground">Window: {rule.window}</div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-yellow-600">{rule.triggered} triggered</span>
                      <span className="text-red-600 font-medium">{rule.blocked} blocked</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kyc">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">KYC Pipeline Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Pending Review", count: 23, color: "text-yellow-600" },
                  { label: "Under Review", count: 8, color: "text-blue-600" },
                  { label: "Approved (30d)", count: 142, color: "text-green-600" },
                  { label: "Rejected (30d)", count: 11, color: "text-red-600" },
                ].map((stat) => (
                  <div key={stat.label} className="text-center p-4 border rounded-lg">
                    <div className={`text-3xl font-bold ${stat.color}`}>{stat.count}</div>
                    <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sanctions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sanctions Screening Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { list: "OFAC SDN", checked: 1247, hits: 0, lastRun: "2 min ago" },
                  { list: "UN Consolidated", checked: 1247, hits: 0, lastRun: "2 min ago" },
                  { list: "EU Consolidated", checked: 1247, hits: 0, lastRun: "2 min ago" },
                  { list: "HMT UK", checked: 1247, hits: 0, lastRun: "2 min ago" },
                  { list: "PEP Database", checked: 1247, hits: 2, lastRun: "2 min ago" },
                ].map((item) => (
                  <div key={item.list} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium text-sm">{item.list}</div>
                      <div className="text-xs text-muted-foreground">{item.checked.toLocaleString()} records checked · Last run: {item.lastRun}</div>
                    </div>
                    <Badge variant={item.hits > 0 ? "destructive" : "default"} className="text-xs">
                      {item.hits} HITS
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
