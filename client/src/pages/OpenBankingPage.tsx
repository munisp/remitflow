import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, CheckCircle, AlertCircle, RefreshCw, Link } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

export default function OpenBankingPage() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { data, refetch } = trpc.v90.openBanking.getConnectedAccounts.useQuery();
  const consentMutation = trpc.v90.openBanking.initiateConsent.useMutation({
    onSuccess: (d) => {
      toast.success(`Consent initiated: ${d.consentId}`);
      window.open(d.authorisationUrl, "_blank");
    },
    onError: () => toast.error("Consent initiation failed"),
  });
  const txQuery = trpc.v90.openBanking.getAccountTransactions.useQuery(
    { accountId: selectedAccountId!, limit: 10 },
    { enabled: !!selectedAccountId }
  );

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Open Banking (PSD2)</h1>
        <p className="text-muted-foreground text-sm">Open Banking API v{data?.openBankingVersion ?? "3.1.10"} — connect bank accounts for instant verification and payment initiation</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Link className="w-5 h-5" />Connect a New Bank</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(data?.supportedBanks ?? ["Barclays", "HSBC", "Lloyds", "NatWest", "Santander", "Monzo", "Starling", "Revolut"]).map(b => (
              <Button key={b} variant="outline" size="sm" onClick={() => consentMutation.mutate({
                bankId: b.toLowerCase().replace(/\s+/g, "_"), permissions: ["ReadBalances", "ReadTransactions"],
                expirationDays: 90,
              })} disabled={consentMutation.isPending}>
                <Building2 className="w-3 h-3 mr-1" />{b}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Connected Accounts ({data?.connectedAccounts.length ?? 0})</CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          {!data?.connectedAccounts.length ? (
            <p className="text-muted-foreground text-sm">No connected accounts. Click a bank above to get started.</p>
          ) : (
            <div className="space-y-3">
              {data.connectedAccounts.map(acc => (
                <div key={acc.id} className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-all ${selectedAccountId === acc.id ? "ring-2 ring-primary" : "hover:bg-muted/50"}`} onClick={() => setSelectedAccountId(acc.id)}>
                  <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{acc.bankName} — {acc.accountType}</p>
                      <p className="text-sm text-muted-foreground">{acc.maskedAccountNumber} · {acc.currency}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{acc.currency} {acc.balance.toLocaleString()}</span>
                    {acc.status === "active"
                      ? <CheckCircle className="w-4 h-4 text-green-600" />
                      : <AlertCircle className="w-4 h-4 text-orange-500" />
                    }
                    <Badge className={acc.status === "active" ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}>{acc.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedAccountId && txQuery.data && (
        <Card>
          <CardHeader><CardTitle>Transactions — {selectedAccountId}</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {txQuery.data.transactions.map(tx => (
                <div key={tx.transactionId} className="flex items-center justify-between p-2 border rounded text-sm">
                  <div>
                    <p className="font-medium">{tx.description}</p>
                    <p className="text-xs text-muted-foreground">{tx.transactionDate} · {tx.type}</p>
                  </div>
                  <div className="text-right">
                    <span className={tx.amount < 0 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                      {tx.amount < 0 ? "" : "+"}{tx.amount.toFixed(2)} {tx.currency}
                    </span>
                    <p className="text-xs text-muted-foreground">Bal: {tx.balance.toFixed(2)}</p>
                  </div>
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
