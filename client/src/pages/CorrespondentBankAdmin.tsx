import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus, RefreshCw, Building2, ShieldAlert } from "lucide-react";

export default function CorrespondentBankAdmin() {
  const { user } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [newBank, setNewBank] = useState({ bankName: "", swiftCode: "", countryCode: "", currency: "USD", clearingLineUsd: 10000000, feeBps: 50, settlementRail: "swift" });

  const { data: correspondents, refetch } = trpc.correspondentBank.getCorrespondents.useQuery();
  const { data: balances } = trpc.correspondentBank.getCorrespondentBalances.useQuery();
  const { data: analytics } = trpc.correspondentBank.getCorrespondentAnalytics.useQuery();

  const addCorrespondent = trpc.correspondentBank.addCorrespondent.useMutation({
    onSuccess: () => { toast.success("Correspondent bank added"); setAddOpen(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const updateStatus = trpc.correspondentBank.updateCorrespondentStatus.useMutation({
    onSuccess: () => { toast.success("Status updated"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const triggerRebalance = trpc.correspondentBank.triggerRebalance.useMutation({
    onSuccess: () => toast.success("Rebalance triggered"),
    onError: (e) => toast.error(e.message),
  });

  if ((user as any)?.role !== "admin") {
    return (
      <div className="container max-w-2xl py-16 text-center">
        <ShieldAlert className="h-16 w-16 text-destructive mx-auto mb-4" />
        <h1 className="text-2xl font-bold">Admin Access Required</h1>
        <p className="text-muted-foreground mt-2">This page is restricted to platform administrators.</p>
      </div>
    );
  }

  const totalClearingLine = (correspondents as any[] ?? []).reduce((sum: number, c: any) => sum + parseFloat(c.clearingLineUsd ?? 0), 0);
  const totalNostro = (correspondents as any[] ?? []).reduce((sum: number, c: any) => sum + parseFloat(c.nostroBalanceUsd ?? 0), 0);
  const avgFee = (correspondents as any[] ?? []).length > 0 ? (correspondents as any[]).reduce((sum: number, c: any) => sum + parseFloat(c.feeBps ?? 0), 0) / (correspondents as any[]).length : 0;

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Building2 className="h-8 w-8 text-primary" /><div><h1 className="text-2xl font-bold">Correspondent Banks</h1><p className="text-muted-foreground">Manage clearing lines, nostro balances, and settlement rails</p></div></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Correspondent</Button></DialogTrigger>
            <DialogContent><DialogHeader><DialogTitle>Add Correspondent Bank</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label>Bank Name</Label><Input value={newBank.bankName} onChange={(e) => setNewBank({...newBank, bankName: e.target.value})} placeholder="e.g. Standard Chartered" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>SWIFT Code</Label><Input value={newBank.swiftCode} onChange={(e) => setNewBank({...newBank, swiftCode: e.target.value})} placeholder="SCBLGB2L" /></div>
                  <div className="space-y-2"><Label>Country</Label><Input value={newBank.countryCode} onChange={(e) => setNewBank({...newBank, countryCode: e.target.value})} placeholder="GB" maxLength={2} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Currency</Label><Select value={newBank.currency} onValueChange={(v) => setNewBank({...newBank, currency: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="GBP">GBP</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="AED">AED</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label>Fee (bps)</Label><Input type="number" value={newBank.feeBps} onChange={(e) => setNewBank({...newBank, feeBps: Number(e.target.value)})} /></div>
                </div>
                <div className="space-y-2"><Label>Clearing Line (USD)</Label><Input type="number" value={newBank.clearingLineUsd} onChange={(e) => setNewBank({...newBank, clearingLineUsd: Number(e.target.value)})} /></div>
                <div className="space-y-2"><Label>Settlement Rail</Label><Select value={newBank.settlementRail} onValueChange={(v) => setNewBank({...newBank, settlementRail: (v as "mojaloop" | "swift" | "sepa" | "ach" | "rtgs") as "mojaloop" | "swift" | "sepa" | "ach" | "rtgs"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="swift">SWIFT</SelectItem><SelectItem value="sepa">SEPA</SelectItem><SelectItem value="ach">ACH</SelectItem><SelectItem value="mojaloop">Mojaloop</SelectItem></SelectContent></Select></div>
                <Button className="w-full" disabled={addCorrespondent.isPending} onClick={() => addCorrespondent.mutate(newBank as any)}>{addCorrespondent.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Add Bank</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Correspondents</p><p className="text-2xl font-bold">{(correspondents as any[] ?? []).length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Clearing Line</p><p className="text-2xl font-bold">${(totalClearingLine / 1e6).toFixed(1)}M</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Nostro Balance</p><p className="text-2xl font-bold">${(totalNostro / 1e6).toFixed(1)}M</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Avg Fee</p><p className="text-2xl font-bold">{avgFee.toFixed(0)} bps</p></CardContent></Card>
      </div>

      {/* Correspondents Table */}
      <Card>
        <CardHeader><CardTitle>Correspondent Banks</CardTitle></CardHeader>
        <CardContent>
          {!correspondents || (correspondents as any[]).length === 0 ? (
            <Alert><AlertDescription>No correspondent banks configured. Add your first correspondent to enable SWIFT routing.</AlertDescription></Alert>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Bank</TableHead><TableHead>SWIFT</TableHead><TableHead>Country</TableHead><TableHead>Currency</TableHead><TableHead>Clearing Line</TableHead><TableHead>Nostro Bal.</TableHead><TableHead>Util %</TableHead><TableHead>Fee bps</TableHead><TableHead>Rail</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(correspondents as any[]).map((c) => (
                    <TableRow key={c.correspondentId}>
                      <TableCell className="font-medium">{c.bankName}</TableCell>
                      <TableCell className="font-mono text-xs">{c.swiftCode}</TableCell>
                      <TableCell>{c.countryCode}</TableCell>
                      <TableCell>{c.currency}</TableCell>
                      <TableCell>${parseFloat(c.clearingLineUsd ?? 0).toLocaleString()}</TableCell>
                      <TableCell>${parseFloat(c.nostroBalanceUsd ?? 0).toLocaleString()}</TableCell>
                      <TableCell>{parseFloat(c.utilizationPct ?? 0).toFixed(1)}%</TableCell>
                      <TableCell>{c.feeBps}</TableCell>
                      <TableCell><Badge variant="outline">{c.settlementRail}</Badge></TableCell>
                      <TableCell><Badge variant={c.status === "active" ? "default" : "destructive"}>{c.status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ correspondentId: c.correspondentId, status: c.status === "active" ? "suspended" : "active" })}>{c.status === "active" ? "Suspend" : "Activate"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => triggerRebalance.mutate({ correspondentId: String(c.correspondentId), currency: "USD", amount: 0, direction: "nostro_top_up" as const })}><RefreshCw className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
