import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Copy, Plus, Trash2, Code2, Webhook, Eye, EyeOff, CheckCircle, Globe } from "lucide-react";
import { toast } from "sonner";

const EVENTS = [
  "payment.completed","payment.failed","transfer.initiated","transfer.completed",
  "kyc.approved","kyc.rejected","refund.processed",
];

export default function CheckoutSDK() {
    const [showSecret, setShowSecret] = useState(false);
  const [showTestSecret, setShowTestSecret] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["payment.completed"]);

  const { data: keysData } = trpc.checkout.apiKeys.useQuery();
  const { data: webhooks, refetch: refetchWebhooks } = trpc.checkout.webhooks.useQuery();
  const addWebhook = trpc.checkout.addWebhook.useMutation({
    onSuccess: () => { toast.success("Webhook endpoint added"); setWebhookOpen(false); setWebhookUrl(""); refetchWebhooks(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteWebhook = trpc.checkout.deleteWebhook.useMutation({
    onSuccess: () => { toast.success("Webhook endpoint removed"); refetchWebhooks(); },
    onError: (e: any) => toast.error(e.message),
  });

  const keys = keysData as any;

  function copy(val: string, label: string) {
    navigator.clipboard.writeText(val);
    toast.success(`${label} copied to clipboard`);
  }

  function toggleEvent(e: string) {
    setSelectedEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  }

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Code2 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Checkout SDK & API</h1>
            <p className="text-muted-foreground text-sm">Manage API keys, webhooks, and integrate RemitFlow payments</p>
          </div>
        </div>

        <Tabs defaultValue="keys">
          <TabsList className="grid grid-cols-3 w-full max-w-md">
            <TabsTrigger value="keys">API Keys</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="docs">Docs</TabsTrigger>
          </TabsList>

          {/* API Keys Tab */}
          <TabsContent value="keys" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge className="text-xs">Live</Badge>Production Keys
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Publishable Key</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">{keys?.publicKey ?? "pk_live_..."}</code>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copy(keys?.publicKey ?? "", "Public key")}><Copy className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Secret Key</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                        {showSecret ? (keys?.secretKey ?? "sk_live_...") : "sk_live_***hidden***"}
                      </code>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setShowSecret(p => !p)}>
                        {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copy(keys?.secretKey ?? "", "Secret key")}><Copy className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Webhook Secret</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">{keys?.webhookSecret ?? "whsec_..."}</code>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copy(keys?.webhookSecret ?? "", "Webhook secret")}><Copy className="h-3 w-3" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Test</Badge>Sandbox Keys
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Test Publishable Key</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">{keys?.testPublicKey ?? "pk_test_..."}</code>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copy(keys?.testPublicKey ?? "", "Test public key")}><Copy className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Test Secret Key</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                        {showTestSecret ? (keys?.testSecretKey ?? "sk_test_...") : "sk_test_***hidden***"}
                      </code>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setShowTestSecret(p => !p)}>
                        {showTestSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copy(keys?.testSecretKey ?? "", "Test secret key")}><Copy className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
                    Test card: <code className="font-mono">4242 4242 4242 4242</code>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Webhooks Tab */}
          <TabsContent value="webhooks" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">Receive real-time event notifications to your server</p>
              <Button size="sm" onClick={() => setWebhookOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Endpoint</Button>
            </div>
            <div className="space-y-3">
              {(webhooks ?? []).length === 0 ? (
                <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
                  <Webhook className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No webhook endpoints configured</p>
                  <p className="text-xs mt-1">Add an endpoint to receive payment events</p>
                </div>
              ) : (webhooks ?? []).map((w: any) => (
                <Card key={w.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                          <code className="text-xs truncate">{w.url}</code>
                          <Badge variant={w.status === "active" ? "default" : "secondary"} className="text-xs shrink-0">{w.status}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(w.events ?? []).map((e: string) => <Badge key={e} variant="outline" className="text-xs">{e}</Badge>)}
                        </div>
                        {w.lastDelivery && <p className="text-xs text-muted-foreground mt-1">Last delivery: {new Date(w.lastDelivery).toLocaleString()}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <CheckCircle className="h-4 w-4 text-green-400" />
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400" disabled={deleteWebhook.isPending} onClick={() => deleteWebhook.mutate({ id: w.id })}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Docs Tab */}
          <TabsContent value="docs" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">JavaScript / TypeScript SDK</CardTitle></CardHeader>
              <CardContent>
                <pre className="bg-muted rounded-xl p-4 text-xs overflow-x-auto">{`// npm install @remitflow/sdk
import RemitFlow from '@remitflow/sdk';
import { useTranslation } from 'react-i18next';
const rf = new RemitFlow({ apiKey: process.env.REMITFLOW_SECRET_KEY });

// Initiate a transfer
const transfer = await rf.transfers.create({
  amount: 10000, fromCurrency: 'NGN', toCurrency: 'GBP',
  beneficiary: {
    name: 'John Doe', accountNumber: '12345678',
    sortCode: '20-00-00', bankName: 'Barclays'
  }
});
console.log(transfer.reference); // TXN_abc123`}</pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Webhook Verification</CardTitle></CardHeader>
              <CardContent>
                <pre className="bg-muted rounded-xl p-4 text-xs overflow-x-auto">{`// Express.js webhook handler
app.post('/webhooks/remitflow',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['x-remitflow-signature'];
    const event = rf.webhooks.constructEvent(
      req.body, sig, process.env.WEBHOOK_SECRET
    );
    if (event.type === 'payment.completed') {
      await fulfillOrder(event.data.reference);
    }
    res.json({ received: true });
  }
);`}</pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">REST API Reference</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  { method: "POST", path: "/v1/transfers", desc: "Initiate a new transfer" },
                  { method: "GET",  path: "/v1/transfers/:id", desc: "Get transfer status" },
                  { method: "GET",  path: "/v1/rates?from=NGN&to=GBP", desc: "Get live FX rate" },
                  { method: "POST", path: "/v1/beneficiaries", desc: "Add a beneficiary" },
                  { method: "GET",  path: "/v1/account/balance", desc: "Get wallet balances" },
                ].map(r => (
                  <div key={r.path} className="flex items-center gap-3 p-2 rounded border">
                    <Badge variant={r.method === "POST" ? "default" : "secondary"} className="text-xs w-12 justify-center">{r.method}</Badge>
                    <code className="text-xs text-primary flex-1">{r.path}</code>
                    <span className="text-xs text-muted-foreground hidden sm:block">{r.desc}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Add Webhook Dialog */}
        <Dialog open={webhookOpen} onOpenChange={setWebhookOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Webhook Endpoint</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Endpoint URL</Label>
                <Input placeholder="https://yourapp.com/webhooks/remitflow" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
              </div>
              <div>
                <Label>Events to listen for</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {EVENTS.map(e => (
                    <label key={e} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={selectedEvents.includes(e)} onChange={() => toggleEvent(e)} className="rounded" />
                      <span>{e}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWebhookOpen(false)}>Cancel</Button>
              <Button
                onClick={() => addWebhook.mutate({ url: webhookUrl, events: selectedEvents })}
                disabled={!webhookUrl || addWebhook.isPending}
              >
                {addWebhook.isPending ? "Adding..." : "Add Endpoint"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
