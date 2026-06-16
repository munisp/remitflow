import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Crown, TrendingDown, Lock, Phone, CreditCard, Star } from "lucide-react";
import { useSearchParams } from "wouter";
import { useTranslation } from 'react-i18next';

export default function PrivateBankingDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [lockAmount, setLockAmount] = useState(10000000);
  const [lockCorridor, setLockCorridor] = useState("USD");
  const [lockDuration, setLockDuration] = useState(30);
  const [rmMessage, setRmMessage] = useState("");
  const [rmTopic, setRmTopic] = useState("general");
  const [rmTime, setRmTime] = useState("");
  const [rmDialogOpen, setRmDialogOpen] = useState(false);

  const { data: profile } = trpc.hnwBanking.getHnwProfile.useQuery(undefined, { enabled: !!user });
  const { data: spread } = trpc.hnwBanking.getNegotiatedSpread.useQuery(undefined, { enabled: !!user });
  const { data: rateLocks, refetch: refetchLocks } = trpc.hnwBanking.getRateLocks.useQuery(undefined, { enabled: !!user });
  const { data: history } = trpc.hnwBanking.getHnwTransferHistory.useQuery({}, { enabled: !!user });

  const createLock = trpc.hnwBanking.createRateLock.useMutation({
    onSuccess: (d) => { toast.success(`Rate locked! ID: ${(d as any).lockId}`); refetchLocks(); },
    onError: (e) => toast.error(e.message),
  });

  const executeTransfer = trpc.hnwBanking.executeRateLockTransfer.useMutation({
    onSuccess: () => { toast.success("Transfer executed at locked rate"); refetchLocks(); },
    onError: (e) => toast.error(e.message),
  });

  const requestRm = trpc.hnwBanking.requestRmContact.useMutation({
    onSuccess: () => { toast.success("RM contact request sent"); setRmDialogOpen(false); setRmMessage(""); },
    onError: (e) => toast.error(e.message),
  });

  const [searchParams] = useSearchParams();

  // Handle Stripe redirect result
  useEffect(() => {
    const payment = searchParams.get("payment");
    const service = searchParams.get("service");
    if (payment === "success") {
      const label = service === "priority_swift" ? "Priority SWIFT" : "Advisory Retainer";
      toast.success(`${label} payment confirmed! Your service is now active.`);
    } else if (payment === "cancelled") {
      toast.info("Payment was cancelled.");
    }
  }, []);

  const createCheckout = trpc.hnwBanking.createHnwCheckout.useMutation({
    onSuccess: (data) => {
      toast.info("Redirecting to secure checkout...");
      window.open(data.checkoutUrl!, "_blank");
    },
    onError: (e) => toast.error(e.message),
  });

  const aumTier = (profile as any)?.aumTier ?? "standard";
  const tierColors: Record<string, string> = { standard: "bg-gray-500", premium: "bg-blue-600", elite: "bg-yellow-500" };
  const negotiatedBps = parseFloat((spread as any)?.negotiatedSpreadBps ?? "150");
  const marketBps = 200;
  const savingsBps = Math.max(marketBps - negotiatedBps, 0);

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Crown className="h-8 w-8 text-yellow-500" />
        <div><h1 className="text-2xl font-bold">Private Banking</h1><p className="text-muted-foreground">High-value transfers with negotiated FX rates</p></div>
        <Badge className={`ml-auto ${tierColors[aumTier]}`}>{aumTier.toUpperCase()} CLIENT</Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Your Spread</p><p className="text-2xl font-bold">{negotiatedBps} bps</p><p className="text-xs text-green-500">vs {marketBps} bps market</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Savings per $1M</p><p className="text-2xl font-bold text-green-500">${(savingsBps * 100).toLocaleString()}</p><p className="text-xs text-muted-foreground">{savingsBps} bps saving</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">RM Contact</p><p className="text-lg font-medium">{(profile as any)?.rmName ?? "Assigned on upgrade"}</p><Dialog open={rmDialogOpen} onOpenChange={setRmDialogOpen}><DialogTrigger asChild><Button variant="outline" size="sm" className="mt-1"><Phone className="h-3 w-3 mr-1" />Contact RM</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Contact Relationship Manager</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Topic</Label><Select value={rmTopic} onValueChange={setRmTopic}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="general">General Enquiry</SelectItem><SelectItem value="rate_negotiation">Rate Negotiation</SelectItem><SelectItem value="large_transfer">Large Transfer</SelectItem><SelectItem value="account_upgrade">Account Upgrade</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Message</Label><Textarea value={rmMessage} onChange={(e) => setRmMessage(e.target.value)} placeholder="Describe your request..." /></div><div className="space-y-2"><Label>Preferred Contact Time</Label><Input value={rmTime} onChange={(e) => setRmTime(e.target.value)} placeholder="e.g. Tomorrow 10am WAT" /></div><Button className="w-full" disabled={requestRm.isPending} onClick={() => requestRm.mutate({ message: rmMessage, topic: rmTopic as "general" | "rate_negotiation" | "account_upgrade" | "large_transfer", preferredContactTime: rmTime })}>{requestRm.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Send Request</Button></div></DialogContent></Dialog></CardContent></Card>
      </div>

      <Tabs defaultValue="rate-lock">
        <TabsList><TabsTrigger value="rate-lock">Rate Lock</TabsTrigger><TabsTrigger value="history">Transfer History</TabsTrigger><TabsTrigger value="premium-services"><CreditCard className="h-3 w-3 mr-1" />Premium Services</TabsTrigger></TabsList>

        <TabsContent value="rate-lock" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" />Create Rate Lock</CardTitle><CardDescription>Lock today's rate for up to 60 minutes</CardDescription></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Corridor</Label><Select value={lockCorridor} onValueChange={setLockCorridor}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="GBP">GBP</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="CAD">CAD</SelectItem><SelectItem value="AED">AED</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Amount (NGN)</Label><Input type="number" min={1000000} max={810000000} value={lockAmount} onChange={(e) => setLockAmount(Number(e.target.value))} /></div>
                <div className="space-y-2"><Label>Duration (minutes)</Label><Select value={String(lockDuration)} onValueChange={(v) => setLockDuration(Number(v))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="5">5 min</SelectItem><SelectItem value="15">15 min</SelectItem><SelectItem value="30">30 min</SelectItem><SelectItem value="60">60 min</SelectItem></SelectContent></Select></div>
              </div>
              <Button className="mt-4" disabled={createLock.isPending} onClick={() => createLock.mutate({ corridorCode: lockCorridor, amountNgn: lockAmount, durationMinutes: lockDuration })}>{createLock.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}Lock Rate</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Active Rate Locks</CardTitle></CardHeader>
            <CardContent>
              {!rateLocks || (rateLocks as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">No active rate locks</p> : (
                <Table><TableHeader><TableRow><TableHead>Lock ID</TableHead><TableHead>Corridor</TableHead><TableHead>Amount</TableHead><TableHead>Rate</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{(rateLocks as any[]).map((lock) => (
                  <TableRow key={lock.lockId}>
                    <TableCell className="font-mono text-xs">{lock.lockId.slice(0, 8)}...</TableCell>
                    <TableCell>{lock.corridorCode}</TableCell>
                    <TableCell>₦{parseFloat(lock.amountNgn).toLocaleString()}</TableCell>
                    <TableCell>{parseFloat(lock.fxRate).toFixed(4)}</TableCell>
                    <TableCell>{lock.expiresAt ? new Date(lock.expiresAt).toLocaleTimeString() : "—"}</TableCell>
                    <TableCell><Badge variant={lock.status === "active" ? "default" : "secondary"}>{lock.status}</Badge></TableCell>
                    <TableCell>{lock.status === "active" && <Button size="sm" variant="outline" disabled={executeTransfer.isPending} onClick={() => executeTransfer.mutate({ rateLockId: lock.lockId, recipientSwift: "", recipientAccount: "", recipientName: "" })}>Execute</Button>}</TableCell>
                  </TableRow>
                ))}</TableBody></Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle>Transfer History</CardTitle></CardHeader>
            <CardContent>
              {!history || (history as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">No transfers yet</p> : (
                <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Corridor</TableHead><TableHead>Amount</TableHead><TableHead>Rate</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{(history as any[]).map((t) => (
                  <TableRow key={t.transferId}><TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell><TableCell>{t.corridorCode}</TableCell><TableCell>₦{parseFloat(t.amountNgn).toLocaleString()}</TableCell><TableCell>{parseFloat(t.fxRate).toFixed(4)}</TableCell><TableCell><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></TableCell></TableRow>
                ))}</TableBody></Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="premium-services" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Priority SWIFT */}
            <Card className="border-2 border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-600" />
                  Priority SWIFT Transfer
                </CardTitle>
                <CardDescription>Same-day SWIFT execution with dedicated correspondent bank routing</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">$25</span>
                  <span className="text-muted-foreground">per transfer</span>
                </div>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>✓ Same-day settlement (before 14:00 UTC cutoff)</li>
                  <li>✓ Dedicated Citibank/Barclays nostro routing</li>
                  <li>✓ Real-time SWIFT GPI tracking</li>
                  <li>✓ Priority compliance review</li>
                </ul>
                <Button
                  className="w-full"
                  disabled={createCheckout.isPending}
                  onClick={() => createCheckout.mutate({ serviceType: "priority_swift", origin: window.location.origin })}
                >
                  {createCheckout.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
                  Pay $25 — Activate Priority SWIFT
                </Button>
                <p className="text-xs text-muted-foreground text-center">Test card: 4242 4242 4242 4242</p>
              </CardContent>
            </Card>

            {/* Advisory Retainer */}
            <Card className="border-2 border-yellow-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5 text-yellow-500" />
                  HNW Advisory Retainer
                </CardTitle>
                <CardDescription>Monthly dedicated relationship manager with negotiated FX rates</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">$250</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>✓ Dedicated RM available 8am–8pm WAT</li>
                  <li>✓ Negotiated FX spread as low as 60 bps</li>
                  <li>✓ Dedicated IBAN for inbound transfers</li>
                  <li>✓ Monthly FX market briefing</li>
                  <li>✓ Waived SWIFT fees on transfers &gt; $50k</li>
                </ul>
                <Button
                  className="w-full bg-yellow-500 hover:bg-yellow-600 text-white"
                  disabled={createCheckout.isPending}
                  onClick={() => createCheckout.mutate({ serviceType: "advisory_retainer", origin: window.location.origin })}
                >
                  {createCheckout.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Star className="h-4 w-4 mr-2" />}
                  Pay $250 — Activate Retainer
                </Button>
                <p className="text-xs text-muted-foreground text-center">Test card: 4242 4242 4242 4242</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
