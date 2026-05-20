import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeftRight, DollarSign, TrendingUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

const DEFAULT_CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS"];

export default function SettlementNettingPage() {
  const [settlementDate, setSettlementDate] = useState(() => new Date().toISOString().split("T")[0]);

  const runNetting = trpc.v101.settlementNetting.runNetting.useMutation({
    onSuccess: (d) => {
      toast.success(`Netting Cycle Complete — ${d.positions?.length ?? 0} positions netted. Total: $${(d.totalNetted ?? 0).toLocaleString()}`);
    },
  });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settlement Netting Engine</h1>
          <p className="text-muted-foreground">Multilateral netting to reduce settlement obligations and liquidity requirements</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5" />Run Netting Cycle</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Settlement Date</Label>
            <Input type="date" value={settlementDate} onChange={e => setSettlementDate(e.target.value)} className="max-w-xs" />
          </div>
          <div>
            <Label>Currencies</Label>
            <p className="text-xs text-muted-foreground mb-2">Netting across: {DEFAULT_CURRENCIES.join(", ")}</p>
          </div>
          <Button onClick={() => runNetting.mutate({ currencies: DEFAULT_CURRENCIES, settlementDate })} disabled={runNetting.isPending}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {runNetting.isPending ? "Running Netting..." : "Run Netting Cycle"}
          </Button>
        </CardContent>
      </Card>

      {runNetting.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <ArrowLeftRight className="w-6 h-6 text-blue-500" />
                  <div>
                    <div className="text-xs text-muted-foreground">Positions Netted</div>
                    <div className="text-xl font-bold">{runNetting.data.positions?.length ?? 0}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <DollarSign className="w-6 h-6 text-green-500" />
                  <div>
                    <div className="text-xs text-muted-foreground">Total Netted</div>
                    <div className="text-xl font-bold">${(runNetting.data.totalNetted ?? 0).toLocaleString()}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-6 h-6 text-purple-500" />
                  <div>
                    <div className="text-xs text-muted-foreground">Settlement Date</div>
                    <div className="text-xl font-bold">{runNetting.data.settlementDate}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Netting Results by Currency</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Currency</TableHead>
                    <TableHead>Net Amount</TableHead>
                    <TableHead>Transaction Count</TableHead>
                    <TableHead>Direction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runNetting.data.positions ?? []).map((p) => (
                    <TableRow key={p.currency}>
                      <TableCell className="font-medium">{p.currency}</TableCell>
                      <TableCell className={p.netAmount >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {p.netAmount >= 0 ? "+" : ""}{p.netAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>{p.txCount}</TableCell>
                      <TableCell>
                        <Badge className={p.netAmount >= 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                          {p.netAmount >= 0 ? "Net Long" : "Net Short"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  

    </DashboardLayout>

  );
}
