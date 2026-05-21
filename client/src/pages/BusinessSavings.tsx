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
import { PiggyBank, TrendingUp, Unlock, Plus, DollarSign } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function BusinessSavings() {
  const { t } = useTranslation();
  const [openAccountDialog, setOpenAccountDialog] = useState(false);
  const [accountForm, setAccountForm] = useState({
    productId: "", principalUsd: "",
  });

  const utils = trpc.useUtils();
  // listProducts: void query
  const { data: products, isLoading: loadingProducts } = trpc.businessSavings.listProducts.useQuery();
  // listAccounts: optional companyId
  const { data: accounts, isLoading: loadingAccounts } = trpc.businessSavings.listAccounts.useQuery({});

  // openAccount: { companyId, productId, principalUsd, autoRenew? }
  const openSavingsAccount = trpc.businessSavings.openAccount.useMutation({
    onSuccess: () => {
      toast("Account opened", { description: "Business savings account opened. Interest accrues daily." });
      utils.businessSavings.listAccounts.invalidate();
      setOpenAccountDialog(false);
      setAccountForm({ productId: "", principalUsd: "" });
    },
    onError: (e) => toast.error("Failed", { description: e.message }),
  });

  // withdraw: { accountId, amountUsd }
  const withdrawFunds = trpc.businessSavings.withdraw.useMutation({
    onSuccess: () => {
      toast("Withdrawal processed", { description: "Funds transferred to your operating account." });
      utils.businessSavings.listAccounts.invalidate();
    },
    onError: (e) => toast.error("Withdrawal failed", { description: e.message }),
  });

  const totalBalance = accounts?.reduce((sum: number, a: any) => sum + parseFloat(a.currentBalanceUsd ?? 0), 0) ?? 0;
  const totalInterest = accounts?.reduce((sum: number, a: any) => sum + parseFloat(a.accruedInterestUsd ?? 0), 0) ?? 0;
  const activeCount = accounts?.filter((a: any) => a.status === "active").length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Business Savings</h1>
          <p className="text-muted-foreground text-sm mt-1">Fixed deposits, call accounts, and treasury bills — earn yield on idle business cash</p>
        </div>
        <Dialog open={openAccountDialog} onOpenChange={setOpenAccountDialog}>
          <DialogTrigger asChild>
            <Button><PiggyBank className="w-4 h-4 mr-2" />Open Account</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Open Savings Account</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">Select Product</Label>
                <Select value={accountForm.productId} onValueChange={v => setAccountForm(f => ({ ...f, productId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choose a savings product" /></SelectTrigger>
                  <SelectContent>
                    {products?.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} — {Number(p.annualRatePct ?? 0).toFixed(2)}% p.a.
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Initial Deposit (USD)</Label>
                <Input type="number" placeholder="5000" value={accountForm.principalUsd}
                  onChange={e => setAccountForm(f => ({ ...f, principalUsd: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full mt-4"
              onClick={() => openSavingsAccount.mutate({
                companyId: 1,
                productId: Number(accountForm.productId),
                principalUsd: parseFloat(accountForm.principalUsd) || 0,
              })}
              disabled={openSavingsAccount.isPending || !accountForm.productId || !accountForm.principalUsd}>
              {openSavingsAccount.isPending ? "Opening..." : "Open Account"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Saved", value: `$${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: PiggyBank, color: "text-blue-600" },
          { label: "Interest Earned", value: `$${totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: "text-green-600" },
          { label: "Active Accounts", value: String(activeCount), icon: DollarSign, color: "text-purple-600" },
          { label: "Products Available", value: String(products?.length ?? 0), icon: Plus, color: "text-emerald-600" },
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

      {/* Products */}
      <Card>
        <CardHeader><CardTitle className="text-base">Available Products</CardTitle></CardHeader>
        <CardContent>
          {loadingProducts ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1,2,3].map(i => <div key={i} className="h-28 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !products?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No savings products available yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {products?.map((p: any) => (
                <div key={p.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <Badge variant="outline" className="text-xs capitalize">{p.productType?.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="text-2xl font-bold text-green-600">
                    {Number(p.annualRatePct ?? 0).toFixed(2)}%
                    <span className="text-xs text-muted-foreground font-normal"> p.a.</span>
                  </p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Term: {p.termDays ?? "Flexible"} days</p>
                    <p>Min: ${Number(p.minDepositUsd ?? 0).toLocaleString()} · Max: ${Number(p.maxDepositUsd ?? 0).toLocaleString()}</p>
                  </div>
                  <Button size="sm" className="w-full h-7 text-xs mt-2"
                    onClick={() => { setAccountForm(f => ({ ...f, productId: String(p.id) })); setOpenAccountDialog(true); }}>
                    Open Account
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accounts */}
      <Card>
        <CardHeader><CardTitle className="text-base">My Savings Accounts</CardTitle></CardHeader>
        <CardContent>
          {loadingAccounts ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : !accounts?.length ? (
            <div className="text-center py-10 text-muted-foreground">
              <PiggyBank className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No savings accounts yet. Open an account to start earning yield.</p>
            </div>
          ) : (
            <div className="divide-y">
              {accounts?.map((a: any) => (
                <div key={a.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">Account #{a.id}</p>
                    <p className="text-xs text-muted-foreground">
                      Opened {new Date(a.createdAt).toLocaleDateString()} ·
                      {a.maturityDate ? ` Matures ${new Date(a.maturityDate).toLocaleDateString()}` : " No fixed maturity"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">${Number(a.currentBalanceUsd ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-green-600">+${Number(a.accruedInterestUsd ?? 0).toLocaleString()} interest</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{a.status}</Badge>
                  {a.status === "active" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => withdrawFunds.mutate({
                        accountId: a.id,
                        amountUsd: parseFloat(a.currentBalanceUsd) || 0,
                      })}
                      disabled={withdrawFunds.isPending}>
                      <Unlock className="w-3 h-3 mr-1" />Withdraw
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
