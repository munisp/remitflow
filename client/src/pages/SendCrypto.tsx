import { toast } from 'sonner';
import { useState } from "react";
import { useLocation } from "wouter";
import { v4 as uuidv4 } from "uuid";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Bitcoin, Wallet, QrCode, ArrowRight, Shield, Clock, AlertTriangle, CheckCircle2, X, Camera } from "lucide-react";

const CRYPTO_ASSETS = [
  { symbol: "BTC",  name: "Bitcoin",    network: "Bitcoin",    icon: "B", color: "#F7931A", minAmount: 0.0001 },
  { symbol: "ETH",  name: "Ethereum",   network: "Ethereum",   icon: "E", color: "#627EEA", minAmount: 0.001  },
  { symbol: "USDT", name: "Tether USD", network: "TRC-20",     icon: "T", color: "#26A17B", minAmount: 1      },
  { symbol: "USDC", name: "USD Coin",   network: "ERC-20",     icon: "U", color: "#2775CA", minAmount: 1      },
  { symbol: "BNB",  name: "BNB",        network: "BSC",        icon: "N", color: "#F3BA2F", minAmount: 0.01   },
  { symbol: "XRP",  name: "XRP",        network: "XRP Ledger", icon: "X", color: "#00AAE4", minAmount: 1      },
  { symbol: "SOL",  name: "Solana",     network: "Solana",     icon: "S", color: "#9945FF", minAmount: 0.01   },
  { symbol: "MATIC",name: "Polygon",    network: "Polygon",    icon: "M", color: "#8247E5", minAmount: 1      },
  { symbol: "AVAX", name: "Avalanche",  network: "Avalanche",  icon: "A", color: "#E84142", minAmount: 0.01   },
  { symbol: "TRX",  name: "TRON",       network: "TRC-20",     icon: "R", color: "#FF0013", minAmount: 10     },
];

const CUSTODY_PROVIDERS = [
  { id: "mock",       name: "RemitFlow Custody (Sandbox)", recommended: true  },
  { id: "fireblocks", name: "Fireblocks",                  recommended: false },
  { id: "bitgo",      name: "BitGo",                       recommended: false },
];

function QRScannerModal({ onScan, onClose }: { onScan: (addr: string) => void; onClose: () => void }) {
  const [manualInput, setManualInput] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg text-card-foreground">Scan QR Code</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="bg-muted rounded-xl aspect-square flex flex-col items-center justify-center mb-4 border-2 border-dashed border-border">
          <Camera className="h-12 w-12 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground text-center px-4">Camera access required. Paste address below instead.</p>
        </div>
        <div className="space-y-3">
          <Label className="text-sm text-muted-foreground">Or paste address manually</Label>
          <Input placeholder="Paste wallet address..." value={manualInput} onChange={(e) => setManualInput(e.target.value)} className="font-mono text-sm" />
          <Button className="w-full" disabled={!manualInput.trim()} onClick={() => { onScan(manualInput.trim()); onClose(); }}>Use This Address</Button>
        </div>
      </div>
    </div>
  );
}

