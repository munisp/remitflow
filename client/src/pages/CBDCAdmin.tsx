import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Coins, TrendingUp, TrendingDown, History } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const CBDC_CURRENCIES = ["eNGN", "eGHS", "eKES", "eZAR"] as const;
const CBDC_FLAGS: Record<string, { flag: string; name: string }> = {
  eNGN: { flag: "🇳🇬", name: "Digital Naira" },
  eGHS: { flag: "🇬🇭", name: "Digital Cedi" },
  eKES: { flag: "🇰🇪", name: "Digital Shilling" },
  eZAR: { flag: "🇿🇦", name: "Digital Rand" },
};

export default function CBDCAdmin() {
  const [operation, setOperation] = useState<"mint" | "burn">("mint");
  const [userId, setUserId] = useState("");
  const [currency, setCurrency] = useState<typeof CBDC_CURRENCIES[number]>("eNGN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [logPage, setLogPage] = useState(1);

  const { data: log, refetch } = trpc.v98.cbdcAdmin.getLog.useQuery({ page: logPage, limit: 20 });

  const mint = trpc.v98.cbdcAdmin.mint.useMutation({
    onSuccess: (data) => {
      toast.success(`Balance: ${data.balanceBefore} → ${data.balanceAfter} ${data.currency}`);
      setAmount(""); setReason(""); setUserId(""); refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const burn = trpc.v98.cbdcAdmin.burn.useMutation({
    onSuccess: (data) => {
      toast.success(`Balance: ${data.balanceBefore} → ${data.balanceAfter} ${data.currency}`);
      setAmount(""); setReason(""); setUserId(""); refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    const uid = parseInt(userId);
    const amt = parseFloat(amount);
    if (!uid || !amt || !reason || reason.length < 10) {
      toast.error("All fields required. Reason must be at least 10 characters.");
      return;
    }
    if (operation === "mint") {
      mint.mutate({ userId: uid, currency, amount: amt, reason });
    } else {
      burn.mutate({ userId: uid, currency, amount: amt, reason });
    }
  };

  const isPending = mint.isPending || burn.isPending;

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">CBDC Mint/Burn Admin</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Central Bank Digital Currency operations — Admin only
        </p>
      </div>

      {/* Currency Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CBDC_CURRENCIES.map((c) => (
          <Card key={c} className={`cursor-pointer transition-all ${currency === c ? "ring-2 ring-primary" : ""}`} onClick={() => setCurrency(c)}>
            <CardContent className="pt-4">
              <div className="text-2xl mb-1">{CBDC_FLAGS[c].flag}</div>
              <p className="font-bold text-sm">{c}</p>
              <p className="text-xs text-muted-foreground">{CBDC_FLAGS[c].name}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="operation">
        <TabsList>
          <TabsTrigger value="operation">Operation</TabsTrigger>
          <TabsTrigger value="history">Audit Log ({log?.total ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="operation">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="h-4 w-4" />
                CBDC {operation === "mint" ? "Mint" : "Burn"} — {currency}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Operation Toggle */}
              <div className="flex gap-2">
                <Button
                  variant={operation === "mint" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setOperation("mint")}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Mint (Issue)
                </Button>
                <Button
                  variant={operation === "burn" ? "destructive" : "outline"}
                  className="flex-1"
                  onClick={() => setOperation("burn")}
                >
                  <TrendingDown className="h-4 w-4 mr-2" />
                  Burn (Retire)
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>User ID</Label>
                  <Input
                    type="number"
                    placeholder="Enter user ID"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Amount ({currency})</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="0.01"
                    max={operation === "mint" ? "10000000" : undefined}
                  />
                </div>
              </div>

              <div>
                <Label>Reason / Authorization</Label>
                <Textarea
                  placeholder="Provide a detailed reason for this operation (min 10 characters)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Warning:</strong> This operation is irreversible and will be logged in the immutable audit trail.
                {operation === "mint" && " Minting creates new CBDC tokens and credits the user's wallet."}
                {operation === "burn" && " Burning permanently destroys CBDC tokens from the user's wallet."}
              </div>

              <Button
                className="w-full"
                variant={operation === "burn" ? "destructive" : "default"}
                onClick={handleSubmit}
                disabled={isPending}
              >
                {isPending ? "Processing..." : `${operation === "mint" ? "Mint" : "Burn"} ${amount || "0"} ${currency}`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />
                Mint/Burn Audit Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!log?.rows.length ? (
                <div className="text-center py-8 text-muted-foreground">No operations recorded yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-3">ID</th>
                        <th className="text-left pr-3">Operation</th>
                        <th className="text-left pr-3">Currency</th>
                        <th className="text-right pr-3">Amount</th>
                        <th className="text-right pr-3">Before</th>
                        <th className="text-right pr-3">After</th>
                        <th className="text-left pr-3">User</th>
                        <th className="text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.rows.map((r) => (
                        <tr key={r.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="py-2 pr-3 font-mono text-xs">#{r.id}</td>
                          <td className="pr-3">
                            <Badge variant={r.operation === "mint" ? "default" : "destructive"} className="text-xs">
                              {r.operation}
                            </Badge>
                          </td>
                          <td className="pr-3 font-medium">{r.currency}</td>
                          <td className="text-right pr-3 font-medium">
                            {Number(r.amount).toLocaleString()}
                          </td>
                          <td className="text-right pr-3 text-muted-foreground text-xs">
                            {Number(r.balanceBefore).toLocaleString()}
                          </td>
                          <td className="text-right pr-3 text-xs">
                            {Number(r.balanceAfter).toLocaleString()}
                          </td>
                          <td className="pr-3 text-xs">User #{r.userId}</td>
                          <td className="text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(log?.total ?? 0) > 20 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button size="sm" variant="outline" disabled={logPage === 1} onClick={() => setLogPage(p => p - 1)}>Prev</Button>
                  <span className="text-sm self-center">Page {logPage}</span>
                  <Button size="sm" variant="outline" onClick={() => setLogPage(p => p + 1)}>Next</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
