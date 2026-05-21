import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Shield, Search, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const RISK_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  low: { bg: "bg-green-500/10 border-green-500/30", text: "text-green-400", bar: "bg-green-500" },
  medium: { bg: "bg-yellow-500/10 border-yellow-500/30", text: "text-yellow-400", bar: "bg-yellow-500" },
  high: { bg: "bg-orange-500/10 border-orange-500/30", text: "text-orange-400", bar: "bg-orange-500" },
  critical: { bg: "bg-red-500/10 border-red-500/30", text: "text-red-400", bar: "bg-red-500" },
};

export default function ComplianceScoringPage() {
  const { t } = useTranslation();
  const [userId, setUserId] = useState("");
  const [queriedUserId, setQueriedUserId] = useState<number | null>(null);
  const [casesStatus, setCasesStatus] = useState("all");

  const scoreQuery = trpc.v89.complianceScoring.scoreUser.useQuery(
    { userId: queriedUserId! },
    { enabled: queriedUserId !== null }
  );

  const casesQuery = trpc.v89.complianceScoring.getComplianceCases.useQuery({
    status: casesStatus === "all" ? undefined : casesStatus as "open" | "under_review" | "resolved" | "escalated" | "dismissed",
    limit: 50, offset: 0,
  });

  const handleScore = () => {
    const id = parseInt(userId, 10);
    if (isNaN(id) || id <= 0) { toast.error("Enter a valid user ID"); return; }
    setQueriedUserId(id);
  };

  const score = scoreQuery.data;
  const riskStyle = score ? RISK_COLORS[score.riskLevel] ?? RISK_COLORS.medium : null;

  const CASE_STATUS_COLORS: Record<string, string> = {
    open: "bg-red-500/20 text-red-400",
    under_review: "bg-yellow-500/20 text-yellow-400",
    resolved: "bg-green-500/20 text-green-400",
    closed: "bg-gray-500/20 text-gray-400",
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Compliance Scoring Engine</h1>
        <p className="text-muted-foreground text-sm mt-1">Real-time risk scoring and compliance case management</p>
      </div>

      {/* Score User */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="w-5 h-5 text-purple-400" /> Score a User</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3 max-w-sm">
            <Input type="number" placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScore()} />
            <Button onClick={handleScore} disabled={scoreQuery.isFetching}>
              <Search className="w-4 h-4 mr-2" />
              {scoreQuery.isFetching ? "Scoring..." : "Score"}
            </Button>
          </div>

          {scoreQuery.isError && (
            <p className="mt-3 text-sm text-red-400">{scoreQuery.error.message}</p>
          )}

          {score && riskStyle && (
            <div className={`mt-6 p-5 rounded-xl border ${riskStyle.bg} space-y-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Risk Score for User #{score.userId}</p>
                  <p className={`text-4xl font-bold ${riskStyle.text}`}>{score.score}<span className="text-lg">/100</span></p>
                </div>
                <Badge className={`text-sm px-3 py-1 ${riskStyle.text} border ${riskStyle.bg}`}>
                  {score.riskLevel.toUpperCase()} RISK
                </Badge>
              </div>

              {/* Score bar */}
              <div className="w-full bg-muted rounded-full h-3">
                <div className={`h-3 rounded-full transition-all ${riskStyle.bar}`} style={{ width: `${score.score}%` }} />
              </div>

              {/* Factors */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">RISK FACTORS</Label>
                {score.factors.map((f: any) => (
                  <div key={f.factor} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{f.factor}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">{String(f.value)}</span>
                      <Badge className={f.contribution > 20 ? "bg-red-500/20 text-red-400" : f.contribution > 5 ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"}>
                        +{f.contribution}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div className={`p-3 rounded-lg bg-background/50 border ${riskStyle.bg}`}>
                <p className="text-sm font-medium text-foreground">Recommendation</p>
                <p className="text-sm text-muted-foreground mt-1">{score.recommendation}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compliance Cases */}
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Compliance Cases</CardTitle>
          <div className="flex gap-2">
            {["all", "open", "under_review", "resolved"].map((s) => (
              <button key={s} onClick={() => setCasesStatus(s)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${casesStatus === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-3 text-left">ID</th>
                  <th className="p-3 text-left">User</th>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Risk Level</th>
                  <th className="p-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {casesQuery.isPending ? (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : (casesQuery.data?.cases ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400 opacity-50" />
                    No compliance cases found
                  </td></tr>
                ) : (casesQuery.data?.cases ?? []).map((c: any) => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono text-xs text-muted-foreground">#{c.id}</td>
                    <td className="p-3 text-sm">User #{c.userId}</td>
                    <td className="p-3 text-sm capitalize">{c.caseType?.replace("_", " ")}</td>
                    <td className="p-3">
                      <Badge className={CASE_STATUS_COLORS[c.status ?? "open"] ?? "bg-gray-500/20 text-gray-400"}>
                        {c.status?.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge className={RISK_COLORS[c.riskLevel ?? "medium"]?.text ?? "text-yellow-400"}>
                        {c.riskLevel}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
