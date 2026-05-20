import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, Plus, Search, Trash2, Send, Building2, Globe, Phone, Edit } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["NGN","USD","GBP","EUR","KES","GHS","ZAR","TZS","UGX","RWF","XOF","EGP","SAR","AED","CNY","INR","CAD","AUD"];
const BANKS: Record<string, string[]> = {
  NGN: ["Access Bank","GTBank","First Bank","Zenith Bank","UBA","Fidelity Bank","Stanbic IBTC","Union Bank","Sterling Bank","Polaris Bank"],
  GHS: ["GCB Bank","Ecobank Ghana","Fidelity Bank Ghana","Stanbic Bank Ghana","Absa Bank Ghana"],
  KES: ["KCB Bank","Equity Bank","Co-operative Bank","Absa Bank Kenya","NCBA Bank"],
  ZAR: ["Standard Bank","FNB","ABSA","Nedbank","Capitec"],
  USD: ["Chase","Bank of America","Wells Fargo","Citibank","TD Bank"],
  GBP: ["Barclays","HSBC","Lloyds","NatWest","Santander UK"],
};

export default function Beneficiaries() {
  const { t } = useTranslation();
  const { data: beneficiaries, refetch } = trpc.beneficiaries.list.useQuery();
  const addMutation = trpc.beneficiaries.add.useMutation({ onSuccess: () => { toast.success("Beneficiary added!"); refetch(); setOpen(false); setForm({ name: "", accountNumber: "", bankName: "", bankCode: "", currency: "NGN", country: "Nigeria", email: "", phone: "", nickname: "" }); }, onError: (e: any) => toast.error(e.message) });
  const removeMutation = trpc.beneficiaries.remove.useMutation({ onSuccess: () => { toast.success("Removed"); refetch(); }, onError: (e: any) => toast.error(e.message) });
  const updateMutation = trpc.beneficiaries.update.useMutation({ onSuccess: () => { toast.success("Beneficiary updated!"); refetch(); setEditOpen(false); }, onError: (e: any) => toast.error(e.message) });
  const toggleFavMutation = trpc.beneficiaries.toggleFavorite.useMutation({ onSuccess: () => refetch(), onError: (e: any) => toast.error(e.message) });
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", accountNumber: "", bankName: "", bankCode: "", currency: "NGN", country: "Nigeria", email: "", phone: "", nickname: "" });

  const filtered = (Array.isArray(beneficiaries) ? beneficiaries : []).filter((b: any) =>
    b.name?.toLowerCase().includes(search.toLowerCase()) ||
    b.accountNumber?.includes(search) ||
    b.bankName?.toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (b: any) => { setSelected(b); setForm({ name: b.name, accountNumber: b.accountNumber ?? "", bankName: b.bankName ?? "", bankCode: b.bankCode ?? "", currency: b.currency ?? "NGN", country: b.country ?? "Nigeria", email: b.email ?? "", phone: b.phone ?? "", nickname: b.nickname ?? "" }); setEditOpen(true); };

  const BeneficiaryForm = ({ onSubmit, loading }: { onSubmit: () => void; loading: boolean }) => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Full Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="John Doe" /></div>
        <div><Label>Nickname</Label><Input value={form.nickname} onChange={e => setForm(f => ({ ...f, nickname: e.target.value }))} placeholder="Dad, Mom..." /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="john@example.com" /></div>
        <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+234..." /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Currency *</Label>
          <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Country</Label><Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Nigeria" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Bank Name</Label>
          <Select value={form.bankName} onValueChange={v => setForm(f => ({ ...f, bankName: v }))}>
            <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
            <SelectContent>{(BANKS[form.currency] ?? BANKS.USD).map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Account Number *</Label><Input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} placeholder="0123456789" /></div>
      </div>
      <Button onClick={onSubmit} disabled={loading} className="w-full">{loading ? "Saving..." : "Save Beneficiary"}</Button>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6 text-primary" /> Beneficiaries</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your saved recipients for fast transfers</p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />Add Beneficiary</Button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{filtered.length}</div><div className="text-sm text-muted-foreground">Total</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{Array.from(new Set(filtered.map((b: any) => b.currency))).length}</div><div className="text-sm text-muted-foreground">Currencies</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{Array.from(new Set(filtered.map((b: any) => b.country))).length}</div><div className="text-sm text-muted-foreground">Countries</div></CardContent></Card>
        </div>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search by name, bank, currency..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        {filtered.length === 0 ? (
          <Card><CardContent className="py-16 text-center"><Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" /><p className="text-muted-foreground">No beneficiaries found. Add one to get started.</p></CardContent></Card>
        ) : (
          <div className="grid gap-3">
            {filtered.map((b: any) => (
              <Card key={b.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">{b.name?.charAt(0)?.toUpperCase()}</div>
                    <div>
                      <div className="font-semibold">{b.name}{b.nickname && <span className="text-xs text-muted-foreground ml-2">({b.nickname})</span>}</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-3 mt-0.5">
                        {b.bankName && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{b.bankName}</span>}
                        {b.accountNumber && <span>{b.accountNumber}</span>}
                        {b.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{b.phone}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="flex items-center gap-1"><Globe className="w-3 h-3" />{b.currency}</Badge>
                    <Button variant="ghost" size="icon" title={b.isFavorite ? "Remove from favorites" : "Add to favorites"} onClick={() => toggleFavMutation.mutate({ id: b.id })}><span className={b.isFavorite ? "text-yellow-500 text-base" : "text-muted-foreground text-base"}>{b.isFavorite ? "★" : "☆"}</span></Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(b)}><Edit className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeMutation.mutate({ id: b.id })}><Trash2 className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => { window.location.href = `/send?beneficiary=${b.id}`; }}><Send className="w-3 h-3 mr-1" />Send</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Add New Beneficiary</DialogTitle></DialogHeader><BeneficiaryForm onSubmit={() => { if (!form.name.trim()) return toast.error("Name required"); if (!form.accountNumber.trim()) return toast.error("Account number required"); addMutation.mutate(form); }} loading={addMutation.isPending} /></DialogContent></Dialog>
      <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Edit Beneficiary</DialogTitle></DialogHeader><BeneficiaryForm onSubmit={() => { if (!form.name.trim()) return toast.error("Name required"); if (selected) updateMutation.mutate({ id: selected.id, name: form.name, accountNumber: form.accountNumber, bankName: form.bankName, phone: form.phone, email: form.email }); }} loading={updateMutation.isPending} /></DialogContent></Dialog>
    </DashboardLayout>
  );
}
