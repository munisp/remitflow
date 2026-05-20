import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, Copy, Plus, RefreshCw, CheckCircle, Clock, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function VirtualAccount() {
  const { t } = useTranslation();
  const { data: accounts = [], refetch, isLoading } = trpc.virtualAccount.list.useQuery();
  const createMutation = trpc.virtualAccount.create.useMutation({ onSuccess: () => { toast.success("Virtual account created!"); refetch(); setOpen(false); } });
  const deleteMutation = trpc.virtualAccount.delete.useMutation({ onSuccess: () => { toast.success("Virtual account closed."); refetch(); }, onError: (e) => toast.error(e.message) });
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [label, setLabel] = useState("");
  const [showDetails, setShowDetails] = useState<Record<number, boolean>>({});
  const accts = Array.isArray(accounts) ? accounts : [];

  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} copied!`); };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="w-6 h-6 text-primary" />Virtual Accounts</h1>
            <p className="text-muted-foreground text-sm mt-1">Dedicated bank account numbers for receiving payments in multiple currencies</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Account</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Virtual Account</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div><Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{["USD","GBP","EUR","NGN","KES","GHS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Label (optional)</Label><Input className="mt-1" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Client Payments" /></div>
                <Button className="w-full" disabled={createMutation.isPending} onClick={() => createMutation.mutate({ currency })}>
                  {createMutation.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">{[1,2].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />)}</div>
        ) : accts.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-lg">No virtual accounts yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Create a virtual account to receive payments in any currency</p>
              <Button className="mt-4" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />Create First Account</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {accts.map((acct: any) => (
              <Card key={acct.id} className="relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-8 translate-x-8" />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{acct.currency} Account</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={acct.status === "active" ? "default" : "secondary"}>{acct.status ?? "active"}</Badge>
                      {acct.status !== "closed" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={deleteMutation.isPending} onClick={() => { if (confirm("Close this virtual account? This cannot be undone.")) deleteMutation.mutate({ id: acct.id }); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                      )}
                    </div>
                  </div>
                  {acct.label && <p className="text-xs text-muted-foreground">{acct.label}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Account Number</p>
                        <p className="font-mono font-semibold">{showDetails[acct.id] ? (acct.accountNumber ?? "0123456789") : "••••••••••"}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowDetails(s => ({ ...s, [acct.id]: !s[acct.id] }))}>{showDetails[acct.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(acct.accountNumber ?? "0123456789", "Account number")}><Copy className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Bank Name</p>
                        <p className="text-sm font-medium">{acct.bankName ?? "RemitFlow Virtual Bank"}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(acct.bankName ?? "RemitFlow Virtual Bank", "Bank name")}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                    {acct.sortCode && (
                      <div className="flex items-center justify-between">
                        <div><p className="text-xs text-muted-foreground">Sort Code</p><p className="font-mono text-sm">{acct.sortCode}</p></div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(acct.sortCode, "Sort code")}><Copy className="w-3.5 h-3.5" /></Button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Balance</span>
                    <span className="font-semibold">{acct.currency} {Number(acct.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>Ready to receive payments</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">How Virtual Accounts Work</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3 text-sm">
              {[
                { icon: <Plus className="w-5 h-5 text-primary" />, title: "Create Account", desc: "Get a dedicated account number in any supported currency" },
                { icon: <Building2 className="w-5 h-5 text-blue-500" />, title: "Share Details", desc: "Share your account number with clients or payment platforms" },
                { icon: <CheckCircle className="w-5 h-5 text-green-500" />, title: "Receive Instantly", desc: "Funds arrive in your RemitFlow wallet automatically" },
              ].map((step, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="mt-0.5">{step.icon}</div>
                  <div><p className="font-medium">{step.title}</p><p className="text-muted-foreground text-xs mt-0.5">{step.desc}</p></div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
