import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Download, ExternalLink, Search, Receipt, CheckCircle2, RefreshCw, FileText } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

export default function StripeReceipts() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null);

  const { data, isLoading, refetch } = trpc.stripeReceipts.list.useQuery({ limit: 50 });

  const pdfMut = trpc.receiptPdf.generate.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([result.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = result.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success('Receipt HTML downloaded — open in browser and print to PDF');
    },
    onError: (e) => toast.error(e.message),
  });

  const receipts = (data?.receipts ?? []).filter((r: any) =>
    search === "" ||
    r.productName?.toLowerCase().includes(search.toLowerCase()) ||
    r.stripeSessionId?.toLowerCase().includes(search.toLowerCase())
  );

  const totalSpend = receipts.reduce((sum: number, r: any) => sum + (r.amountTotal ?? 0) / 100, 0);

  const statusColor = (status: string) => {
    if (status === "paid") return "default";
    if (status === "refunded") return "secondary";
    return "destructive";
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="w-6 h-6 text-primary" />
            Payment Receipts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">All your Stripe payment history and receipts</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Receipts</p>
            <p className="text-2xl font-bold">{receipts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Spend</p>
            <p className="text-2xl font-bold">${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Paid</p>
            <p className="text-2xl font-bold text-green-600">
              {receipts.filter((r: any) => r.status === "paid").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search receipts..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading receipts...</div>
          ) : receipts.length === 0 ? (
            <div className="p-12 text-center">
              <CreditCard className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No payment receipts found.</p>
              <p className="text-sm text-muted-foreground mt-1">Payments made via Stripe will appear here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Session ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r: any) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedReceipt(r)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        <span className="font-medium">{r.productName ?? "RemitFlow Service"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {(r.amountTotal / 100).toLocaleString("en-US", { style: "currency", currency: (r.currency ?? "usd").toUpperCase() })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusColor(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(r.paidAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">
                      {r.stripeSessionId?.substring(0, 20)}...
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {r.receiptUrl && (
                          <Button size="sm" variant="ghost" onClick={() => window.open(r.receiptUrl, "_blank")}>
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" title="Download receipt as HTML" onClick={() => pdfMut.mutate({ receiptId: r.id })} disabled={pdfMut.isPending}>
                          <FileText className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Receipt Detail Dialog */}
      <Dialog open={!!selectedReceipt} onOpenChange={() => setSelectedReceipt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Receipt Details
            </DialogTitle>
          </DialogHeader>
          {selectedReceipt && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-4 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
                <p className="text-2xl font-bold">
                  {(selectedReceipt.amountTotal / 100).toLocaleString("en-US", { style: "currency", currency: (selectedReceipt.currency ?? "usd").toUpperCase() })}
                </p>
                <Badge variant={statusColor(selectedReceipt.status)} className="mt-1">{selectedReceipt.status}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Product</span>
                  <span className="font-medium">{selectedReceipt.productName ?? "RemitFlow Service"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span>{new Date(selectedReceipt.paidAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Session ID</span>
                  <span className="font-mono text-xs">{selectedReceipt.stripeSessionId?.substring(0, 24)}...</span>
                </div>
                {selectedReceipt.stripePaymentIntentId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment Intent</span>
                    <span className="font-mono text-xs">{selectedReceipt.stripePaymentIntentId?.substring(0, 24)}...</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={() => pdfMut.mutate({ receiptId: selectedReceipt.id })} disabled={pdfMut.isPending}>
                  <FileText className="w-4 h-4" /> Download Receipt
                </Button>
                {selectedReceipt.receiptUrl && (
                  <Button className="flex-1" onClick={() => window.open(selectedReceipt.receiptUrl, "_blank")}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View on Stripe
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
