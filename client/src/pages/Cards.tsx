import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CreditCard, Plus, Lock, Unlock, Trash2, Eye, EyeOff, Settings, Zap, Shield } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function Cards() {
  const { t } = useTranslation();
  const { data: cards = [], refetch } = trpc.cards.list.useQuery();
  const create = trpc.cards.create.useMutation({ onSuccess: () => { toast.success("Card created!"); refetch(); setOpen(false); }, onError: (e: any) => toast.error(e.message) });
  const freeze = trpc.cards.freeze.useMutation({ onSuccess: () => { toast.success("Card frozen"); refetch(); } });
  const unfreeze = trpc.cards.unfreeze.useMutation({ onSuccess: () => { toast.success("Card unfrozen"); refetch(); } });
  const cancel = trpc.cards.cancel.useMutation({ onSuccess: () => { toast.success("Card cancelled"); refetch(); } });
  const updateLimit = trpc.cards.updateLimit.useMutation({ onSuccess: () => { toast.success("Limit updated"); refetch(); setLimitOpen(false); } });

  const [open, setOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [showNumbers, setShowNumbers] = useState<Record<number, boolean>>({});
  const [form, setForm] = useState({ type: "virtual" as "virtual" | "physical", brand: "visa" as "visa" | "mastercard" | "verve", currency: "USD" });
  const [newLimit, setNewLimit] = useState("");

  const cardsList = Array.isArray(cards) ? cards : [];

  const brandColor = (brand: string) => brand === "visa" ? "from-blue-600 to-blue-800" : brand === "mastercard" ? "from-red-500 to-orange-600" : "from-green-600 to-emerald-700";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard className="w-6 h-6 text-primary" /> My Cards</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your virtual and physical payment cards</p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />New Card</Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{cardsList.length}</div><div className="text-sm text-muted-foreground">Total Cards</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-green-600">{cardsList.filter((c: any) => c.status === "active").length}</div><div className="text-sm text-muted-foreground">Active</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-yellow-600">{cardsList.filter((c: any) => c.status === "frozen").length}</div><div className="text-sm text-muted-foreground">Frozen</div></CardContent></Card>
        </div>

        {cardsList.length === 0 ? (
          <Card><CardContent className="py-16 text-center"><CreditCard className="w-12 h-12 text-muted-foreground mx-auto mb-4" /><p className="text-muted-foreground">No cards yet. Create your first card.</p><Button className="mt-4" onClick={() => setOpen(true)}>Create Card</Button></CardContent></Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {cardsList.map((c: any) => (
              <div key={c.id} className="relative">
                <div className={`rounded-2xl p-6 bg-gradient-to-br ${brandColor(c.brand)} text-white shadow-xl`}>
                  <div className="flex justify-between items-start mb-8">
                    <div><div className="text-xs opacity-70 uppercase tracking-wider">{c.type} card</div><div className="text-sm font-medium mt-1">{c.cardholderName}</div></div>
                    <div className="flex gap-2">
                      <Badge variant="secondary" className={`text-xs ${c.status === "active" ? "bg-green-500/20 text-green-100" : c.status === "frozen" ? "bg-blue-500/20 text-blue-100" : "bg-red-500/20 text-red-100"}`}>{c.status}</Badge>
                    </div>
                  </div>
                  <div className="text-xl font-mono tracking-widest mb-4">
                    {showNumbers[c.id] ? `4242 4242 4242 ${c.last4}` : `•••• •••• •••• ${c.last4}`}
                  </div>
                  <div className="flex justify-between items-end">
                    <div><div className="text-xs opacity-70">Expires</div><div className="text-sm">{c.expiryMonth}/{c.expiryYear}</div></div>
                    <div className="text-lg font-bold uppercase">{c.brand}</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowNumbers(p => ({ ...p, [c.id]: !p[c.id] }))}>
                    {showNumbers[c.id] ? <><EyeOff className="w-3 h-3 mr-1" />Hide</> : <><Eye className="w-3 h-3 mr-1" />Show</>}
                  </Button>
                  {c.status === "active" ? (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => freeze.mutate({ id: c.id })}><Lock className="w-3 h-3 mr-1" />Freeze</Button>
                  ) : c.status === "frozen" ? (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => unfreeze.mutate({ id: c.id })}><Unlock className="w-3 h-3 mr-1" />Unfreeze</Button>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => { setSelectedCard(c); setNewLimit(c.spendLimit?.toString() ?? "5000"); setLimitOpen(true); }}><Settings className="w-3 h-3" /></Button>
                  <Button variant="outline" size="sm" className="text-destructive" onClick={() => { if (confirm("Cancel this card?")) cancel.mutate({ id: c.id }); }}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent><DialogHeader><DialogTitle>Create New Card</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Card Type</Label>
                <Select value={form.type} onValueChange={(v: any) => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="virtual">Virtual Card (instant)</SelectItem><SelectItem value="physical">Physical Card (5-7 days)</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Card Brand</Label>
                <Select value={form.brand} onValueChange={(v: any) => setForm(f => ({ ...f, brand: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="visa">Visa</SelectItem><SelectItem value="mastercard">Mastercard</SelectItem><SelectItem value="verve">Verve</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["USD","GBP","EUR","NGN","KES","GHS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground flex items-start gap-2"><Shield className="w-4 h-4 mt-0.5 shrink-0" />All cards are secured with 3D Secure and real-time fraud monitoring.</div>
              <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate(form)}>{create.isPending ? "Creating..." : "Create Card"}</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
          <DialogContent><DialogHeader><DialogTitle>Update Spend Limit</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Monthly Spend Limit (USD)</Label><Input type="number" value={newLimit} onChange={e => setNewLimit(e.target.value)} placeholder="5000" /></div>
              <Button className="w-full" disabled={updateLimit.isPending} onClick={() => selectedCard && updateLimit.mutate({ id: selectedCard.id, limit: Number(newLimit) })}>{updateLimit.isPending ? "Saving..." : "Update Limit"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
