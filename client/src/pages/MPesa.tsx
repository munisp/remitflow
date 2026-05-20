import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Smartphone, Send, RefreshCw, CheckCircle, Clock, XCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function MPesa() {
  const { t } = useTranslation();
  const { data: history = [], refetch } = trpc.transactions.list.useQuery({ type: "send", limit: 10 });
  const sendMutation = trpc.mpesa.send.useMutation({ onSuccess: (d) => { toast.success(`M-Pesa sent! Ref: ${d.reference}`); refetch(); setForm({ phone: "", amount: "", description: "" }); }, onError: (e: any) => toast.error(e.message) });
  const [form, setForm] = useState({ phone: "", amount: "", description: "" });
  const hist = Array.isArray(history) ? history : [];

  const statusIcon = (s: string) => s === "completed" ? <CheckCircle className="w-4 h-4 text-green-500" /> : s === "failed" ? <XCircle className="w-4 h-4 text-red-500" /> : <Clock className="w-4 h-4 text-yellow-500" />;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Smartphone className="w-6 h-6 text-green-600" />M-Pesa Transfer</h1>
          <p className="text-muted-foreground text-sm mt-1">Send money directly to M-Pesa mobile wallets in Kenya, Tanzania, Uganda</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Send via M-Pesa</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>M-Pesa Phone Number</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+254712345678" /></div>
            <div><Label>Amount (KES)</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="1000" /></div>
            <div><Label>Description (optional)</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="School fees, rent..." /></div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-sm text-green-700 dark:text-green-400">
              <p className="font-medium">How it works:</p>
              <ol className="list-decimal list-inside mt-1 space-y-1 text-xs">
                <li>Enter recipient's M-Pesa number</li>
                <li>An STK push notification is sent to their phone</li>
                <li>They enter their M-Pesa PIN to confirm</li>
                <li>Funds arrive instantly</li>
              </ol>
            </div>
            <Button className="w-full bg-green-600 hover:bg-green-700" disabled={sendMutation.isPending || !form.phone || !form.amount} onClick={() => sendMutation.mutate({ phone: form.phone, amount: parseFloat(form.amount) })}>
              {sendMutation.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Sending...</> : <><Send className="w-4 h-4 mr-2" />Send M-Pesa</>}
            </Button>
          </CardContent>
        </Card>
        {hist.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Recent M-Pesa Transfers</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {hist.slice(0, 10).map((tx: any) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">{statusIcon(tx.status)}<div><p className="text-sm font-medium">{tx.phone}</p><p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleString()}</p></div></div>
                    <div className="text-right"><p className="font-medium">KES {tx.amount?.toLocaleString()}</p><Badge variant={tx.status === "completed" ? "default" : tx.status === "failed" ? "destructive" : "secondary"} className="text-xs">{tx.status}</Badge></div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
