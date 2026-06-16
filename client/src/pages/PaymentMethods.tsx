import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Building2, Plus, Trash2, Star, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function PaymentMethods() {
  const { t } = useTranslation();
  
  const { data: methods, refetch, isError } = trpc.paymentMethods.list.useQuery();
  const addMutation = trpc.paymentMethods.addCard.useMutation({ onSuccess: () => { toast.success("Payment method added!"); refetch(); setOpen(false); } });
  const removeMutation = trpc.paymentMethods.remove.useMutation({ onSuccess: () => { toast.success("Removed"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"bank" | "card">("bank");
  const [form, setForm] = useState({ accountNumber: "", bankName: "", bankCode: "", accountName: "", cardNumber: "", expiryMonth: "", expiryYear: "", cvv: "" });

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Payment Methods</h1><p className="text-muted-foreground text-sm">Manage linked banks and cards</p></div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>

        <div className="space-y-3">
          {(methods?.wallets ?? []).map((m: any) => (
            <Card key={m.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + (m.type === "bank" ? "bg-blue-100" : "bg-purple-100")}>
                  {m.type === "bank" ? <Building2 className="h-5 w-5 text-blue-600" /> : <CreditCard className="h-5 w-5 text-purple-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2">{m.bankName ?? m.cardBrand}
                    {m.isDefault && <Badge className="text-xs bg-emerald-100 text-emerald-700 border-0">Default</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.type === "bank" ? `${m.accountNumber} · ${m.accountName}` : `•••• ${m.last4} · ${m.expiryMonth}/${m.expiryYear}`}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeMutation.mutate({ id: m.id })}><Trash2 className="h-4 w-4" /></Button>
              </CardContent>
            </Card>
          ))}
          {(!methods || (methods?.wallets?.length ?? 0) === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No payment methods added yet</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Payment Method</DialogTitle></DialogHeader>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setType("bank")} className={"flex-1 py-2 rounded-lg border text-sm font-medium " + (type === "bank" ? "border-primary bg-primary text-primary-foreground" : "border-border")}>Bank Account</button>
            <button onClick={() => setType("card")} className={"flex-1 py-2 rounded-lg border text-sm font-medium " + (type === "card" ? "border-primary bg-primary text-primary-foreground" : "border-border")}>Debit Card</button>
          </div>
          {type === "bank" ? (
            <div className="space-y-3">
              <Input placeholder="Account number" value={form.accountNumber} onChange={e => setForm(p => ({ ...p, accountNumber: e.target.value }))} />
              <Input placeholder="Bank name" value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} />
              <Input placeholder="Account name" value={form.accountName} onChange={e => setForm(p => ({ ...p, accountName: e.target.value }))} />
            </div>
          ) : (
            <div className="space-y-3">
              <Input placeholder="Card number" value={form.cardNumber} onChange={e => setForm(p => ({ ...p, cardNumber: e.target.value }))} />
              <div className="flex gap-2">
                <Input placeholder="MM" value={form.expiryMonth} onChange={e => setForm(p => ({ ...p, expiryMonth: e.target.value }))} />
                <Input placeholder="YY" value={form.expiryYear} onChange={e => setForm(p => ({ ...p, expiryYear: e.target.value }))} />
                <Input placeholder="CVV" value={form.cvv} onChange={e => setForm(p => ({ ...p, cvv: e.target.value }))} />
              </div>
            </div>
          )}
          <Button className="w-full mt-2" disabled={addMutation.isPending}
            onClick={() => addMutation.mutate(form as any)}>
            {addMutation.isPending ? "Adding..." : "Add Payment Method"}
          </Button>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
