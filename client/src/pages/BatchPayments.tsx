import { useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Layers, Plus, Trash2, Upload, CheckCircle2, Clock, XCircle, FileText, Play, Eye, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  processing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  draft: "bg-muted text-muted-foreground",
};

const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "ZAR", "CAD"];
const CSV_TEMPLATE = "name,account,amount,currency,bank\nAmara Okafor,0123456789,50000,NGN,Access Bank\nKwame Mensah,1234567890,200,USD,Chase\nFatima Al-Rashid,2345678901,150,GBP,Barclays";

export default function BatchPayments() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { data: batches = [], isLoading } = trpc.batch.list.useQuery();
  const createMutation = trpc.batch.create.useMutation({
    onSuccess: () => { toast.success("Batch created! Click Process to execute."); utils.batch.list.invalidate(); setName(""); setRows([{ account: "", amount: "", currency: "NGN", name: "" }]); },
    onError: (e: any) => toast.error(e.message),
  });
  const processMutation = trpc.batch.process.useMutation({
    onSuccess: () => { toast.success("Batch processing started"); utils.batch.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [name, setName] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("NGN");
  const [rows, setRows] = useState([{ name: "", account: "", amount: "", currency: "NGN" }]);
  const [viewBatch, setViewBatch] = useState<any>(null);
  const [csvError, setCsvError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const addRow = () => setRows(p => [...p, { name: "", account: "", amount: "", currency: defaultCurrency }]);
  const removeRow = (i: number) => setRows(p => p.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, value: string) =>
    setRows(p => p.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const validRows = rows.filter(r => r.account && r.amount && parseFloat(r.amount) > 0);

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.trim().split("\n").filter(Boolean);
        if (lines.length < 2) { setCsvError("CSV must have a header row and at least one data row"); return; }
        const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
        const nameIdx = headers.indexOf("name");
        const accountIdx = headers.indexOf("account");
        const amountIdx = headers.indexOf("amount");
        const currencyIdx = headers.indexOf("currency");
        if (accountIdx === -1 || amountIdx === -1) { setCsvError("CSV must have 'account' and 'amount' columns"); return; }
        const parsed = lines.slice(1).map(line => {
          const cols = line.split(",").map(c => c.trim());
          return {
            name: nameIdx >= 0 ? (cols[nameIdx] ?? "") : "",
            account: cols[accountIdx] ?? "",
            amount: cols[amountIdx] ?? "",
            currency: currencyIdx >= 0 ? (cols[currencyIdx] ?? defaultCurrency) : defaultCurrency,
          };
        }).filter(r => r.account && r.amount);
        if (parsed.length === 0) { setCsvError("No valid rows found in CSV"); return; }
        setRows(parsed);
        toast.success(`Loaded ${parsed.length} recipients from CSV`);
      } catch {
        setCsvError("Failed to parse CSV. Please check the format.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "batch-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10"><Layers className="h-6 w-6 text-indigo-500" /></div>
            <div>
              <h1 className="text-2xl font-bold">Batch Payments</h1>
              <p className="text-muted-foreground text-sm">Send to multiple recipients in one operation</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-bold text-2xl">{(batches as any[]).length}</div>
            <div className="text-muted-foreground text-xs">total batches</div>
          </div>
        </div>

        <Tabs defaultValue="manual">
          <TabsList className="w-full">
            <TabsTrigger value="manual" className="flex-1">Manual Entry</TabsTrigger>
            <TabsTrigger value="csv" className="flex-1">CSV Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New Batch Payment</CardTitle>
                <CardDescription>Add recipients manually, one row at a time</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Batch Name</Label>
                    <Input placeholder="e.g. March Salaries" value={name} onChange={e => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Default Currency</Label>
                    <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground px-1">
                    <span className="col-span-3">Name</span>
                    <span className="col-span-4">Account / Phone</span>
                    <span className="col-span-2">Amount</span>
                    <span className="col-span-2">CCY</span>
                    <span className="col-span-1"></span>
                  </div>
                  {rows.map((row, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-3 h-8 text-sm" placeholder="Name" value={row.name} onChange={e => updateRow(i, "name", e.target.value)} />
                      <Input className="col-span-4 h-8 text-sm" placeholder="Account" value={row.account} onChange={e => updateRow(i, "account", e.target.value)} />
                      <Input className="col-span-2 h-8 text-sm" type="number" placeholder="0" value={row.amount} onChange={e => updateRow(i, "amount", e.target.value)} />
                      <Select value={row.currency} onValueChange={v => updateRow(i, "currency", v)}>
                        <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8 text-destructive" onClick={() => removeRow(i)} disabled={rows.length === 1}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />Add Row</Button>
                  <div className="text-sm text-muted-foreground">
                    {validRows.length} valid · Total: <span className="font-bold text-foreground">{total.toLocaleString()} {defaultCurrency}</span>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={!name || validRows.length === 0 || createMutation.isPending}
                  onClick={() => createMutation.mutate({
                    name, currency: defaultCurrency,
                    recipients: validRows.map(r => ({ name: r.name || r.account, account: r.account, amount: parseFloat(r.amount) })),
                  })}
                >
                  {createMutation.isPending ? "Creating..." : `Create Batch (${validRows.length} payments)`}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="csv" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" />Upload CSV</CardTitle>
                <CardDescription>Columns: name, account, amount, currency (header row required)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="w-3 h-3 mr-1" />Download Template</Button>
                  <Button size="sm" onClick={() => fileRef.current?.click()}><Upload className="w-3 h-3 mr-1" />Choose CSV File</Button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCSVUpload} />
                </div>
                {csvError && (
                  <div className="flex items-center gap-2 text-sm text-destructive p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="w-4 h-4 shrink-0" />{csvError}
                  </div>
                )}
                {rows.length > 1 && (
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{rows.length} recipients loaded</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {rows.map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-muted/40">
                          <span className="font-medium">{r.name || r.account}</span>
                          <span className="text-muted-foreground">{r.account}</span>
                          <span className="font-bold">{parseFloat(r.amount || "0").toLocaleString()} {r.currency}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <Label className="text-xs">Batch Name</Label>
                      <Input placeholder="e.g. Payroll April 2026" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <Button
                      className="w-full"
                      disabled={!name || createMutation.isPending}
                      onClick={() => createMutation.mutate({
                        name, currency: rows[0]?.currency ?? "NGN",
                        recipients: rows.filter(r => r.account && r.amount).map(r => ({ name: r.name || r.account, account: r.account, amount: parseFloat(r.amount) })),
                      })}
                    >
                      {createMutation.isPending ? "Creating..." : `Create Batch (${rows.length} payments)`}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" />Batch History</h2>
          {(batches as any[]).length === 0 && !isLoading ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground"><Layers className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No batches yet.</p></CardContent></Card>
          ) : (
            (batches as any[]).map((b: any) => (
              <Card key={b.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{b.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {b.totalRecipients ?? b.paymentCount ?? 0} recipients · {b.currency} {Number(b.totalAmount).toLocaleString()} · {b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={"text-xs border-0 " + (STATUS_STYLES[b.status] ?? "")}>{b.status}</Badge>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setViewBatch(b)}><Eye className="h-3.5 w-3.5" /></Button>
                      {b.status === "draft" && (
                        <Button size="sm" onClick={() => processMutation.mutate({ id: b.id })} disabled={processMutation.isPending}>
                          <Play className="h-3 w-3 mr-1" />Process
                        </Button>
                      )}
                    </div>
                  </div>
                  {b.status === "processing" && (
                    <div className="mt-3">
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-yellow-500 animate-pulse" style={{ width: "60%" }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Processing payments...</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Dialog open={!!viewBatch} onOpenChange={() => setViewBatch(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{viewBatch?.name}</DialogTitle></DialogHeader>
            {viewBatch && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: "Recipients", value: viewBatch.totalRecipients ?? viewBatch.paymentCount ?? 0 },
                    { label: "Total", value: `${viewBatch.currency} ${Number(viewBatch.totalAmount).toLocaleString()}` },
                    { label: "Status", value: viewBatch.status },
                  ].map(s => (
                    <div key={s.label} className="p-3 rounded-lg bg-muted/40">
                      <div className="font-bold text-sm">{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
                {viewBatch.payments && Array.isArray(viewBatch.payments) && (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {viewBatch.payments.map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-muted/40">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground">{p.account}</span>
                        <span className="font-bold">{Number(p.amount).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
