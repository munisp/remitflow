import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, TrendingDown } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

type Scenario = "mild" | "moderate" | "severe" | "extreme";

export default function LiquidityStressTestPage() {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState<Scenario>("moderate");

  const { data: history } = trpc.v101.liquidityStressTesting.getHistoricalScenarios.useQuery();
  const runScenario = trpc.v101.liquidityStressTesting.runScenario.useMutation({
    onSuccess: (d) => {
      if (d.passed) toast.success(`Stress test PASSED — Shock: ${d.shockFactor}`);
      else toast.error(`Stress test FAILED — Total shortfall: $${d.totalShortfall.toLocaleString()}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const scenarioColors: Record<Scenario, string> = {
    mild: "bg-green-100 text-green-800",
    moderate: "bg-yellow-100 text-yellow-800",
    severe: "bg-orange-100 text-orange-800",
    extreme: "bg-red-100 text-red-800",
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Liquidity Stress Testing</h1>
        <p className="text-muted-foreground">
          Simulate adverse market conditions to assess liquidity resilience and survival horizons
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Run Stress Scenario
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Scenario Severity</label>
              <Select value={scenario} onValueChange={(v) => setScenario(v as Scenario)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mild">Mild (5% shock)</SelectItem>
                  <SelectItem value="moderate">Moderate (15% shock)</SelectItem>
                  <SelectItem value="severe">Severe (30% shock)</SelectItem>
                  <SelectItem value="extreme">Extreme (50% shock)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => runScenario.mutate({ scenario })}
              disabled={runScenario.isPending}
            >
              <TrendingDown className="w-4 h-4 mr-2" />
              {runScenario.isPending ? "Running..." : "Run Scenario"}
            </Button>
          </div>

          {runScenario.data && (
            <div className="space-y-4 pt-2 border-t">
              <div className="flex items-center gap-3">
                {runScenario.data.passed ? (
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                )}
                <div>
                  <div className="font-semibold">
                    {runScenario.data.passed ? "PASSED" : "FAILED"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Shock Factor: {runScenario.data.shockFactor} | Total Shortfall: $
                    {runScenario.data.totalShortfall.toLocaleString()}
                  </div>
                </div>
                <Badge className={scenarioColors[runScenario.data.scenario as Scenario]}>
                  {runScenario.data.scenario}
                </Badge>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Currency</TableHead>
                    <TableHead>Current Balance</TableHead>
                    <TableHead>Stressed Balance</TableHead>
                    <TableHead>Shortfall</TableHead>
                    <TableHead>Survival Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runScenario.data.positions.map((p: any) => (
                    <TableRow key={p.currency}>
                      <TableCell className="font-medium">{p.currency}</TableCell>
                      <TableCell>${p.currentBalance.toLocaleString()}</TableCell>
                      <TableCell
                        className={
                          p.stressedBalance < p.currentBalance * 0.5
                            ? "text-red-600"
                            : "text-yellow-600"
                        }
                      >
                        ${p.stressedBalance.toLocaleString()}
                      </TableCell>
                      <TableCell
                        className={p.shortfall > 0 ? "text-red-600 font-medium" : "text-green-600"}
                      >
                        {p.shortfall > 0 ? `-$${p.shortfall.toLocaleString()}` : "None"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            p.survivalDays < 7
                              ? "bg-red-100 text-red-800"
                              : p.survivalDays < 30
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-green-100 text-green-800"
                          }
                        >
                          {p.survivalDays}d
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {history && (history as any[]).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historical Scenario Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Shortfall</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history as any[]).map((h, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge className={scenarioColors[h.scenario as Scenario]}>
                        {h.scenario}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {h.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                      )}
                    </TableCell>
                    <TableCell>${(h.totalShortfall ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {h.testedAt ? new Date(h.testedAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
