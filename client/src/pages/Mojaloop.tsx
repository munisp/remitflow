import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Network, ArrowRightLeft, Users, Layers, Send, CheckCircle2, Clock, XCircle, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const STATUS_ICON: Record<string, any> = { COMMITTED: CheckCircle2, RESERVED: Clock, ABORTED: XCircle };
const STATUS_COLOR: Record<string, string> = { COMMITTED: "text-emerald-600", RESERVED: "text-yellow-600", ABORTED: "text-red-500" };
type SendStep = "form" | "confirm" | "result";

export default function Mojaloop() {
  const { t } = useTranslation();
  
  const { data: transfers, refetch: refetchTransfers } = trpc.mojaloop.transfers.useQuery();
  const { data: participants } = trpc.mojaloop.participants.useQuery();
  const { data: windows } = trpc.mojaloop.settlementWindows.useQuery();
  const [sendStep, setSendStep] = useState<SendStep>("form");
  const [quoteData, setQuoteData] = useState<any>(null);
  const [transferResult, setTransferResult] = useState<any>(null);
  const [form, setForm] = useState({ payerFspId: "FSP_KENYA", payeeFsp: "FSP_NIGERIA", payeeId: "", amount: "", currency: "KES", note: "" });

  const quoteMutation = trpc.mojaloop.quote.useMutation({
    onSuccess: (data) => { setQuoteData(data); setSendStep("confirm"); },
    onError: (e) => toast.error(`Quote failed: ${e.message}`),
  });
  const transferMutation = trpc.mojaloop.transfer.useMutation({
    onSuccess: (data) => { setTransferResult(data); setSendStep("result"); refetchTransfers(); },
    onError: (e) => toast.error(`Transfer failed: ${e.message}`),
  });

  const handleGetQuote = () => {
    if (!form.amount || !form.payeeFsp || !form.payeeId) { toast.error("Fill all required fields"); return; }
    quoteMutation.mutate({ payeeMsisdn: form.payeeId, payeeFspId: form.payeeFsp, amount: Number(form.amount), currency: form.currency, note: form.note || undefined });
  };
  const handleConfirm = () => {
    if (!quoteData) return;
    transferMutation.mutate({ payeeFsp: form.payeeFsp, payeeId: form.payeeId, amount: Number(form.amount), currency: form.currency, ilpPacket: quoteData.ilpPacket, condition: quoteData.condition, note: form.note || undefined });
  };
  const resetForm = () => { setSendStep("form"); setQuoteData(null); setTransferResult(null); setForm(f => ({ ...f, amount: "", payeeId: "", note: "" })); };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Network className="h-5 w-5 text-blue-600" /></div>
          <div><h1 className="text-2xl font-bold">Mojaloop Hub</h1><p className="text-muted-foreground text-sm">FSPIOP transfers, ILP packets, and settlement</p></div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Transfers", value: transfers?.length ?? 0, color: "text-blue-600" },
            { label: "Committed", value: (transfers ?? []).filter((t: any) => t.transferState === "COMMITTED").length, color: "text-emerald-600" },
            { label: "Participants", value: participants?.length ?? 0, color: "text-purple-600" },
            { label: "Open Windows", value: ((windows as any)?.history ?? []).filter((w: any) => w.state === "OPEN").length, color: "text-orange-600" },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{s.label}</div><div className={"text-2xl font-bold " + s.color}>{s.value}</div></CardContent></Card>
          ))}
        </div>

        <Tabs defaultValue="transfers">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="transfers">Transfers</TabsTrigger>
            <TabsTrigger value="participants">Participants</TabsTrigger>
            <TabsTrigger value="settlement">Settlement</TabsTrigger>
            <TabsTrigger value="initiate">Initiate</TabsTrigger>
          </TabsList>

          <TabsContent value="transfers" className="space-y-2 mt-4">
            {(transfers ?? []).map((t: any) => {
              const Icon = STATUS_ICON[t.transferState] ?? Clock;
              return (
                <Card key={t.transferId}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <Icon className={"h-5 w-5 " + (STATUS_COLOR[t.transferState] ?? "text-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-muted-foreground truncate">{t.transferId}</div>
                      <div className="text-sm font-medium">{t.payerFsp} → {t.payeeFsp}</div>
                      <div className="text-xs text-muted-foreground">{t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{t.currency} {Number(t.amount).toLocaleString()}</div>
                      <Badge variant="outline" className="text-xs">{t.transferState}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="participants" className="space-y-2 mt-4">
            {(participants ?? []).map((p: any) => (
              <Card key={p.fspId}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center font-bold text-purple-700 text-sm">{p.fspId?.slice(4, 6)}</div>
                  <div className="flex-1">
                    <div className="font-medium">{p.fspId}</div>
                    <div className="text-xs text-muted-foreground">{p.name} · {p.country}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{p.currency} {p.balance?.toLocaleString()}</div>
                    <Badge variant={p.isActive ? "default" : "secondary"} className="text-xs">{p.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="settlement" className="space-y-2 mt-4">
            {((windows as any)?.history ?? []).map((w: any) => (
              <Card key={w.settlementWindowId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium">Window #{w.settlementWindowId}</div>
                    <Badge variant={w.state === "OPEN" ? "default" : "secondary"} className="text-xs">{w.state}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div><div className="text-muted-foreground text-xs">Transfers</div><div className="font-semibold">{w.transferCount}</div></div>
                    <div><div className="text-muted-foreground text-xs">Volume</div><div className="font-semibold">{w.currency} {w.totalAmount?.toLocaleString()}</div></div>
                    <div><div className="text-muted-foreground text-xs">Opened</div><div className="font-semibold text-xs">{w.openedDate}</div></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="initiate" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Send via Mojaloop ILP</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {sendStep === "form" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label className="text-xs">Destination FSP</Label>
                        <Select value={form.payeeFsp} onValueChange={v => setForm(p => ({ ...p, payeeFsp: v }))}>
                          <SelectTrigger><SelectValue placeholder="Select FSP" /></SelectTrigger>
                          <SelectContent>{(participants ?? []).map((p: any) => <SelectItem key={p.fspId} value={p.fspId}>{p.name ?? p.fspId}</SelectItem>)}</SelectContent>
                        </Select></div>
                      <div className="space-y-1"><Label className="text-xs">Payee Phone / ID</Label>
                        <Input placeholder="+2348012345678" value={form.payeeId} onChange={e => setForm(p => ({ ...p, payeeId: e.target.value }))} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label className="text-xs">Amount</Label>
                        <Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
                      <div className="space-y-1"><Label className="text-xs">Currency</Label>
                        <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{["NGN","KES","GHS","ZAR","USD","EUR","GBP","XOF"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select></div>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Note (optional)</Label>
                      <Input placeholder="Payment note..." value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} /></div>
                    <Button className="w-full" onClick={handleGetQuote} disabled={quoteMutation.isPending}>
                      {quoteMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Getting Quote...</> : <><Search className="h-4 w-4 mr-2" />Get Quote</>}
                    </Button>
                  </>
                )}
                {sendStep === "confirm" && quoteData && (
                  <div className="space-y-4">
                    <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
                      <h3 className="font-semibold text-sm">Transfer Quote</h3>
                      <div className="grid grid-cols-2 gap-1 text-sm">
                        <span className="text-muted-foreground">Send</span><span className="font-medium text-right">{form.amount} {form.currency}</span>
                        <span className="text-muted-foreground">Fee</span><span className="font-medium text-right">{quoteData.transferAmount?.amount ?? "0.00"} {form.currency}</span>
                        <span className="text-muted-foreground">Payee Receives</span><span className="font-medium text-right text-green-600">{quoteData.payeeReceiveAmount?.amount ?? form.amount} {form.currency}</span>
                        <span className="text-muted-foreground">Destination FSP</span><span className="font-medium text-right">{form.payeeFsp}</span>
                      </div>
                      <Separator />
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-green-500" />ILP packet verified</div>
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" onClick={() => setSendStep("form")}>Back</Button>
                      <Button className="flex-1" onClick={handleConfirm} disabled={transferMutation.isPending}>
                        {transferMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Confirm & Send</>}
                      </Button>
                    </div>
                  </div>
                )}
                {sendStep === "result" && transferResult && (
                  <div className="space-y-4 text-center">
                    {transferResult.success ? <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" /> : <XCircle className="h-12 w-12 text-red-500 mx-auto" />}
                    <div>
                      <h3 className="font-semibold">{transferResult.success ? "Transfer Committed!" : "Transfer Failed"}</h3>
                      <p className="text-xs text-muted-foreground font-mono mt-1">{transferResult.transferId}</p>
                      <Badge className="mt-2" variant="outline">{transferResult.status}</Badge>
                    </div>
                    <Button className="w-full" onClick={resetForm}>New Transfer</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
