import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Search, CheckCircle2, XCircle, Globe, Zap, Shield, Clock } from "lucide-react";

const RAIL_ICONS: Record<string, string> = {
  cips: "🇨🇳",
  upi: "🇮🇳",
  pix: "🇧🇷",
  mojaloop: "🌍",
  swift: "🌐",
  sepa: "🇪🇺",
  ach: "🇺🇸",
  faster_payments: "🇬🇧",
};

const RAIL_COLORS: Record<string, string> = {
  cips: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800",
  upi: "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800",
  pix: "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800",
  mojaloop: "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",
  swift: "bg-purple-50 border-purple-200 dark:bg-purple-950/20 dark:border-purple-800",
  sepa: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-800",
  ach: "bg-sky-50 border-sky-200 dark:bg-sky-950/20 dark:border-sky-800",
  faster_payments: "bg-teal-50 border-teal-200 dark:bg-teal-950/20 dark:border-teal-800",
};

function RailCard({ rail }: { rail: any }) {
  const color = RAIL_COLORS[rail.id] || "bg-muted";
  return (
    <Card className={`border ${color} transition-all hover:shadow-md`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{RAIL_ICONS[rail.id] || "💳"}</span>
            <div>
              <CardTitle className="text-base">{rail.name}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{rail.description}</CardDescription>
            </div>
          </div>
          {rail.sandboxMode && (
            <Badge variant="outline" className="text-xs shrink-0">Sandbox</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{rail.settlementTime}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Shield className="h-3 w-3" />
            <span>{rail.regulatoryBody || "Regulated"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {rail.supportedCurrencies?.map((c: string) => (
            <Badge key={c} variant="secondary" className="text-xs px-1.5 py-0">{c}</Badge>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Fees:</span>{" "}
          {rail.fees?.fixed > 0 ? `$${rail.fees.fixed} + ` : ""}
          {rail.fees?.percentage > 0 ? `${(rail.fees.percentage * 100).toFixed(2)}%` : "Free"}
        </div>
        {rail.countries && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Countries:</span> {rail.countries.join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecipientLookup() {
  const [rail, setRail] = useState<"cips" | "upi" | "pix" | "mojaloop">("upi");
  const [recipientId, setRecipientId] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [lookupResult, setLookupResult] = useState<any>(null);

  const lookup = trpc.v90.paymentRails.lookupRecipient.useQuery(
    { rail, recipientId, bankCode: bankCode || undefined },
    { enabled: false }
  );

  const handleLookup = async () => {
    if (!recipientId.trim()) {
      toast.error("Enter a recipient ID");
      return;
    }
    const result = await lookup.refetch();
    if (result.data) {
      setLookupResult(result.data);
    }
  };

  const placeholders: Record<string, string> = {
    cips: "CNAPS ID (e.g. 6222021001)",
    upi: "VPA (e.g. john@oksbi)",
    pix: "PIX key (CPF, phone, email, or random key)",
    mojaloop: "MSISDN or account ID",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4" />
          Recipient Lookup
        </CardTitle>
        <CardDescription>Verify recipient details before initiating a transfer</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Payment Rail</Label>
            <Select value={rail} onValueChange={(v) => { setRail(v as any); setLookupResult(null); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cips">🇨🇳 CIPS (China)</SelectItem>
                <SelectItem value="upi">🇮🇳 UPI (India)</SelectItem>
                <SelectItem value="pix">🇧🇷 PIX (Brazil)</SelectItem>
                <SelectItem value="mojaloop">🌍 Mojaloop (Africa)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Recipient ID</Label>
            <Input
              placeholder={placeholders[rail]}
              value={recipientId}
              onChange={(e) => { setRecipientId(e.target.value); setLookupResult(null); }}
            />
          </div>
        </div>
        {rail === "cips" && (
          <div className="space-y-1.5">
            <Label>Bank BIC (optional)</Label>
            <Input
              placeholder="e.g. ICBKCNBJ"
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
            />
          </div>
        )}
        <Button onClick={handleLookup} disabled={lookup.isFetching} className="w-full">
          {lookup.isFetching ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Looking up...</>
          ) : (
            <><Search className="h-4 w-4 mr-2" /> Lookup Recipient</>
          )}
        </Button>
        {lookupResult && (
          <div className={`rounded-lg border p-4 space-y-2 ${lookupResult.found ? "bg-green-50 border-green-200 dark:bg-green-950/20" : "bg-red-50 border-red-200 dark:bg-red-950/20"}`}>
            <div className="flex items-center gap-2 font-medium">
              {lookupResult.found
                ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                : <XCircle className="h-4 w-4 text-red-600" />}
              {lookupResult.found ? "Recipient Found" : "Recipient Not Found"}
            </div>
            {lookupResult.found && (
              <div className="text-sm space-y-1">
                {lookupResult.name && <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{lookupResult.name}</span></div>}
                {lookupResult.bank && <div><span className="text-muted-foreground">Bank:</span> {lookupResult.bank}</div>}
                {lookupResult.accountNumber && <div><span className="text-muted-foreground">Account:</span> {lookupResult.accountNumber}</div>}
                {lookupResult.vpa && <div><span className="text-muted-foreground">VPA:</span> {lookupResult.vpa}</div>}
                {lookupResult.pixKey && <div><span className="text-muted-foreground">PIX Key:</span> {lookupResult.pixKey}</div>}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InitiateTransfer() {
  const [form, setForm] = useState({
    rail: "upi" as "cips" | "upi" | "pix" | "mojaloop" | "swift" | "sepa",
    fromCurrency: "USD",
    toCurrency: "INR",
    amount: "",
    recipientId: "",
    recipientName: "",
    purpose: "Family Remittance",
  });

  const toCurrencyMap: Record<string, string> = {
    cips: "CNY",
    upi: "INR",
    pix: "BRL",
    mojaloop: "KES",
    swift: "USD",
    sepa: "EUR",
  };

  const transfer = trpc.v90.paymentRails.initiateRailTransfer.useMutation({
    onSuccess: (data) => {
      toast.success("Transfer Initiated", { description: `Reference: ${data.externalRef || data.status}` });
    },
    onError: (err) => {
      toast.error("Transfer Failed", { description: err.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || !form.recipientId) {
      toast.error("Fill all required fields");
      return;
    }
    transfer.mutate({
      ...form,
      amount: parseFloat(form.amount),
      toCurrency: toCurrencyMap[form.rail] || form.toCurrency,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Initiate Rail Transfer
        </CardTitle>
        <CardDescription>Send money via CIPS, UPI, PIX, Mojaloop, SWIFT, or SEPA</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Payment Rail</Label>
              <Select value={form.rail} onValueChange={(v) => setForm(f => ({ ...f, rail: v as any, toCurrency: toCurrencyMap[v] || "USD" }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cips">🇨🇳 CIPS (China)</SelectItem>
                  <SelectItem value="upi">🇮🇳 UPI (India)</SelectItem>
                  <SelectItem value="pix">🇧🇷 PIX (Brazil)</SelectItem>
                  <SelectItem value="mojaloop">🌍 Mojaloop (Africa)</SelectItem>
                  <SelectItem value="swift">🌐 SWIFT</SelectItem>
                  <SelectItem value="sepa">🇪🇺 SEPA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (USD)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Recipient ID / Address</Label>
            <Input
              placeholder={form.rail === "upi" ? "VPA (e.g. john@oksbi)" : form.rail === "pix" ? "PIX key" : form.rail === "cips" ? "CNAPS ID" : "Account ID"}
              value={form.recipientId}
              onChange={(e) => setForm(f => ({ ...f, recipientId: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Recipient Name (optional)</Label>
            <Input
              placeholder="Full name"
              value={form.recipientName}
              onChange={(e) => setForm(f => ({ ...f, recipientName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Purpose</Label>
            <Select value={form.purpose} onValueChange={(v) => setForm(f => ({ ...f, purpose: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Family Remittance">Family Remittance</SelectItem>
                <SelectItem value="Business Payment">Business Payment</SelectItem>
                <SelectItem value="Education">Education</SelectItem>
                <SelectItem value="Medical">Medical</SelectItem>
                <SelectItem value="Investment">Investment</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={transfer.isPending} className="w-full">
            {transfer.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</>
            ) : (
              <>Send via {form.rail.toUpperCase()}</>
            )}
          </Button>
          {transfer.data && (
            <div className="rounded-lg bg-green-50 border border-green-200 dark:bg-green-950/20 p-3 text-sm">
              <div className="font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Transfer Initiated Successfully
              </div>
              <div className="mt-1 text-muted-foreground space-y-0.5">
                {transfer.data.externalRef && <div>Reference: <span className="font-mono">{transfer.data.externalRef}</span></div>}
                {transfer.data.message && <div>Message: {transfer.data.message}</div>}
                {transfer.data.status && <div>Status: <Badge variant="outline">{transfer.data.status}</Badge></div>}
                {transfer.data.estimatedSettlement && <div>Settlement: {transfer.data.estimatedSettlement}</div>}
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export default function PaymentRails() {
  const { data: railsData, isLoading } = trpc.v90.paymentRails.getSupportedRails.useQuery();

  const rails = railsData?.rails || [];
  const newRails = rails.filter(r => ["cips", "upi", "pix", "mojaloop"].includes(r.id));
  const legacyRails = rails.filter(r => !["cips", "upi", "pix", "mojaloop"].includes(r.id));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6" />
            Payment Rails
          </h1>
          <p className="text-muted-foreground mt-1">
            Multi-rail payment infrastructure: CIPS (China), UPI (India), PIX (Brazil), Mojaloop (Africa), SWIFT, SEPA, ACH
          </p>
        </div>

        <Tabs defaultValue="rails">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="rails">All Rails</TabsTrigger>
            <TabsTrigger value="lookup">Recipient Lookup</TabsTrigger>
            <TabsTrigger value="transfer">Initiate Transfer</TabsTrigger>
          </TabsList>

          <TabsContent value="rails" className="space-y-6 mt-4">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Emerging Market Rails (Real-Time)
              </h2>
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="animate-pulse">
                      <CardContent className="h-40" />
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {newRails.map((rail: any) => <RailCard key={rail.id} rail={rail} />)}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Traditional Rails
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {legacyRails.map((rail: any) => <RailCard key={rail.id} rail={rail} />)}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="lookup" className="mt-4">
            <RecipientLookup />
          </TabsContent>

          <TabsContent value="transfer" className="mt-4">
            <InitiateTransfer />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
