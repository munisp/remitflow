import { useState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus, Trash2, Send, Building } from "lucide-react";
import { useTranslation } from 'react-i18next';

const CORRIDORS = [
  { value: "CN", label: "China (CNY)", formMThreshold: 10000 },
  { value: "AE", label: "UAE (AED)", formMThreshold: 10000 },
  { value: "IN", label: "India (INR)", formMThreshold: 10000 },
  { value: "GB", label: "UK (GBP)", formMThreshold: 10000 },
  { value: "US", label: "USA (USD)", formMThreshold: 10000 },
];

interface PaymentRow { id: string; recipientName: string; accountNumber: string; swiftCode: string; bankName: string; amountUsd: number; reference: string; invoiceNumber: string; }

export default function SMETradePayment() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [corridor, setCorridor] = useState("CN");
  const [formMNumber, setFormMNumber] = useState("");
  const [batchRef, setBatchRef] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([{ id: "1", recipientName: "", accountNumber: "", swiftCode: "", bankName: "", amountUsd: 5000, reference: "", invoiceNumber: "" }]);

  const { data: rates } = trpc.smeTrade.getSmeCorridorRates.useQuery();
  const { data: history, refetch } = trpc.smeTrade.getBatchHistory.useQuery({ limit: 10 });

  const submitBatch = trpc.smeTrade.submitBatch.useMutation({
    onSuccess: (d) => { toast.success(`Batch submitted! ID: ${(d as any).batchId}`); refetch(); setPayments([{ id: "1", recipientName: "", accountNumber: "", swiftCode: "", bankName: "", amountUsd: 5000, reference: "", invoiceNumber: "" }]); setFormMNumber(""); },
    onError: (e) => toast.error(e.message),
  });

  const totalUsd = payments.reduce((sum, p) => sum + (p.amountUsd || 0), 0);
  const selectedCorridor = CORRIDORS.find(c => c.value === corridor);
  const needsFormM = totalUsd >= (selectedCorridor?.formMThreshold ?? 10000);
  const corridorRate = (rates as any)?.[corridor];

  const addRow = () => setPayments([...payments, { id: String(Date.now()), recipientName: "", accountNumber: "", swiftCode: "", bankName: "", amountUsd: 1000, reference: "", invoiceNumber: "" }]);
  const removeRow = (id: string) => setPayments(payments.filter(p => p.id !== id));
  const updateRow = (id: string, field: keyof PaymentRow, value: string | number) => setPayments(payments.map(p => p.id === id ? { ...p, [field]: value } : p));

  const handleSubmit = () => {
    if (!user) { toast.error("Please log in"); return; }
    if (needsFormM && !formMNumber) { toast.error("Form M number required for transfers over $10,000"); return; }
    if (payments.some(p => !p.recipientName || !p.accountNumber)) { toast.error("Fill all payment rows"); return; }
    submitBatch.mutate({ corridorCode: corridor, payments: payments.map(p => ({ recipientName: p.recipientName, recipientAccount: p.accountNumber, recipientSwift: p.swiftCode, recipientBank: p.bankName, amountUsd: p.amountUsd, reference: p.reference, invoiceNumber: p.invoiceNumber || undefined })), formMNumber: formMNumber || undefined, batchReference: batchRef || undefined });
  };

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Building className="h-8 w-8 text-primary" />
        <div><h1 className="text-2xl font-bold">SME Trade Payments</h1><p className="text-muted-foreground">Bulk international trade payment batches with Form M compliance</p></div>
      </div>

      {/* Corridor & Rate */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2"><Label>Trade Corridor</Label><Select value={corridor} onValueChange={setCorridor}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CORRIDORS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Batch Reference (optional)</Label><Input value={batchRef} onChange={(e) => setBatchRef(e.target.value)} placeholder="e.g. IMPORT-2026-001" /></div>
            {corridorRate && <div className="text-sm"><p className="text-muted-foreground">Exchange Rate</p><p className="font-bold text-lg">₦1 = {corridorRate.rate?.toFixed(4)} {corridorRate.currency}</p><p className="text-xs text-muted-foreground">Spread: {corridorRate.spread_bps} bps</p></div>}
          </div>
        </CardContent>
      </Card>

      {/* Form M Alert */}
      {needsFormM && (
        <Alert><AlertDescription className="flex items-center gap-3">
          <span>Total exceeds $10,000 — Form M number required by CBN.</span>
          <Input className="w-48" value={formMNumber} onChange={(e) => setFormMNumber(e.target.value)} placeholder="Form M number" />
        </AlertDescription></Alert>
      )}

      {/* Payment Rows */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>Payment Batch</CardTitle><CardDescription>{payments.length} payment{payments.length !== 1 ? "s" : ""} — Total: ${totalUsd.toLocaleString()}</CardDescription></div>
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />Add Row</Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Recipient Name</TableHead><TableHead>Account / IBAN</TableHead><TableHead>SWIFT/BIC</TableHead><TableHead>Bank</TableHead><TableHead>Amount (USD)</TableHead><TableHead>Invoice #</TableHead><TableHead>Reference</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><Input value={p.recipientName} onChange={(e) => updateRow(p.id, "recipientName", e.target.value)} placeholder="Company name" className="min-w-[140px]" /></TableCell>
                    <TableCell><Input value={p.accountNumber} onChange={(e) => updateRow(p.id, "accountNumber", e.target.value)} placeholder="Account/IBAN" className="min-w-[160px]" /></TableCell>
                    <TableCell><Input value={p.swiftCode} onChange={(e) => updateRow(p.id, "swiftCode", e.target.value)} placeholder="SWIFT" className="min-w-[100px]" /></TableCell>
                    <TableCell><Input value={p.bankName} onChange={(e) => updateRow(p.id, "bankName", e.target.value)} placeholder="Bank name" className="min-w-[120px]" /></TableCell>
                    <TableCell><Input type="number" min={1} value={p.amountUsd} onChange={(e) => updateRow(p.id, "amountUsd", Number(e.target.value))} className="min-w-[100px]" /></TableCell>
                    <TableCell><Input value={p.invoiceNumber} onChange={(e) => updateRow(p.id, "invoiceNumber", e.target.value)} placeholder="INV-001" className="min-w-[100px]" /></TableCell>
                    <TableCell><Input value={p.reference} onChange={(e) => updateRow(p.id, "reference", e.target.value)} placeholder="Reference" className="min-w-[120px]" /></TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={() => removeRow(p.id)} disabled={payments.length === 1}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button className="mt-4" disabled={submitBatch.isPending} onClick={handleSubmit}>{submitBatch.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}Submit Batch (${totalUsd.toLocaleString()})</Button>
        </CardContent>
      </Card>

      {/* Batch History */}
      <Card>
        <CardHeader><CardTitle>Batch History</CardTitle></CardHeader>
        <CardContent>
          {!history || (history as any[]).length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">No batches submitted yet</p> : (
            <Table><TableHeader><TableRow><TableHead>Batch ID</TableHead><TableHead>Corridor</TableHead><TableHead>Payments</TableHead><TableHead>Total (USD)</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>{(history as any[]).map((b) => (
              <TableRow key={b.batchId}><TableCell className="font-mono text-xs">{b.batchId.slice(0, 8)}...</TableCell><TableCell>{b.corridorCode}</TableCell><TableCell>{b.totalPayments}</TableCell><TableCell>${parseFloat(b.totalAmountUsd ?? 0).toLocaleString()}</TableCell><TableCell><Badge variant={b.status === "completed" ? "default" : b.status === "failed" ? "destructive" : "secondary"}>{b.status}</Badge></TableCell><TableCell>{new Date(b.createdAt).toLocaleDateString()}</TableCell></TableRow>
            ))}</TableBody></Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
