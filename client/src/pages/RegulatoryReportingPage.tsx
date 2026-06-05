import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, Calendar, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

type ReportType = "CTR" | "SAR" | "FBAR" | "ANNUAL_AML";

const now = new Date();
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
const today = now.toISOString().split("T")[0];

export default function RegulatoryReportingPage() {
  const { t } = useTranslation();
  const [reportType, setReportType] = useState<ReportType>("CTR");
  const { data: ctrData } = trpc.v90.regulatoryReporting.getCTRReport.useQuery({ startDate: startOfMonth, endDate: today });
  const { data: sarData } = trpc.v90.regulatoryReporting.getSARReport.useQuery({ startDate: startOfMonth, endDate: today });
  const { data: calData } = trpc.v90.regulatoryReporting.getComplianceCalendar.useQuery();
  const generateMutation = trpc.v90.regulatoryReporting.generateReport.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.reportType} report generated: ${d.reportId}`);
      if (d.downloadUrl) window.open(d.downloadUrl, "_blank");
    },
    onError: () => toast.error("Report generation failed"),
  });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Regulatory Reporting</h1>
          <p className="text-muted-foreground text-sm">FinCEN CTR, SAR, FBAR, Annual AML — automated compliance filings</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["CTR", "SAR", "FBAR", "ANNUAL_AML"] as ReportType[]).map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => generateMutation.mutate({ reportType, startDate: startOfMonth, endDate: today, format: "pdf" })} disabled={generateMutation.isPending}>
            <FileText className="w-4 h-4 mr-2" />{generateMutation.isPending ? "Generating..." : "Generate Report"}
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-blue-600" />CTR Summary</CardTitle></CardHeader>
          <CardContent>
            {ctrData ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Total Reports</p><p className="text-xl font-bold">{ctrData.totalReports}</p></div>
                  <div className="p-3 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Pending Filing</p><p className="text-xl font-bold text-orange-600">{ctrData.pendingFiling}</p></div>
                  <div className="p-3 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Filed</p><p className="text-xl font-bold text-green-600">{ctrData.filed}</p></div>
                  <div className="p-3 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Total Amount</p><p className="text-xl font-bold">${(ctrData.totalAmountCovered / 1000).toFixed(0)}K</p></div>
                </div>
                <div className="space-y-2">
                  {ctrData.reports.slice(0, 3).map((r: any) => (
                    <div key={r.reportId} className="flex items-center justify-between text-sm p-2 border rounded">
                      <span className="font-mono text-xs">{r.reportId}</span>
                      <div className="flex items-center gap-2">
                        <span>${r.amount.toLocaleString()}</span>
                        <Badge className={r.status === "filed" ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}>{r.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-muted-foreground text-sm">Loading CTR data...</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-red-600" />SAR Summary</CardTitle></CardHeader>
          <CardContent>
            {sarData ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Total SARs</p><p className="text-xl font-bold">{sarData.totalReports}</p></div>
                  <div className="p-3 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-bold text-orange-600">{sarData.pendingFiling}</p></div>
                  <div className="p-3 bg-muted rounded-lg"><p className="text-xs text-muted-foreground">Filed</p><p className="text-xl font-bold text-green-600">{sarData.filed}</p></div>
                </div>
                <div className="space-y-2">
                  {sarData.reports.slice(0, 3).map((r: any) => (
                    <div key={r.reportId} className="flex items-center justify-between text-sm p-2 border rounded">
                      <div>
                        <span className="font-mono text-xs">{r.reportId}</span>
                        <p className="text-xs text-muted-foreground">{r.suspicionType}</p>
                      </div>
                      <Badge className={r.status === "filed" ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}>{r.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-muted-foreground text-sm">Loading SAR data...</p>}
          </CardContent>
        </Card>
      </div>

      {calData && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5" />Compliance Calendar</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {calData.upcomingDeadlines.map((d, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {d.daysRemaining <= 0 ? <CheckCircle className="w-5 h-5 text-green-600" /> : d.daysRemaining <= 7 ? <Clock className="w-5 h-5 text-orange-600" /> : <Calendar className="w-5 h-5 text-blue-600" />}
                    <div>
                      <p className="font-medium">{d.type} Filing</p>
                      <p className="text-sm text-muted-foreground">{d.description}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{d.deadline}</p>
                    <Badge className={d.daysRemaining <= 0 ? "bg-green-100 text-green-800" : d.daysRemaining <= 7 ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}>
                      {d.daysRemaining <= 0 ? "Filed" : `${d.daysRemaining}d remaining`}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {calData.regulatoryFrameworks.map(f => <Badge key={f} variant="outline">{f}</Badge>)}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Download className="w-5 h-5" />Quick Generate</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["CTR", "SAR", "FBAR", "ANNUAL_AML"] as ReportType[]).map(t => (
              <Button key={t} variant="outline" onClick={() => generateMutation.mutate({ reportType: t, startDate: startOfMonth, endDate: today, format: "pdf" })} disabled={generateMutation.isPending}>
                <FileText className="w-4 h-4 mr-2" />{t}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
