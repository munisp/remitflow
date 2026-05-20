import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  QrCode, Link2, Copy, Share2, Clock, CheckCircle2, XCircle,
  Plus, Trash2, RefreshCw, DollarSign, ArrowDownLeft
} from "lucide-react";

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF"];

function QRCodeImage({ data }: { data: string }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
  return <img src={url} alt="QR Code" className="w-48 h-48 rounded-lg border" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pending", variant: "default" },
    paid: { label: "Paid", variant: "secondary" },
    expired: { label: "Expired", variant: "outline" },
    cancelled: { label: "Cancelled", variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

export default function RequestMoney() {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("48");
  const [createdRequest, setCreatedRequest] = useState<{ token: string; paymentLink: string; expiresAt: Date } | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const { data: requests = [], refetch } = trpc.requestMoney.list.useQuery({ limit: 20 });
  const requestArr = Array.isArray(requests) ? requests : [];

  const createMutation = trpc.requestMoney.create.useMutation({
    onSuccess: (data) => {
      setCreatedRequest(data as unknown as { token: string; paymentLink: string; expiresAt: Date });
      setShowDialog(true);
      refetch();
      toast.success("Payment request created!");
      setAmount(""); setDescription("");
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelMutation = trpc.requestMoney.cancel.useMutation({
    onSuccess: () => { refetch(); toast.success("Request cancelled"); },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    createMutation.mutate({
      amount: amount ? Number(amount) : undefined,
      currency,
      description: description || undefined,
      expiresInHours: Number(expiresInHours),
    });
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard!");
  };

  const shareLink = async (link: string) => {
    if (navigator.share) {
      await navigator.share({ title: "RemitFlow Payment Request", url: link });
    } else {
      copyLink(link);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <ArrowDownLeft className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Request Money</h1>
            <p className="text-muted-foreground text-sm">Generate a payment link or QR code to receive money</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Create Request Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Request</CardTitle>
              <CardDescription>Create a shareable payment request link</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Amount (optional)</Label>
                  <Input
                    type="number"
                    placeholder="Any amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="0.01"
                    step="0.01"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Description (optional)</Label>
                <Input
                  placeholder="What is this for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={256}
                />
              </div>

              <div className="space-y-1">
                <Label>Expires in</Label>
                <Select value={expiresInHours} onValueChange={setExpiresInHours}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 hour</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="48">48 hours</SelectItem>
                    <SelectItem value="72">3 days</SelectItem>
                    <SelectItem value="168">7 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
                Generate Payment Link
              </Button>
            </CardContent>
          </Card>

          {/* Recent Requests */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Recent Requests</CardTitle>
              <CardDescription>{requestArr.length} payment request{requestArr.length !== 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              {requestArr.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <QrCode className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No payment requests yet</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {requestArr.map((req: any) => {
                    const link = `${window.location.origin}/pay/${req.token}`;
                    return (
                      <div key={req.id} className="flex items-start justify-between p-3 rounded-lg border bg-muted/30">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={req.status} />
                            {req.amount && (
                              <span className="font-semibold text-sm">{Number(req.amount).toLocaleString()} {req.currency}</span>
                            )}
                          </div>
                          {req.description && <p className="text-xs text-muted-foreground truncate">{req.description}</p>}
                          <p className="text-xs text-muted-foreground">
                            {new Date(req.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          {req.status === "pending" && (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyLink(link)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shareLink(link)}>
                                <Share2 className="h-3 w-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => cancelMutation.mutate({ id: req.id })}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          {req.status === "paid" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          {req.status === "cancelled" && <XCircle className="h-4 w-4 text-destructive" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Success Dialog with QR Code */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Payment Request Created
              </DialogTitle>
            </DialogHeader>
            {createdRequest && (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <QRCodeImage data={createdRequest.paymentLink} />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Payment Link</Label>
                  <div className="flex items-center gap-2">
                    <Input value={createdRequest.paymentLink} readOnly className="text-xs font-mono" />
                    <Button size="icon" variant="outline" onClick={() => copyLink(createdRequest.paymentLink)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Expires: {new Date(createdRequest.expiresAt).toLocaleString()}
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => shareLink(createdRequest.paymentLink)}>
                    <Share2 className="h-4 w-4 mr-2" /> Share Link
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setShowDialog(false)}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
