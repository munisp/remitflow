import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, CheckCircle2, AlertTriangle, Clock, FileText, Download } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function FCACompliance() {
  const { t } = useTranslation();
  
  const { data: report, isLoading, isError } = trpc.compliance.fca.useQuery();

  const checks = [
    { label: "AML Policy", status: "compliant", lastReview: "Jan 2024", nextReview: "Jan 2025" },
    { label: "CTF Procedures", status: "compliant", lastReview: "Jan 2024", nextReview: "Jan 2025" },
    { label: "Customer Due Diligence", status: "compliant", lastReview: "Feb 2024", nextReview: "Feb 2025" },
    { label: "Transaction Monitoring", status: "review_needed", lastReview: "Nov 2023", nextReview: "Overdue" },
    { label: "Suspicious Activity Reporting", status: "compliant", lastReview: "Mar 2024", nextReview: "Mar 2025" },
    { label: "Record Keeping", status: "compliant", lastReview: "Mar 2024", nextReview: "Mar 2025" },
    { label: "Staff Training", status: "in_progress", lastReview: "Dec 2023", nextReview: "Jun 2024" },
    { label: "Senior Manager Accountability", status: "compliant", lastReview: "Jan 2024", nextReview: "Jan 2025" },
  ];

  const compliantCount = checks.filter(c => c.status === "compliant").length;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Shield className="h-5 w-5 text-blue-600" /></div>
            <div><h1 className="text-2xl font-bold">FCA Compliance</h1><p className="text-muted-foreground text-sm">UK Financial Conduct Authority regulatory compliance</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            const rows = checks.map(c => [c.label, c.status, c.lastReview, c.nextReview].join(","));
            const csv = ["Requirement,Status,Last Review,Next Review", ...rows].join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `fca-compliance-${new Date().toISOString().split("T")[0]}.csv`;
            a.click(); URL.revokeObjectURL(url);
            toast.success("FCA compliance report downloaded");
          }}><Download className="h-4 w-4 mr-1" />Export Report</Button>
        </div>

        <Card className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-medium opacity-80">Overall Compliance Score</div>
              <Badge className="bg-white/20 text-white border-0">FCA Registered</Badge>
            </div>
            <div className="text-5xl font-bold mb-2">{Math.round((compliantCount / checks.length) * 100)}%</div>
            <Progress value={(compliantCount / checks.length) * 100} className="h-2 bg-white/20 [&>div]:bg-white" />
            <div className="text-sm opacity-80 mt-2">{compliantCount} of {checks.length} requirements met</div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Compliant", value: compliantCount, color: "text-emerald-600" },
            { label: "In Progress", value: checks.filter(c => c.status === "in_progress").length, color: "text-blue-600" },
            { label: "Review Needed", value: checks.filter(c => c.status === "review_needed").length, color: "text-red-600" },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 text-center"><div className={"text-2xl font-bold " + s.color}>{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Compliance Checklist</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {checks.map(c => {
              const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
                compliant: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, label: "Compliant" },
                in_progress: { color: "bg-blue-100 text-blue-700", icon: Clock, label: "In Progress" },
                review_needed: { color: "bg-red-100 text-red-700", icon: AlertTriangle, label: "Review Needed" },
              };
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.compliant;
              const Icon = cfg.icon;
              return (
                <div key={c.label} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Icon className={"h-4 w-4 " + (c.status === "compliant" ? "text-emerald-500" : c.status === "in_progress" ? "text-blue-500" : "text-red-500")} />
                    <div>
                      <div className="text-sm font-medium">{c.label}</div>
                      <div className="text-xs text-muted-foreground">Last review: {c.lastReview} · Next: {c.nextReview}</div>
                    </div>
                  </div>
                  <Badge className={"text-xs border-0 " + cfg.color}>{cfg.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
