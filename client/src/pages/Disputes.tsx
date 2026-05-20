import React, { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Plus, Clock, CheckCircle, XCircle, MessageSquare, FileText } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-800 border-yellow-200",
  investigating: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-green-100 text-green-800 border-green-200",
  closed: "bg-gray-100 text-gray-800 border-gray-200",
  escalated: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_ICONS: Record<string, React.ReactElement> = {
  open: <Clock className="w-4 h-4" />,
  investigating: <AlertCircle className="w-4 h-4" />,
  resolved: <CheckCircle className="w-4 h-4" />,
  closed: <XCircle className="w-4 h-4" />,
  escalated: <AlertCircle className="w-4 h-4 text-red-500" />,
};

export default function Disputes() {
  const { t } = useTranslation();
  const { data: disputes = [], refetch, isLoading } = trpc.disputes.list.useQuery();
  const { data: txns = [] } = trpc.transactions.list.useQuery({ limit: 50 });
  const createMutation = trpc.disputes.create.useMutation({
    onSuccess: () => { toast.success("Dispute filed successfully"); refetch(); setOpen(false); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });
  const addCommentMutation = trpc.disputes.addComment.useMutation({
    onSuccess: () => { toast.success("Comment added"); refetch(); setCommentText(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<any>(null);
  const [commentText, setCommentText] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({ transactionId: "", type: "unauthorized_transaction", description: "", amount: "" });

  const resetForm = () => setForm({ transactionId: "", type: "unauthorized_transaction", description: "", amount: "" });

  const filtered = (Array.isArray(disputes) ? disputes : []).filter((d: any) => {
    const matchSearch = !search || d.reference?.toLowerCase().includes(search.toLowerCase()) || d.description?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: filtered.length,
    open: filtered.filter((d: any) => d.status === "open").length,
    resolved: filtered.filter((d: any) => d.status === "resolved").length,
    escalated: filtered.filter((d: any) => d.status === "escalated").length,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dispute Management</h1>
            <p className="text-muted-foreground">File and track transaction disputes</p>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> File Dispute
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total", value: stats.total, color: "text-foreground" },
            { label: "Open", value: stats.open, color: "text-yellow-600" },
            { label: "Resolved", value: stats.resolved, color: "text-green-600" },
            { label: "Escalated", value: stats.escalated, color: "text-red-600" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Input placeholder="Search disputes..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="investigating">Investigating</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Disputes List */}
        <div className="space-y-3">
          {isLoading && <p className="text-muted-foreground text-center py-8">Loading disputes...</p>}
          {!isLoading && filtered.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No disputes found</p>
                <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>File your first dispute</Button>
              </CardContent>
            </Card>
          )}
          {filtered.map((d: any) => (
            <Card key={d.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedDispute(d)}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{d.reference ?? `DSP-${d.id}`}</span>
                      <Badge className={`text-xs border ${STATUS_COLORS[d.status] ?? ""}`}>
                        <span className="flex items-center gap-1">{STATUS_ICONS[d.status]}{d.status}</span>
                      </Badge>
                      <Badge variant="outline" className="text-xs">{d.type?.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{d.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {d.createdAt ? format(new Date(d.createdAt), "MMM d, yyyy 'at' HH:mm") : ""}
                    </p>
                  </div>
                  {d.amount && (
                    <div className="text-right ml-4">
                      <p className="font-semibold">{d.currency ?? "NGN"} {Number(d.amount).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* File Dispute Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>File a Dispute</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Dispute Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unauthorized_transaction">Unauthorized Transaction</SelectItem>
                    <SelectItem value="incorrect_amount">Incorrect Amount</SelectItem>
                    <SelectItem value="duplicate_charge">Duplicate Charge</SelectItem>
                    <SelectItem value="service_not_received">Service Not Received</SelectItem>
                    <SelectItem value="fraud">Fraud</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Related Transaction (optional)</Label>
                <Select value={form.transactionId} onValueChange={v => setForm(f => ({ ...f, transactionId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select transaction" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Array.isArray(txns) ? txns : []).slice(0, 20).map((t: any) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.reference ?? `TXN-${t.id}`} — {t.fromCurrency} {Number(t.fromAmount).toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Disputed Amount (optional)</Label>
                <Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>Description *</Label>
                <Textarea rows={4} placeholder="Describe the issue in detail..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
                <Button
                  disabled={!form.description || createMutation.isPending}
                  onClick={() => createMutation.mutate({ type: form.type as any, description: form.description, transactionId: form.transactionId ? parseInt(form.transactionId) : undefined, amount: form.amount ? parseFloat(form.amount) : undefined })}
                >
                  {createMutation.isPending ? "Filing..." : "File Dispute"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Dispute Detail Dialog */}
        {selectedDispute && (
          <Dialog open={!!selectedDispute} onOpenChange={() => setSelectedDispute(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Dispute {selectedDispute.reference ?? `DSP-${selectedDispute.id}`}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Badge className={`border ${STATUS_COLORS[selectedDispute.status] ?? ""}`}>{selectedDispute.status}</Badge>
                  <Badge variant="outline">{selectedDispute.type?.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-sm">{selectedDispute.description}</p>
                {selectedDispute.amount && (
                  <p className="text-sm font-medium">Amount: {selectedDispute.currency ?? "NGN"} {Number(selectedDispute.amount).toLocaleString()}</p>
                )}
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2 flex items-center gap-1"><MessageSquare className="w-4 h-4" /> Add Comment</p>
                  <Textarea rows={3} placeholder="Add a comment or additional information..." value={commentText} onChange={e => setCommentText(e.target.value)} />
                  <Button size="sm" className="mt-2" disabled={!commentText || addCommentMutation.isPending}
                    onClick={() => addCommentMutation.mutate({ disputeId: selectedDispute.id, comment: commentText })}>
                    {addCommentMutation.isPending ? "Sending..." : "Send"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </DashboardLayout>
  );
}
