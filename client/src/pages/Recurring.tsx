import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RefreshCw, Plus, Pause, Play, X, Calendar, Clock, Globe, History, Zap, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["NGN","USD","GBP","EUR","KES","GHS","ZAR","TZS","UGX","RWF","XOF","EGP","MAD","SAR","AED","CNY","INR","CAD","AUD","BRL","MXN"];
const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;
const TIMEZONES = ["UTC","Africa/Lagos","Africa/Nairobi","Africa/Accra","Africa/Johannesburg","Africa/Cairo","Europe/London","Europe/Paris","America/New_York","America/Los_Angeles","Asia/Dubai","Asia/Kolkata","Asia/Singapore","Asia/Tokyo","Australia/Sydney"];
const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  paused: "bg-yellow-100 text-yellow-700 border-yellow-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};
const RUN_STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-gray-100 text-gray-600",
};
type Freq = "daily"|"weekly"|"biweekly"|"monthly"|"quarterly"|"yearly";
type FormState = { name:string; amount:string; currency:string; targetCurrency:string; frequency:Freq; recipientName:string; recipientAccount:string; recipientBank:string; description:string; timezone:string; startDate:string; endDate:string; };
const defaultForm: FormState = { name:"", amount:"", currency:"NGN", targetCurrency:"USD", frequency:"monthly", recipientName:"", recipientAccount:"", recipientBank:"", description:"", timezone:"UTC", startDate:"", endDate:"" };

