import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Plus, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-gray-100 text-gray-800",
};
const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-orange-100 text-orange-800",
  low: "bg-gray-100 text-gray-800",
};

export default function DisputeManagementPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<any>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    transactionId: "",
    reason: "unauthorized" as any,
    description: "",
    requestedResolution: "investigation" as any,
  });

  const { data, refetch } = trpc.v90.disputeManagement.listDisputes.useQuery({ status: statusFilter });
  const createMutation = trpc.v90.disputeManagement.createDispute.useMutation({
    onSuccess: (d) => { toast.success(`Dispute ${d.disputeId} filed`); setOpen(false); refetch(); },
    onError: () => toast.error("Failed to file dispute"),
  });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dispute Management</h1>
          <p className="text-muted-foreground text-sm">Manage transaction disputes and chargebacks</p>
        </div>
        <div className="flex gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["all","open","in_review","resolved","closed"].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g," ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />File Dispute</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>File a Dispute</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Transaction ID</label>
                  <Input value={form.transactionId} onChange={e => setForm(f => ({...f, transactionId: e.target.value}))} placeholder="TXN-XXXXXXXX" />
                </div>
                <div>
                  <label className="text-sm font-medium">Reason</label>
                  <Select value={form.reason} onValueChange={v => setForm(f => ({...f, reason: v as any}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["unauthorized","duplicate","not_received","wrong_amount","fraud","other"].map(r => (
                        <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g," ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} rows={3} placeholder="Describe the issue in detail..." />
                </div>
                <div>
                  <label className="text-sm font-medium">Requested Resolution</label>
                  <Select value={form.requestedResolution} onValueChange={v => setForm(f => ({...f, requestedResolution: v as any}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["refund","investigation","chargeback"].map(r => (
                        <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={() => createMutation.mutate(form)}
                  disabled={createMutation.isPending || !form.transactionId || !form.description}
                >
                  Submit Dispute
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-3">
        {data?.disputes.map(d => (
          <Card key={d.disputeId}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold">{d.disputeId}</span>
                    <Badge className={STATUS_COLORS[d.status] ?? ""}>{d.status}</Badge>
                    <Badge className={PRIORITY_COLORS[d.priority] ?? ""}>{d.priority}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Transaction: {d.transactionId}</p>
                  <p className="text-sm capitalize mt-1">Reason: {String(d.reason).replace(/_/g," ")}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">${d.amount?.toLocaleString()} {d.currency}</p>
                  <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</p>
                  {d.resolvedAt && (
                    <p className="text-xs text-green-600 flex items-center gap-1 justify-end mt-1">
                      <CheckCircle className="w-3 h-3" />Resolved
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {data?.disputes.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No disputes found</p>
          </div>
        )}
      </div>
    </div>
  

    </DashboardLayout>

  );
}