export default function SendCrypto() {
  const [, navigate] = useLocation();
  const [selectedAsset, setSelectedAsset] = useState(CRYPTO_ASSETS[0]);
  const [custodyProvider, setCustodyProvider] = useState("mock");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [step, setStep] = useState<"form" | "review" | "sent">("form");
  const [transferId] = useState(() => uuidv4());
  const [txResult, setTxResult] = useState<Record<string, unknown> | null>(null);

  const sendMutation = trpc.cryptoCustody.send.useMutation({
    onSuccess: (data) => {
      setTxResult(data as Record<string, unknown>);
      setStep("sent");
      toast("Transfer submitted", { description: "Your crypto transfer is being processed." });
    },
    onError: (err) => {
      toast.error("Transfer failed");
    },
  });

  const asset = selectedAsset;
  const amountNum = parseFloat(amount) || 0;
  const isValidAddress = recipientAddress.length >= 20;
  const isValidAmount = amountNum >= asset.minAmount;
  const canSubmit = isValidAddress && isValidAmount && !sendMutation.isPending;

  function handleSend() {
    if (step === "form") { setStep("review"); return; }
    sendMutation.mutate({
      asset: asset.symbol,
      toAddress: recipientAddress,
      amount: amountNum,
      memo: memo || undefined,
      idempotencyKey: transferId + "-" + Date.now(),
    });
  }

  if (step === "sent" && txResult) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl border-border">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Transfer Submitted</h2>
            <p className="text-muted-foreground text-sm">Your {asset.symbol} transfer is being processed.</p>
            <div className="bg-muted rounded-xl p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold">{amountNum} {asset.symbol}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span className="font-semibold">{asset.network}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Transfer ID</span><span className="font-mono text-xs">{transferId.slice(0, 16)}...</span></div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => navigate("/")}>Dashboard</Button>
              <Button className="flex-1" onClick={() => { setStep("form"); setTxResult(null); }}>Send Again</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {showQR && <QRScannerModal onScan={(addr) => setRecipientAddress(addr)} onClose={() => setShowQR(false)} />}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => step === "review" ? setStep("form") : navigate("/")}>
            <ArrowRight className="h-4 w-4 rotate-180" />
          </Button>
          <div>
            <h1 className="font-semibold text-foreground">Send Crypto</h1>
            <p className="text-xs text-muted-foreground">{step === "form" ? "Select asset and enter details" : "Review your transfer"}</p>
          </div>
          <div className="ml-auto">
            <Badge variant="secondary" className="text-xs"><Shield className="h-3 w-3 mr-1" />Custody Protected</Badge>
          </div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {step === "review" && (
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-amber-700 dark:text-amber-400 text-sm">
              <strong>Review carefully.</strong> Crypto transfers are irreversible.
            </AlertDescription>
          </Alert>
        )}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Bitcoin className="h-4 w-4 text-primary" />Select Asset</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CRYPTO_ASSETS.map((a) => (
                <button key={a.symbol} disabled={step === "review"} onClick={() => setSelectedAsset(a)}
                  className={"flex items-center gap-2 p-3 rounded-xl border text-left transition-all " + (selectedAsset.symbol === a.symbol ? "border-primary bg-primary/5 shadow-sm " : "border-border bg-card hover:border-primary/50 ") + (step === "review" ? "opacity-60 cursor-not-allowed" : "cursor-pointer")}>
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ backgroundColor: a.color }}>{a.icon}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground">{a.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.network}</div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" />Transfer Details</CardTitle>
            <CardDescription>Sending {asset.name} on {asset.network}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Recipient Address</Label>
              <div className="flex gap-2">
                <Input placeholder={"Enter " + asset.network + " address..."} value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)} disabled={step === "review"} className="font-mono text-sm flex-1" />
                <Button variant="outline" size="icon" disabled={step === "review"} onClick={() => setShowQR(true)}><QrCode className="h-4 w-4" /></Button>
              </div>
              {recipientAddress && !isValidAddress && <p className="text-xs text-destructive">Address appears too short.</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Amount ({asset.symbol})</Label>
              <div className="relative">
                <Input type="number" placeholder={"Min " + asset.minAmount + " " + asset.symbol} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={step === "review"} className="pr-16" min={asset.minAmount} step={asset.minAmount} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">{asset.symbol}</span>
              </div>
              {amount && !isValidAmount && <p className="text-xs text-destructive">Minimum: {asset.minAmount} {asset.symbol}.</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Memo / Tag (optional)</Label>
              <Input placeholder="Destination tag or memo..." value={memo} onChange={(e) => setMemo(e.target.value)} disabled={step === "review"} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4 text-primary" />Custody Provider</CardTitle>
            <CardDescription>Dual-approval gate for transfers over $10,000</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={custodyProvider} onValueChange={setCustodyProvider} disabled={step === "review"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CUSTODY_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">{p.name}{p.recommended && <Badge variant="secondary" className="text-xs ml-1">Recommended</Badge>}</div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        {step === "review" && (
          <Card className="border-primary/30 bg-primary/5 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Transfer Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {([["Asset", asset.name + " (" + asset.symbol + ")"], ["Network", asset.network], ["Amount", amountNum + " " + asset.symbol], ["Recipient", recipientAddress], ["Custody", CUSTODY_PROVIDERS.find(p => p.id === custodyProvider)?.name ?? custodyProvider]] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground flex-shrink-0">{label}</span>
                  <span className="font-medium text-foreground text-right break-all">{value}</span>
                </div>
              ))}
              <Separator />
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Estimated: 1-30 minutes depending on network</div>
            </CardContent>
          </Card>
        )}
        <Button className="w-full h-12 text-base font-semibold" disabled={!canSubmit || sendMutation.isPending} onClick={handleSend}>
          {sendMutation.isPending ? <span className="flex items-center gap-2"><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Processing...</span>
            : step === "form" ? <span className="flex items-center gap-2">Review Transfer <ArrowRight className="h-4 w-4" /></span>
            : <span className="flex items-center gap-2"><Shield className="h-4 w-4" />Confirm and Send {amountNum} {asset.symbol}</span>}
        </Button>
        <p className="text-center text-xs text-muted-foreground pb-4">All transfers secured by institutional custody with dual-approval controls.</p>
      </div>
    </div>
  );
}
