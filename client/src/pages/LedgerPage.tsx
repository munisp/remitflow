import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, ArrowRightLeft, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function LedgerPage() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [debitAccount, setDebitAccount] = useState("");
  const [creditAccount, setCreditAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");

  const { data: entries, isLoading } = trpc.ledger.entries.useQuery({ limit: 50 });
  const { data: reconciliation } = trpc.ledger.reconciliation.useQuery();

  const doubleEntryMutation = trpc.ledger.doubleEntry.useMutation({
    onSuccess: () => {
      toast.success("Double-entry recorded successfully");
      utils.ledger.entries.invalidate();
      utils.ledger.reconciliation.invalidate();
      setDebitAccount(""); setCreditAccount(""); setAmount(""); setDescription("");
    },
    onError: (e) => toast.error(e.message),
  });

  const handlePost = () => {
    if (!debitAccount || !creditAccount || !amount) {
      toast.error("Please fill all required fields");
      return;
    }
    doubleEntryMutation.mutate({
      debitAccount,
      creditAccount,
      amount: parseFloat(amount),
      currency,
      description,
      reference: `REF-${Date.now()}`,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-blue-500" />
            Double-Entry Ledger
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Full accounting ledger with double-entry bookkeeping and reconciliation
          </p>
        </div>

        <Tabs defaultValue="entries">
          <TabsList>
            <TabsTrigger value="entries">Ledger Entries</TabsTrigger>
            <TabsTrigger value="post">Post Entry</TabsTrigger>
            <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          </TabsList>

          <TabsContent value="entries" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  Recent Ledger Entries
                  <Button variant="outline" size="sm" onClick={() => utils.ledger.entries.invalidate()}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading entries…</div>
                ) : !entries?.length ? (
                  <div className="text-center py-8 text-muted-foreground">No ledger entries yet</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Debit Account</TableHead>
                        <TableHead>Credit Account</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(entries as any[]).map((e: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{new Date(e.created_at || e.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell className="font-mono text-xs">{e.debit_account || e.debitAccount}</TableCell>
                          <TableCell className="font-mono text-xs">{e.credit_account || e.creditAccount}</TableCell>
                          <TableCell className="text-right font-semibold">{parseFloat(e.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>{e.currency}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{e.description}</TableCell>
                          <TableCell>
                            <Badge variant={e.status === "posted" ? "default" : "secondary"} className="text-xs">
                              {e.status || "posted"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="post" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-blue-500" />
                  Post Double-Entry Transaction
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Debit Account *</Label>
                    <Input
                      placeholder="e.g. assets:cash:usd"
                      value={debitAccount}
                      onChange={(e) => setDebitAccount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Credit Account *</Label>
                    <Input
                      placeholder="e.g. liabilities:user-wallets"
                      value={creditAccount}
                      onChange={(e) => setCreditAccount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount *</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Input
                      placeholder="USD"
                      maxLength={3}
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label>Description</Label>
                    <Input
                      placeholder="Transaction description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                  <p className="font-medium text-muted-foreground">Preview</p>
                  <p>DR {debitAccount || "—"} &nbsp;&nbsp; {amount || "0.00"} {currency}</p>
                  <p>CR {creditAccount || "—"} &nbsp;&nbsp; {amount || "0.00"} {currency}</p>
                </div>
                <Button onClick={handlePost} disabled={doubleEntryMutation.isPending} className="w-full">
                  {doubleEntryMutation.isPending ? "Posting…" : "Post Entry"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reconciliation" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Account Reconciliation
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!reconciliation?.length ? (
                  <div className="text-center py-8 text-muted-foreground">No reconciliation data available</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Ledger Balance</TableHead>
                        <TableHead className="text-right">System Balance</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(reconciliation as any[]).map((r: any, i: number) => {
                        const variance = Math.abs((r.ledger_balance || 0) - (r.system_balance || 0));
                        const isBalanced = variance < 0.01;
                        return (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{r.account}</TableCell>
                            <TableCell className="text-right">{parseFloat(r.ledger_balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-right">{parseFloat(r.system_balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-right">{variance.toFixed(2)}</TableCell>
                            <TableCell>
                              {isBalanced ? (
                                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Balanced
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" /> Variance
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
