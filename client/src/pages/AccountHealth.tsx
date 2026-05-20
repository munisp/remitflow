import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, XCircle, Shield, CreditCard, User, Link } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';

export default function AccountHealth() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { data: health, isLoading } = trpc.accountHealth.score.useQuery();

  const score = health?.score ?? 0;
  const grade = health?.grade ?? "D";
  const tier = health?.tier ?? "poor";
  const factors = health?.factors ?? [];
  const recommendations = health?.recommendations ?? [];

  const gradeColor = { A: "text-emerald-500", B: "text-blue-500", C: "text-yellow-500", D: "text-red-500" }[grade] ?? "text-muted-foreground";
  const tierLabel = { excellent: "Excellent", good: "Good", fair: "Fair", poor: "Needs Improvement" }[tier] ?? tier;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />Account Health
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Your account completeness and security score</p>
        </div>

        {isLoading ? (
          <div className="h-40 bg-muted animate-pulse rounded-xl" />
        ) : (
          <Card className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white">
            <CardContent className="p-6 text-center">
              <div className={"text-7xl font-bold mb-1 " + gradeColor.replace("text-", "text-white")}>{score}</div>
              <div className="text-lg font-medium opacity-90 mb-1">Health Score — Grade {grade}</div>
              <Progress value={score} className="h-3 bg-white/20 [&>div]:bg-white mb-2" />
              <div className="text-sm opacity-80">{tierLabel}</div>
            </CardContent>
          </Card>
        )}

        {factors.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Score Breakdown</h2>
            {factors.map((f: any) => (
              <Card key={f.name}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{f.name}</span>
                    <span className="text-sm text-muted-foreground">{f.score}/{f.max}</span>
                  </div>
                  <Progress value={(f.score / f.max) * 100} className="h-1.5" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Recommendations</h2>
            {recommendations.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 border rounded-lg">
                <XCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm">{r.message}</p>
                  <Badge variant="outline" className="text-xs mt-1 capitalize">{r.priority}</Badge>
                </div>
                <Button size="sm" variant="outline" onClick={() => {
                  const routes: Record<string, string> = {
                    kyc: "/kyc", identity: "/kyc", verification: "/kyc",
                    transaction: "/transactions", activity: "/transactions",
                    beneficiary: "/beneficiaries", recipient: "/beneficiaries",
                    security: "/security", password: "/security", twofa: "/security",
                    profile: "/profile", account: "/profile",
                    wallet: "/wallet", balance: "/wallet",
                  };
                  const key = Object.keys(routes).find(k => r.type?.toLowerCase().includes(k));
                  if (key) setLocation(routes[key]);
                  else toast.info("Go to: " + r.type);
                }}>Fix</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
