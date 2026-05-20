import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, CheckCircle, AlertTriangle, Activity } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-green-500",
  "A": "text-green-400",
  "B": "text-yellow-500",
  "C": "text-red-500",
};

export default function SecurityScore() {
  const { data: score } = trpc.v98.platform.securityScore.useQuery();
  const { data: health } = trpc.v98.platform.fullHealthCheck.useQuery();

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Security Score</h1>
        <p className="text-muted-foreground text-sm mt-1">
          OWASP Top 10 + Custom compliance checks — RemitFlow v{score?.version ?? "98"}
        </p>
      </div>

      {/* Score Hero */}
      <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 border-green-200 dark:border-green-800">
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className={`text-6xl font-black ${GRADE_COLORS[score?.grade ?? "A+"] ?? "text-green-500"}`}>
                {score?.grade ?? "A+"}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Security Grade</p>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Overall Score</span>
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">{score?.score ?? 100}/100</span>
              </div>
              <Progress value={score?.score ?? 100} className="h-3" />
              <div className="flex items-center gap-4 mt-3 text-sm">
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  {score?.passed ?? 0} passed
                </span>
                <span className="flex items-center gap-1 text-red-500">
                  <AlertTriangle className="h-4 w-4" />
                  {(score?.total ?? 0) - (score?.passed ?? 0)} failed
                </span>
                <span className="text-muted-foreground">
                  Last checked: {score?.timestamp ? new Date(score.timestamp).toLocaleString() : "—"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* OWASP Checks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security Checks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(score?.checks ?? []).map((check) => (
              <div key={check.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/20 transition-colors">
                <div className={`mt-0.5 flex-shrink-0 ${check.status === "pass" ? "text-green-500" : "text-red-500"}`}>
                  {check.status === "pass" ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{check.id}</span>
                    <span className="font-medium text-sm">{check.name}</span>
                    <Badge
                      variant={check.status === "pass" ? "default" : "destructive"}
                      className="text-xs ml-auto"
                    >
                      {check.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Platform Health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Platform Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-3 h-3 rounded-full ${health?.status === "healthy" ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
            <span className="font-medium capitalize">{health?.status ?? "checking..."}</span>
            <span className="text-sm text-muted-foreground ml-auto">
              v{health?.version ?? "98.0.0"} · {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(health?.checks ?? {}).map(([name, check]) => (
              <div key={name} className="p-3 border rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium capitalize">{name}</span>
                  <span className={`w-2 h-2 rounded-full ${check.status === "ok" ? "bg-green-500" : check.status === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
                </div>
                <p className="text-xs text-muted-foreground capitalize">{check.status}</p>
                {check.latencyMs !== undefined && (
                  <p className="text-xs text-muted-foreground">{check.latencyMs}ms</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