export default function Recurring() {
  const { t } = useTranslation();
  
  const { data: recurring = [], refetch } = trpc.recurring.list.useQuery();
  const createMutation = trpc.recurring.create.useMutation({ onSuccess: () => { toast.success("Schedule created!"); refetch(); setCreateOpen(false); setForm(defaultForm); }, onError: (e) => toast.error(e.message) });
  const editMutation = trpc.recurring.edit.useMutation({ onSuccess: () => { toast.success("Updated!"); refetch(); setEditOpen(false); }, onError: (e) => toast.error(e.message) });
  const pauseMutation = trpc.recurring.pause.useMutation({ onSuccess: () => { toast.success("Paused"); refetch(); } });
  const resumeMutation = trpc.recurring.resume.useMutation({ onSuccess: () => { toast.success("Resumed"); refetch(); } });
  const cancelMutation = trpc.recurring.cancel.useMutation({ onSuccess: () => { toast.success("Cancelled"); refetch(); setCancelTarget(null); } });
  const runNowMutation = trpc.recurring.runNow.useMutation({ onSuccess: () => { toast.success("Transfer executed!"); refetch(); } });

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [cancelTarget, setCancelTarget] = useState<number|null>(null);
  const [runsTarget, setRunsTarget] = useState<number|null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);

  const { data: runs = [] } = trpc.recurring.runs.useQuery({ scheduleId: runsTarget ?? 0 }, { enabled: runsTarget !== null });

  const active = recurring.filter((r:any) => r.status === "active");
  const paused = recurring.filter((r:any) => r.status === "paused");
  const cancelled = recurring.filter((r:any) => r.status === "cancelled");

  function openEdit(r: any) {
    setEditTarget(r);
    setForm({ name:r.name, amount:String(r.amount), currency:r.currency, targetCurrency:r.targetCurrency??"USD", frequency:r.frequency as Freq, recipientName:r.recipientName??"", recipientAccount:r.recipientAccount??"", recipientBank:r.recipientBank??"", description:r.description??"", timezone:r.timezone??"UTC", startDate:r.startDate?new Date(r.startDate).toISOString().slice(0,10):"", endDate:r.endDate?new Date(r.endDate).toISOString().slice(0,10):"" });
    setEditOpen(true);
  }

  function RecurringCard({ r }: { r: any }) {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <RefreshCw className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{r.name}</p>
                <p className="text-sm text-muted-foreground truncate">{r.recipientName} · {r.recipientBank||"—"}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className={STATUS_COLORS[r.status]}>{r.status}</Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{FREQUENCIES.find(f=>f.value===r.frequency)?.label??r.frequency}</span>
                  {r.timezone&&r.timezone!=="UTC"&&<span className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" />{r.timezone}</span>}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold text-lg">{Number(r.amount).toLocaleString()} {r.currency}</p>
              {r.targetCurrency&&r.targetCurrency!==r.currency&&<p className="text-xs text-muted-foreground">to {r.targetCurrency}</p>}
              {r.nextRunAt&&<p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-end"><Calendar className="h-3 w-3" />Next: {new Date(r.nextRunAt).toLocaleDateString()}</p>}
            </div>
          </div>
          {r.description&&<p className="text-sm text-muted-foreground mt-2">{r.description}</p>}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            <span className="text-xs text-muted-foreground">Runs: {r.executionCount??0}</span>
            {r.lastRunAt&&<span className="text-xs text-muted-foreground">· Last: {new Date(r.lastRunAt).toLocaleDateString()}</span>}
            <div className="flex gap-1 ml-auto">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>setRunsTarget(r.id)}><History className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>openEdit(r)}><Edit2 className="h-3.5 w-3.5" /></Button>
              {r.status==="active"&&<Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>runNowMutation.mutate({id:r.id})} disabled={runNowMutation.isPending}><Zap className="h-3.5 w-3.5 text-yellow-500" /></Button>}
              {r.status==="active"&&<Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>pauseMutation.mutate({id:r.id})}><Pause className="h-3.5 w-3.5" /></Button>}
              {r.status==="paused"&&<Button size="sm" variant="ghost" className="h-7 px-2" onClick={()=>resumeMutation.mutate({id:r.id})}><Play className="h-3.5 w-3.5 text-green-500" /></Button>}
              {r.status!=="cancelled"&&<Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={()=>setCancelTarget(r.id)}><X className="h-3.5 w-3.5" /></Button>}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function TransferForm() {
    return (
      <div className="grid gap-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Schedule Name *</Label><Input placeholder="e.g. Monthly rent to London" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
          <div><Label>Amount *</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} /></div>
          <div><Label>Send Currency</Label><Select value={form.currency} onValueChange={v=>setForm(f=>({...f,currency:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Target Currency</Label><Select value={form.targetCurrency} onValueChange={v=>setForm(f=>({...f,targetCurrency:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Frequency *</Label><Select value={form.frequency} onValueChange={v=>setForm(f=>({...f,frequency:v as Freq}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{FREQUENCIES.map(f=><SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="col-span-2"><Label>Recipient Name *</Label><Input placeholder="Full name" value={form.recipientName} onChange={e=>setForm(f=>({...f,recipientName:e.target.value}))} /></div>
          <div><Label>Account / IBAN</Label><Input placeholder="Account number" value={form.recipientAccount} onChange={e=>setForm(f=>({...f,recipientAccount:e.target.value}))} /></div>
          <div><Label>Bank / BIC</Label><Input placeholder="Bank name or BIC" value={form.recipientBank} onChange={e=>setForm(f=>({...f,recipientBank:e.target.value}))} /></div>
          <div className="col-span-2"><Label>Description (optional)</Label><Input placeholder="Payment reference" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
          <div className="col-span-2"><Label>Timezone</Label><Select value={form.timezone} onValueChange={v=>setForm(f=>({...f,timezone:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map(tz=><SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} /></div>
          <div><Label>End Date (optional)</Label><Input type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} /></div>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold tracking-tight">Scheduled Transfers</h1><p className="text-muted-foreground text-sm">Automate recurring international money transfers</p></div>
          <Button onClick={()=>{setForm(defaultForm);setCreateOpen(true);}}><Plus className="h-4 w-4 mr-2" />New Schedule</Button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{active.length}</p><p className="text-sm text-muted-foreground">Active</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-600">{paused.length}</p><p className="text-sm text-muted-foreground">Paused</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-muted-foreground">{cancelled.length}</p><p className="text-sm text-muted-foreground">Cancelled</p></CardContent></Card>
        </div>
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="paused">Paused ({paused.length})</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled ({cancelled.length})</TabsTrigger>
            <TabsTrigger value="all">All ({recurring.length})</TabsTrigger>
          </TabsList>
          {([{key:"active",items:active},{key:"paused",items:paused},{key:"cancelled",items:cancelled},{key:"all",items:recurring}] as {key:string,items:any[]}[]).map(({key,items})=>(
            <TabsContent key={key} value={key} className="space-y-3 mt-4">
              {items.length===0?(
                <Card><CardContent className="p-8 text-center text-muted-foreground"><RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No {key==="all"?"":key} scheduled transfers</p>{key==="active"&&<Button variant="outline" size="sm" className="mt-3" onClick={()=>{setForm(defaultForm);setCreateOpen(true);}}><Plus className="h-4 w-4 mr-1" />Create your first schedule</Button>}</CardContent></Card>
              ):(items.map((r:any)=><RecurringCard key={r.id} r={r} />))}
            </TabsContent>
          ))}
        </Tabs>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Recurring International Transfer</DialogTitle></DialogHeader>
            <TransferForm />
            <DialogFooter>
              <Button variant="outline" onClick={()=>setCreateOpen(false)}>Cancel</Button>
              <Button disabled={!form.name||!form.amount||!form.recipientName||createMutation.isPending}
                onClick={()=>createMutation.mutate({name:form.name,amount:parseFloat(form.amount),currency:form.currency,targetCurrency:form.targetCurrency,frequency:form.frequency,recipientName:form.recipientName,recipientAccount:form.recipientAccount||undefined,recipientBank:form.recipientBank||undefined,description:form.description||undefined,timezone:form.timezone,startDate:form.startDate||undefined,endDate:form.endDate||undefined})}>
                {createMutation.isPending?"Creating...":"Create Schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Recurring Transfer</DialogTitle></DialogHeader>
            <TransferForm />
            <DialogFooter>
              <Button variant="outline" onClick={()=>setEditOpen(false)}>Cancel</Button>
              <Button disabled={editMutation.isPending}
                onClick={()=>editTarget&&editMutation.mutate({id:editTarget.id,name:form.name,amount:form.amount?parseFloat(form.amount):undefined,currency:form.currency,targetCurrency:form.targetCurrency,frequency:form.frequency,recipientName:form.recipientName,recipientAccount:form.recipientAccount||undefined,recipientBank:form.recipientBank||undefined,description:form.description||undefined,timezone:form.timezone,endDate:form.endDate||undefined})}>
                {editMutation.isPending?"Saving...":"Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={cancelTarget!==null} onOpenChange={open=>!open&&setCancelTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Cancel Recurring Transfer?</AlertDialogTitle><AlertDialogDescription>This will permanently stop the scheduled transfer. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Active</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={()=>cancelTarget&&cancelMutation.mutate({id:cancelTarget})}>Cancel Transfer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={runsTarget!==null} onOpenChange={open=>!open&&setRunsTarget(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Execution History</DialogTitle></DialogHeader>
            {runs.length===0?(
              <div className="py-8 text-center text-muted-foreground"><History className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No executions yet</p></div>
            ):(
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>FX Rate</TableHead><TableHead>Status</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
                <TableBody>
                  {runs.map((run:any)=>(
                    <TableRow key={run.id}>
                      <TableCell className="text-sm">{new Date(run.executedAt).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{Number(run.amount ?? 0).toLocaleString()} {run.currency}</TableCell>
                      <TableCell className="text-sm">{run.fxRate?Number(run.fxRate).toFixed(4):"—"}</TableCell>
                      <TableCell><Badge className={RUN_STATUS_COLORS[run.status]}>{run.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{run.errorMessage??"—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
