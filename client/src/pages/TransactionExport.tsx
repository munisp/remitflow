import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, FileText, Plus, Trash2, Clock } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const FORMAT_ICONS: Record<string, string> = {
  csv: "📊",
  json: "📋",
  pdf: "📄",
  xlsx: "📈",
};

export default function TransactionExport() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"csv" | "json" | "pdf" | "xlsx">("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [txType, setTxType] = useState("all");
  const [txStatus, setTxStatus] = useState("all");

  const { data: exports, refetch } = trpc.v98.exports.list.useQuery();
  const requestExport = trpc.v98.exports.request.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.recordCount} transactions exported`);
      if (data.csv) {
        const blob = new Blob([data.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      if (data.data) {
        const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `transactions-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setOpen(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteExport = trpc.v98.exports.delete.useMutation({
    onSuccess: () => { toast.success('Export deleted'); refetch(); },
  });

  const handleExport = () => {
    requestExport.mutate({
      format,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      type: txType !== "all" ? txType : undefined,
      status: txStatus !== "all" ? txStatus : undefined,
    });
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transaction Export</h1>
          <p className="text-muted-foreground text-sm mt-1">Export your transaction history in multiple formats</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Export
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Export Transactions</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label>Format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV — Spreadsheet compatible</SelectItem>
                    <SelectItem value="json">JSON — Developer friendly</SelectItem>
                    <SelectItem value="pdf">PDF — Print ready</SelectItem>
                    <SelectItem value="xlsx">XLSX — Excel format</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From Date</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <Label>To Date</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Transaction Type</Label>
                <Select value={txType} onValueChange={setTxType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="send">Send</SelectItem>
                    <SelectItem value="receive">Receive</SelectItem>
                    <SelectItem value="topup">Top-up</SelectItem>
                    <SelectItem value="withdrawal">Withdrawal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={txStatus} onValueChange={setTxStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={handleExport}
                disabled={requestExport.isPending}
              >
                <Download className="h-4 w-4 mr-2" />
                {requestExport.isPending ? "Exporting..." : "Export & Download"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Export History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Export History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!exports || exports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No exports yet. Click "New Export" to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {exports.map((exp: any) => (
                <div key={exp.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{FORMAT_ICONS[exp.format] ?? "📁"}</span>
                    <div>
                      <p className="font-medium text-sm">{exp.format.toUpperCase()} Export</p>
                      <p className="text-xs text-muted-foreground">
                        {exp.recordCount?.toLocaleString() ?? 0} records · {new Date(exp.requestedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={exp.status === "completed" ? "default" : exp.status === "failed" ? "destructive" : "secondary"}>
                      {exp.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteExport.mutate({ id: exp.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="font-medium">CSV Format</p>
              <p className="text-muted-foreground">Compatible with Excel, Google Sheets, and any spreadsheet app. Includes all transaction fields.</p>
            </div>
            <div>
              <p className="font-medium">JSON Format</p>
              <p className="text-muted-foreground">Full structured data for developers. Includes all fields including metadata and FX rates.</p>
            </div>
            <div>
              <p className="font-medium">Export Limits</p>
              <p className="text-muted-foreground">Up to 10,000 transactions per export. Exports expire after 7 days.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
