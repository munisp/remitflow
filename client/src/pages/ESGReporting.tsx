import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Leaf, BarChart2, Users, Globe, Plus, FileText } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  generating: "bg-blue-100 text-blue-700",
  draft: "bg-gray-100 text-gray-700",
  published: "bg-green-100 text-green-700",
};

export default function ESGReporting() {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [form, setForm] = useState({ periodStart: "", periodEnd: "" });
  const companyId = 1;

  const utils = trpc.useUtils();
  const { data: reports, isLoading } = trpc.esgReporting.list.useQuery({ companyId: 0 });

  // generate: { companyId, periodStart, periodEnd }
  const generateReport = trpc.esgReporting.generate.useMutation({
    onSuccess: () => {
      toast("ESG report generated", { description: "Your ESG report is ready. Review the metrics below." });
      utils.esgReporting.list.invalidate();
      setGenerateOpen(false);
      setForm({ periodStart: "", periodEnd: "" });
    },
    onError: (e) => toast.error("Generation failed", { description: e.message }),
  });

  const latestReport = (reports as any[])?.[0];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ESG Reporting</h1>
          <p className="text-muted-foreground text-sm mt-1">Environmental, Social & Governance metrics — GRI-aligned sustainability reporting</p>
        </div>
        <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Generate Report</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Generate ESG Report</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <Label className="text-xs">Period Start</Label>
                <Input type="date" value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Period End</Label>
                <Input type="date" value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-950 rounded-lg p-3 mt-3 text-xs text-green-700 dark:text-green-300">
              <strong>Auto-computed metrics:</strong> Carbon footprint, remittance volume, employee count, gender diversity, governance score, and SDG alignment are derived from your transaction and payroll data.
            </div>
            <Button className="w-full mt-4"
              onClick={() => generateReport.mutate({ companyId, periodStart: form.periodStart, periodEnd: form.periodEnd })}
              disabled={generateReport.isPending || !form.periodStart || !form.periodEnd}>
              {generateReport.isPending ? "Generating..." : "Generate Report"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Latest Report Summary */}
      {latestReport && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Carbon Footprint", value: `${Number(latestReport.carbonFootprintTons ?? 0).toFixed(2)} tCO₂e`, icon: Leaf, color: "text-green-600" },
            { label: "Remittance Volume", value: `$${Number(latestReport.totalRemittanceUsd ?? 0).toLocaleString()}`, icon: Globe, color: "text-blue-600" },
            { label: "Employees Supported", value: String(latestReport.employeesSupported ?? 0), icon: Users, color: "text-purple-600" },
            { label: "ESG Score", value: `${Number(latestReport.esgScore ?? 0).toFixed(0)}/100`, icon: BarChart2, color: "text-emerald-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted"><Icon className={`w-5 h-5 ${color}`} /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detailed Metrics */}
      {latestReport && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Leaf className="w-4 h-4 text-green-600" />Environmental</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Carbon Footprint</span><span className="font-medium">{Number(latestReport.carbonFootprintTons ?? 0).toFixed(2)} tCO₂e</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Digital Transactions</span><span className="font-medium">{Number(latestReport.digitalTransactionCount ?? 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paper Reduction</span><span className="font-medium">{Number(latestReport.paperReductionPct ?? 0).toFixed(1)}%</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-blue-600" />Social</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Remittance Recipients</span><span className="font-medium">{Number(latestReport.remittanceRecipients ?? 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Employees Supported</span><span className="font-medium">{Number(latestReport.employeesSupported ?? 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Countries Reached</span><span className="font-medium">{Number(latestReport.countriesReached ?? 0)}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart2 className="w-4 h-4 text-purple-600" />Governance</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Governance Score</span><span className="font-medium">{Number(latestReport.governanceScore ?? 0).toFixed(0)}/100</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Compliance Rate</span><span className="font-medium">{Number(latestReport.complianceRatePct ?? 0).toFixed(1)}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">AML Checks</span><span className="font-medium">{Number(latestReport.amlChecksCount ?? 0).toLocaleString()}</span></div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Report History */}
      <Card>
        <CardHeader><CardTitle className="text-base">Report History</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
          ) : !(reports as any[])?.length ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No ESG reports yet. Generate your first report to track sustainability metrics.</p>
            </div>
          ) : (
            <div className="divide-y">
              {(reports as any[])?.map((report: any) => (
                <div key={report.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {report.periodStart ? new Date(report.periodStart).toLocaleDateString() : "—"} — {report.periodEnd ? new Date(report.periodEnd).toLocaleDateString() : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ESG Score: {Number(report.esgScore ?? 0).toFixed(0)}/100 · Carbon: {Number(report.carbonFootprintTons ?? 0).toFixed(2)} tCO₂e
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(report.createdAt).toLocaleDateString()}</p>
                  <Badge className={`text-xs ${STATUS_COLORS[report.status] ?? ""}`}>{report.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
