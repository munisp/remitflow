import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileCheck, Globe, Shield, Plus, AlertCircle, CheckCircle } from "lucide-react";

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR"];
const LC_TYPES: Array<"sight" | "usance" | "standby" | "revolving"> = ["sight", "usance", "standby", "revolving"];
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-yellow-100 text-yellow-700",
  issued: "bg-blue-100 text-blue-700",
  advised: "bg-purple-100 text-purple-700",
  documents_presented: "bg-amber-100 text-amber-700",
  documents_checked: "bg-green-100 text-green-700",
  payment_authorised: "bg-emerald-100 text-emerald-700",
  settled: "bg-green-100 text-green-700",
  expired: "bg-gray-100 text-gray-500",
  cancelled: "bg-red-100 text-red-700",
};

export default function LetterOfCredit() {
  const [openLCDialog, setOpenLCDialog] = useState(false);
  const [selectedLcId, setSelectedLcId] = useState<number | null>(null);
  const [form, setForm] = useState({
    lcType: "sight" as "sight" | "usance" | "standby" | "revolving",
    amountUsd: "", currency: "USD",
    beneficiaryName: "", beneficiaryCountry: "NG",
    beneficiaryBank: "", expiryDate: "",
    description: "",
  });

  const utils = trpc.useUtils();
  const { data: lcs, isLoading } = trpc.letterOfCredit.list.useQuery({});

  // open: { beneficiaryName, beneficiaryCountry, lcType, currency, amountUsd, expiryDate, description?, requiredDocuments? }
  const openLC = trpc.letterOfCredit.open.useMutation({
    onSuccess: () => {
      toast("LC Opened", { description: "Letter of Credit created and pending submission." });
      utils.letterOfCredit.list.invalidate();
      setOpenLCDialog(false);
      setForm({ lcType: "sight", amountUsd: "", currency: "USD", beneficiaryName: "", beneficiaryCountry: "NG", beneficiaryBank: "", expiryDate: "", description: "" });
    },
    onError: (e) => toast.error("LC creation failed", { description: e.message }),
  });

  // uploadDocument: { lcId, documentType, documentUrl }
  const uploadDocument = trpc.letterOfCredit.uploadDocument.useMutation({
    onSuccess: () => {
      toast("Document uploaded", { description: "Document submitted for examination under UCP 600." });
      utils.letterOfCredit.list.invalidate();
      setSelectedLcId(null);
    },
    onError: (e) => toast.error("Upload failed", { description: e.message }),
  });

  const activeLcs = lcs?.filter((lc: any) => ["issued", "advised", "documents_presented"].includes(lc.status)) ?? [];
  const totalValue = lcs?.reduce((sum: number, lc: any) => sum + parseFloat(lc.amountUsd ?? 0), 0) ?? 0;
  const pendingDocs = lcs?.filter((lc: any) => lc.status === "issued" || lc.status === "advised").length ?? 0;
  const settled = lcs?.filter((lc: any) => lc.status === "settled").length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Letter of Credit</h1>
          <p className="text-muted-foreground text-sm mt-1">Issue and manage trade finance LCs — UCP 600 compliant, multi-currency</p>
        </div>
        <Dialog open={openLCDialog} onOpenChange={setOpenLCDialog}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Open New LC</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Open Letter of Credit</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2 max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <Label className="text-xs">LC Type</Label>
                <Select value={form.lcType} onValueChange={v => setForm(f => ({ ...f, lcType: v as typeof form.lcType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Amount (USD)</Label>
                <Input type="number" placeholder="100000" value={form.amountUsd}
                  onChange={e => setForm(f => ({ ...f, amountUsd: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Expiry Date</Label>
                <Input type="date" value={form.expiryDate}
                  onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Beneficiary Name</Label>
                <Input placeholder="Supplier Co. Ltd" value={form.beneficiaryName}
                  onChange={e => setForm(f => ({ ...f, beneficiaryName: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Beneficiary Country (2-letter)</Label>
                <Input placeholder="CN" maxLength={2} value={form.beneficiaryCountry}
                  onChange={e => setForm(f => ({ ...f, beneficiaryCountry: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <Label className="text-xs">Beneficiary Bank (optional)</Label>
                <Input placeholder="Bank of China" value={form.beneficiaryBank}
                  onChange={e => setForm(f => ({ ...f, beneficiaryBank: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Goods Description</Label>
                <Input placeholder="500 MT of refined palm oil in bulk" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full mt-4"
              onClick={() => openLC.mutate({
                lcType: form.lcType,
                beneficiaryName: form.beneficiaryName,
                beneficiaryCountry: form.beneficiaryCountry,
                beneficiaryBank: form.beneficiaryBank || undefined,
                currency: form.currency,
                amountUsd: parseFloat(form.amountUsd) || 0,
                expiryDate: form.expiryDate,
                description: form.description || undefined,
                requiredDocuments: ["commercial_invoice", "bill_of_lading", "packing_list"],
              })}
              disabled={openLC.isPending || !form.beneficiaryName || !form.amountUsd || !form.expiryDate}>
              {openLC.isPending ? "Opening..." : "Open LC"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active LCs", value: String(activeLcs.length), icon: FileCheck, color: "text-blue-600" },
          { label: "Total Value", value: `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: Globe, color: "text-green-600" },
          { label: "Pending Documents", value: String(pendingDocs), icon: AlertCircle, color: "text-amber-600" },
          { label: "Settled", value: String(settled), icon: CheckCircle, color: "text-emerald-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted"><Icon className={`w-5 h-5 ${color}`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Letters of Credit</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : !lcs?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No LCs yet. Open your first LC to secure international trade.</p>
            </div>
          ) : (
            <div className="divide-y">
              {lcs?.map((lc: any) => (
                <div key={lc.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{lc.lcRef ?? `LC #${lc.id}`}</p>
                    <p className="text-xs text-muted-foreground">{lc.beneficiaryName} · {lc.lcType} · Exp {lc.expiryDate ? new Date(lc.expiryDate).toLocaleDateString() : "—"}</p>
                  </div>
                  <p className="font-semibold text-sm">{lc.currency} {Number(lc.amountUsd ?? 0).toLocaleString()}</p>
                  <Badge className={`text-xs ${STATUS_COLORS[lc.status] ?? ""}`}>{lc.status.replace(/_/g, " ")}</Badge>
                  {["issued", "advised"].includes(lc.status) && (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => uploadDocument.mutate({
                        lcId: lc.id,
                        documentType: "commercial_invoice",
                        documentUrl: "https://placeholder.remitflow.com/doc.pdf",
                      })}
                      disabled={uploadDocument.isPending}>
                      Upload Docs
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
