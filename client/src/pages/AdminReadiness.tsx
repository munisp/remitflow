import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Rocket, ExternalLink, ChevronRight } from "lucide-react";
import { useTranslation } from 'react-i18next';

const statusIcon = (status: "pass" | "warn" | "fail") => {
  if (status === "pass") return <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
};

const statusBadge = (status: "pass" | "warn" | "fail") => {
  if (status === "pass") return <Badge className="text-xs bg-emerald-100 text-emerald-700 border-0">Pass</Badge>;
  if (status === "warn") return <Badge className="text-xs bg-amber-100 text-amber-700 border-0">Warning</Badge>;
  return <Badge className="text-xs bg-red-100 text-red-700 border-0">Fail</Badge>;
};

export default function AdminReadiness() {
  const { t } = useTranslation();
  const { data, isLoading, refetch, isFetching } = trpc.admin.readinessCheck.useQuery(undefined, {
    refetchInterval: false,
  });

  const score = data?.score ?? 0;
  const scoreColor = score >= 90 ? "text-emerald-600" : score >= 70 ? "text-amber-600" : "text-red-600";
  const progressColor = score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-amber-500" : "bg-red-500";

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="w-6 h-6 text-violet-600" />
              Production Readiness
            </h1>
            <p className="text-muted-foreground mt-1">
              Review all system checks before publishing your platform to the world.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Re-check
          </Button>
        </div>

        {/* Score card */}
        {data && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-6">
                <div className="text-center shrink-0">
                  <div className={`text-5xl font-bold ${scoreColor}`}>{score}</div>
                  <div className="text-xs text-muted-foreground mt-1">/ 100</div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Readiness Score</span>
                    <span className="text-muted-foreground">{data.passed}/{data.total} checks passed</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${progressColor}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {score >= 90
                      ? "✅ Platform is production-ready. Click Publish to go live."
                      : score >= 70
                      ? "⚠️ Some warnings need attention before going live."
                      : "❌ Critical issues must be resolved before publishing."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Checks</CardTitle>
            <CardDescription>All checks must pass or be acknowledged before publishing.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 bg-muted/50 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {data?.checks.map((check) => (
                  <div
                    key={check.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      check.status === "pass"
                        ? "bg-emerald-50/50 border-emerald-100 dark:bg-emerald-950/10 dark:border-emerald-900"
                        : check.status === "warn"
                        ? "bg-amber-50/50 border-amber-100 dark:bg-amber-950/10 dark:border-amber-900"
                        : "bg-red-50/50 border-red-100 dark:bg-red-950/10 dark:border-red-900"
                    }`}
                  >
                    {statusIcon(check.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{check.label}</span>
                        {statusBadge(check.status)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                      {check.fix && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                          <ChevronRight className="w-3 h-3" />
                          Fix: {check.fix}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Publish guidance */}
        <Card className="border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <Rocket className="w-5 h-5 text-violet-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-violet-800 dark:text-violet-300 text-sm">Ready to publish?</p>
                <p className="text-xs text-violet-700 dark:text-violet-400 mt-0.5">
                  Click the <strong>Publish</strong> button in the top-right corner of the Management UI. Your platform will be deployed to your Manus domain with SSL, CDN, and auto-scaling included. No server configuration required.
                </p>
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-violet-300 text-violet-700 hover:bg-violet-100"
                    onClick={() => window.open("https://manus.im/docs/deployment", "_blank")}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Deployment Docs
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
