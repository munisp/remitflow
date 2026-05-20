import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Download, Plus, RefreshCw, CheckCircle2, Clock, AlertTriangle, Shield } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

const REPORT_TYPES = [
  { value: "SAR", label: "Suspicious Activity Report (SAR)" },
  { value: "CTR", label: "Currency Transaction Report (CTR)" },
  { value: "AML", label: "AML Compliance Summary" },
  { value: "KYC_AUDIT", label: "KYC Audit Report" },
  { value: "TRANSACTION_MONITORING", label: "Transaction Monitoring Report" },
  { value: "REGULATORY_CAPITAL", label: "Regulatory Capital Report" },
  { value: "OFAC_SCREENING", label: "OFAC Screening Report" },
];

export default function ComplianceReporting() {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<{ reportType: "SAR" | "CTR" | "AML" | "KYC_AUDIT" | "TRANSACTION_MONITORING" | "REGULATORY_CAPITAL" | "OFAC_SCREENING"; reportPeriod: string }>({ reportType: "AML", reportPeriod: "2025-Q4" });

  const { data, isLoading, refetch } = trpc.complianceReports.listReports.useQuery({ limit: 30 });

  const generateMutation = trpc.complianceReports.generateReport.useMutation({
    onSuccess: () => {
      toast.success("Compliance report generation started");
      setShowCreate(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const submitMutation = trpc.complianceReports.submitReport.useMutation({
    onSuccess: () => { toast.success("Report submitted to regulator"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const reports = data?.reports ?? [];

  const statusIcon = (status: string) => {
    if (status === "submitted") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "draft") return <Clock className="w-4 h-4 text-yellow-500" />;
    if (status === "generating") return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
    return <AlertTriangle className="w-4 h-4 text-red-500" />;
  };

  const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    if (status === "submitted") return "default";
    if (status === "draft") return "secondary";
    return "outline";
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Compliance Reporting
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Generate and submit regulatory compliance reports (SAR, CTR, AML, KYC)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Generate Report
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Reports", value: reports.length, icon: FileText, color: "text-blue-500" },
          { label: "Submitted", value: reports.filter((r: any) => r.status === "submitted").length, icon: CheckCircle2, color: "text-green-500" },
          { label: "Drafts", value: reports.filter((r: any) => r.status === "draft").length, icon: Clock, color: "text-yellow-500" },
          { label: "Flagged Txns", value: reports.reduce((sum: number, r: any) => sum + (r.flaggedTransactions ?? 0), 0), icon: AlertTriangle, color: "text-red-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${color}`} />
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
              <p className="text-2xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading reports...</div>
          ) : reports.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No compliance reports yet.</p>
              <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Generate First Report
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transactions</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Flagged</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {statusIcon(r.status)}
                        <span className="font-medium text-sm">{r.reportType}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.reportPeriod}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.totalTransactions?.toLocaleString() ?? "—"}</TableCell>
                    <TableCell>
                      {r.totalVolume ? `$${parseFloat(r.totalVolume).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.flaggedTransactions > 0 ? (
                        <span className="text-red-600 font-medium">{r.flaggedTransactions}</span>
                      ) : (
                        <span className="text-green-600">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {r.fileUrl && (
                          <Button size="sm" variant="ghost" onClick={() => window.open(r.fileUrl, "_blank")}>
                            <Download className="w-3 h-3" />
                          </Button>
                        )}
                        {r.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => submitMutation.mutate({ reportId: r.id })}>
                            Submit
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Generate Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Compliance Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Report Type</Label>
              <Select value={form.reportType} onValueChange={v => setForm(f => ({ ...f, reportType: v as "SAR" | "CTR" | "AML" | "KYC_AUDIT" | "TRANSACTION_MONITORING" | "REGULATORY_CAPITAL" | "OFAC_SCREENING" }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Report Period</Label>
              <Input
                className="mt-1"
                value={form.reportPeriod}
                onChange={e => setForm(f => ({ ...f, reportPeriod: e.target.value }))}
                placeholder="e.g. 2025-Q4, 2025-12, 2025"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => generateMutation.mutate(form)}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? "Generating..." : "Generate Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
