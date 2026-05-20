import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, Clock, ArrowRight, CheckCircle, AlertTriangle, RefreshCw, Zap, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "ZAR", "CAD", "AUD", "XOF"];

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const pct = Math.max(0, Math.min(100, (remaining / (72 * 3600000)) * 100));
  const color = pct > 50 ? "text-emerald-400" : pct > 20 ? "text-yellow-400" : "text-red-400";
  const barColor = pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-yellow-500" : "bg-red-500";
  if (remaining === 0) return <span className="text-xs text-red-400 font-mono">EXPIRED</span>;
  return (
    <div className="space-y-1">
      <span className={`text-xs font-mono font-bold ${color}`}>
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </span>
      <div className="w-full bg-muted rounded-full h-1">
        <div className={`h-1 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RateLock() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [from, setFrom] = useState("NGN");
  const [to, setTo] = useState("GBP");
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("72");
  const [useDialog, setUseDialog] = useState<any>(null);

  const { data: locksData, refetch } = trpc.fx.getLockedRates.useQuery();
  const { data: ratesData } = trpc.fx.rates.useQuery();
  const lockRate = trpc.fx.lockRate.useMutation({
    onSuccess: () => { refetch(); setAmount(""); toast.success(`Rate locked for ${duration} hours!`); },
    onError: e => toast.error(e.message),
  });
  const cancelLock = trpc.fx.cancelLock.useMutation({
    onSuccess: () => { refetch(); toast.success("Rate lock cancelled"); },
  });

  const currentRate = (() => {
    const rates = (ratesData as any)?.rates ?? {};
    const fromRate = rates[from] ?? 1;
    const toRate = rates[to] ?? 1;
    return toRate / fromRate;
  })();

  const locks = Array.isArray(locksData) ? locksData : [];
  const activeLocks = locks.filter((l: any) => l.status === "active" && new Date(l.expiresAt) > new Date());
  const expiredLocks = locks.filter((l: any) => l.status !== "active" || new Date(l.expiresAt) <= new Date());

  const savings = amount && currentRate > 0
    ? Math.abs((parseFloat(amount) * currentRate) - (parseFloat(amount) * currentRate * 0.998))
    : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10"><Lock className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold">Rate Lock</h1>
            <p className="text-muted-foreground text-sm">Lock today's exchange rate for up to 72 hours before sending</p>
          </div>
        </div>

        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            Lock a rate now and use it anytime within the lock period. Ideal when you spot a favorable rate but aren't ready to send yet.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Lock a New Rate</CardTitle>
            <CardDescription>Current live rates are fetched in real time from multiple providers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From Currency</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">To Currency</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {currentRate > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border">
                <span className="text-sm text-muted-foreground">Live rate</span>
                <span className="font-bold text-primary">1 {from} = {currentRate.toFixed(6)} {to}</span>
              </div>
            )}

            <div>
              <Label className="text-xs">Amount ({from})</Label>
              <Input
                type="number" min="0" placeholder="e.g. 50000"
                value={amount} onChange={e => setAmount(e.target.value)}
              />
              {amount && currentRate > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  You will receive ≈ <strong>{(parseFloat(amount) * currentRate).toLocaleString()} {to}</strong>
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs">Lock Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="6">6 hours</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="48">48 hours</SelectItem>
                  <SelectItem value="72">72 hours (max)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={() => lockRate.mutate({ from, to, amount: parseFloat(amount), duration: parseInt(duration) })}
              disabled={!amount || parseFloat(amount) <= 0 || lockRate.isPending}
            >
              {lockRate.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
              Lock Rate for {duration}h
            </Button>
          </CardContent>
        </Card>

        {activeLocks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />Active Rate Locks
                <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">{activeLocks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeLocks.map((l: any) => (
                <div key={l.id} className="p-4 border rounded-xl bg-emerald-500/5 border-emerald-500/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <span>{l.fromCurrency ?? l.from_currency}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <span>{l.toCurrency ?? l.to_currency}</span>
                    </div>
                    <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">ACTIVE</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Locked Rate</p>
                      <p className="font-bold text-primary">{Number(l.lockedRate ?? l.locked_rate).toFixed(6)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Amount</p>
                      <p className="font-semibold">{Number(l.amount).toLocaleString()} {l.fromCurrency ?? l.from_currency}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3" />Time remaining</p>
                    <CountdownTimer expiresAt={l.expiresAt ?? l.expires_at} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm" className="flex-1"
                      onClick={() => setUseDialog(l)}
                    >
                      <Zap className="w-3 h-3 mr-1" />Use This Rate
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="text-red-400 border-red-400/30 hover:bg-red-500/10"
                      onClick={() => cancelLock.mutate({ id: l.id })}
                      disabled={cancelLock.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {expiredLocks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="w-4 h-4" />Expired / Used Locks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {expiredLocks.slice(0, 5).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between p-3 border rounded-lg opacity-60">
                  <div className="text-sm">
                    <span className="font-medium">{l.fromCurrency ?? l.from_currency} → {l.toCurrency ?? l.to_currency}</span>
                    <span className="text-muted-foreground ml-2">@ {Number(l.lockedRate ?? l.locked_rate).toFixed(4)}</span>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{l.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {locks.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Lock className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No rate locks yet. Lock a rate above to protect yourself from market fluctuations.</p>
            </CardContent>
          </Card>
        )}

        {/* Use Locked Rate Dialog */}
        <Dialog open={!!useDialog} onOpenChange={() => setUseDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />Use Locked Rate
              </DialogTitle>
            </DialogHeader>
            {useDialog && (
              <div className="space-y-4 py-2">
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-center">
                  <p className="text-xs text-muted-foreground">Locked Rate</p>
                  <p className="text-2xl font-black text-primary">{Number(useDialog.lockedRate ?? useDialog.locked_rate).toFixed(6)}</p>
                  <p className="text-xs text-muted-foreground">{useDialog.fromCurrency ?? useDialog.from_currency} → {useDialog.toCurrency ?? useDialog.to_currency}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  You will be taken to Send Money with this locked rate pre-filled. The rate will be applied automatically.
                </p>
                <Alert className="border-yellow-500/30 bg-yellow-500/10">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  <AlertDescription className="text-xs text-yellow-400">
                    <CountdownTimer expiresAt={useDialog.expiresAt ?? useDialog.expires_at} />
                  </AlertDescription>
                </Alert>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setUseDialog(null)}>Cancel</Button>
              <Button onClick={() => {
                setUseDialog(null);
                navigate(`/send?lockedRate=${useDialog?.lockedRate ?? useDialog?.locked_rate}&from=${useDialog?.fromCurrency ?? useDialog?.from_currency}&to=${useDialog?.toCurrency ?? useDialog?.to_currency}&lockId=${useDialog?.id}`);
              }}>
                <ArrowRight className="w-4 h-4 mr-1" />Go to Send Money
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
