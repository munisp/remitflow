import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { enqueueTransfer } from "@/lib/offlineQueue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { FxRateChart } from "@/components/FxRateChart";
import { Send, Search, ArrowRight, Info, CheckCircle2, Loader2, Star, Plus, User, ShieldCheck, KeyRound, Copy, Check, ExternalLink, Globe, Zap, Building2, Smartphone, Banknote, Clock, TrendingUp, BookmarkPlus, AlertTriangle, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import RateLockBanner from "@/components/RateLockBanner";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "ZAR", "UGX", "TZS", "XOF"];

// ─── Payment Rail / FSP options ───────────────────────────────────────────────
const FSP_OPTIONS = [
  { id: "remitflow", label: "RemitFlow", description: "Instant — our default rails", Icon: Zap, color: "text-primary", badge: "Recommended" },
  { id: "mojaloop", label: "Mojaloop FSP", description: "Open-loop interbank network", Icon: Globe, color: "text-blue-500", badge: "FSPIOP" },
  { id: "swift", label: "SWIFT", description: "International wire transfer", Icon: Building2, color: "text-amber-500", badge: "1–3 days" },
  { id: "sepa", label: "SEPA", description: "EU instant credit transfer", Icon: Banknote, color: "text-emerald-500", badge: "EUR only" },
  { id: "mpesa", label: "M-Pesa", description: "Mobile money (East Africa)", Icon: Smartphone, color: "text-green-600", badge: "KES/TZS" },
  { id: "wise", label: "Wise", description: "Multi-currency transfers", Icon: Globe, color: "text-teal-500", badge: "Low fee" },
] as const;

// CSS animations injected via style tag
const stepAnimationCSS = `
  @keyframes checkPop {
    0% { transform: scale(0) rotate(-10deg); opacity: 0; }
    60% { transform: scale(1.3) rotate(5deg); opacity: 1; }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }
  @keyframes slideInRight {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideInLeft {
    from { opacity: 0; transform: translateX(-20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .step-enter { animation: slideInRight 0.2s ease-out; }
  .step-exit { animation: slideInLeft 0.2s ease-out; }
`;

// KYC tier per-tx limits (USD) — mirrors server/business-rules.ts
const TIER_PER_TX: Record<string, number> = { tier0: 0, tier1: 500, tier2: 5000, tier3: 50000 };
const TIER_LABEL: Record<string, string> = { tier0: "Unverified", tier1: "Basic KYC", tier2: "Enhanced KYC", tier3: "Full KYC" };
const NEXT_TIER: Record<string, string> = { tier0: "tier1", tier1: "tier2", tier2: "tier3", tier3: "tier3" };

export default function SendMoney() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [tierLimitError, setTierLimitError] = useState<string | null>(null);
  
  const [step, setStep] = useState<"recipient" | "amount" | "purpose" | "confirm" | "success">("recipient");
  const [purposeGoalId, setPurposeGoalId] = useState<number | null>(null);
  const [purposeSplitPct, setPurposeSplitPct] = useState(20); // % of amount to lock into goal
  const [successData, setSuccessData] = useState<{ reference: string; workflowId?: string } | null>(null);
  const [copied, setCopied] = useState<"ref" | "workflow" | null>(null);

  const copyToClipboard = (text: string, type: "ref" | "workflow") => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  };
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("NGN");
  const [description, setDescription] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newRecipient, setNewRecipient] = useState({ name: "", account: "", bank: "", country: "Nigeria" });

  // 2FA state
  const [twoFAOpen, setTwoFAOpen] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [twoFARequired, setTwoFARequired] = useState(false);

  // Confirmation dialog before final send
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Step transition animation
  const [prevStepIndex, setPrevStepIndex] = useState(0);
  const [stepAnimating, setStepAnimating] = useState(false);

  // Payment rail / FSP selector
  const [selectedFSP, setSelectedFSP] = useState<string>("remitflow");
  const [showFSPSelector, setShowFSPSelector] = useState(false);

  // Delivery method and recipient notification
  const [deliveryMethod, setDeliveryMethod] = useState<"bank_transfer" | "mobile_money" | "cash_pickup" | "wallet">("bank_transfer");
  const [recipientEmail, setRecipientEmail] = useState("");

  const { data: beneficiaries, refetch: refetchBeneficiaries } = trpc.beneficiaries.list.useQuery();
  const { data: savingsGoals = [] } = trpc.savings.list.useQuery();
  const { data: quote, isLoading: quoteLoading } = trpc.transfer.quote.useQuery(
    { fromCurrency, toCurrency, amount: parseFloat(amount) || 0 },
    { enabled: !!amount && parseFloat(amount) > 0 }
  );

  const sendMutation = trpc.transfer.send.useMutation({
    onSuccess: (data) => {
      setSuccessData({ reference: data.reference, workflowId: (data as any).workflowId ?? undefined });
      toast.success(`Transfer sent! Ref: ${data.reference}`);
      setStep("success");
      setTwoFAOpen(false);
      setTotpCode("");
      setTwoFARequired(false);
    },
    onError: (err) => {
      const msg = err.message ?? "";
      if (msg.includes("2FA_REQUIRED") || msg.includes("2FA required") || msg.includes("two-factor")) {
        setTwoFARequired(true);
        setTwoFAOpen(true);
        toast.info("This transfer requires 2FA verification (transfers > $1,000)");
      } else if (err.data?.code === "FORBIDDEN" && (msg.includes("limit") || msg.includes("tier") || msg.includes("KYC"))) {
        setTierLimitError(msg);
        setTwoFAOpen(false);
        toast.error(msg);
      } else {
        toast.error(msg);
        setTwoFAOpen(false);
      }
    },
  });

  const addBeneficiaryMutation = trpc.beneficiaries.add.useMutation({
    onSuccess: () => {
      toast.success("Beneficiary added!");
      refetchBeneficiaries();
      setAddOpen(false);
      setNewRecipient({ name: "", account: "", bank: "", country: "Nigeria" });
    },
    onError: (err) => toast.error(err.message),
  });

  const filtered = (beneficiaries ?? []).filter((r: any) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.accountNumber ?? "").includes(search) ||
    (r.country ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const doSend = (code?: string) => {
    if (!selected || !amount) return;
    // ── Offline-first: queue the transfer if the device is offline ────────────
    if (!navigator.onLine) {
      enqueueTransfer({
        type: "send_money",
        fromCurrency,
        amount: parseFloat(amount),
        toCurrency,
        recipientName: selected.name,
        recipientAccount: selected.accountNumber ?? undefined,
        recipientBank: selected.bankName ?? undefined,
        recipientCountry: selected.country ?? undefined,
        description: description || undefined,
        deliveryMethod,
        recipientEmail: recipientEmail || undefined,
      }).then(() => {
        toast.info("You are offline. Transfer queued — it will be sent automatically when you reconnect.");
        setStep("success");
        setSuccessData({ reference: `QUEUED-${Date.now()}` });
      }).catch(() => {
        toast.error("Failed to queue transfer. Please check your connection.");
      });
      return;
    }
    const splitAmt = purposeGoalId ? parseFloat((parseFloat(amount) * purposeSplitPct / 100).toFixed(2)) : undefined;
    sendMutation.mutate({
      fromCurrency,
      amount: parseFloat(amount),
      toCurrency,
      recipientName: selected.name,
      recipientAccount: selected.accountNumber ?? undefined,
      recipientBank: selected.bankName ?? undefined,
      recipientCountry: selected.country ?? undefined,
      description: description || undefined,
      deliveryMethod,
      recipientEmail: recipientEmail || undefined,
      ...(purposeGoalId ? { goalId: purposeGoalId, purposeAmount: splitAmt } : {}),
      ...(code ? { totpCode: code } : {}),
    });
  };

  const handleSend = () => {
    // Open confirmation dialog before sending
    setConfirmOpen(true);
  };

  const handleConfirmedSend = () => {
    setConfirmOpen(false);
    doSend();
  };

  const handleTwoFASubmit = () => {
    if (totpCode.length !== 6 || !/^\d{6}$/.test(totpCode)) {
      toast.error("Please enter a valid 6-digit code");
      return;
    }
    doSend(totpCode);
  };

  const isHighValue = parseFloat(amount) >= 1000;
  const userTier = (user as any)?.kycTier ?? "tier0";
  const perTxLimit = TIER_PER_TX[userTier] ?? 0;
  const amountNum = parseFloat(amount) || 0;
  const exceedsLimit = perTxLimit > 0 && amountNum > perTxLimit;
  const nextTier = NEXT_TIER[userTier];

  const STEPS = ["recipient", "amount", "purpose", "confirm"] as const;
  const stepIndex = STEPS.indexOf(step as any);
  const stepLabels = ["Recipient", "Amount", "Purpose", "Confirm"];
  const stepDeliveryTimes = ["", "", "", "Instant – 2 min"];
  const stepIcons = ["👤", "💰", "🎯", "✅"];

  // Animated step transition helper
  const goToStep = (nextStep: typeof step) => {
    setStepAnimating(true);
    setPrevStepIndex(stepIndex);
    setTimeout(() => {
      setStep(nextStep);
      setStepAnimating(false);
    }, 180);
  };

  if (step === "success") {
    return (
      <DashboardLayout>
        <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-4">
          <Card className="text-center">
            <CardContent className="pt-10 pb-6 space-y-4">
              <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-emerald-700">Transfer Sent!</h2>
              <p className="text-muted-foreground">{amount} {fromCurrency} → {selected?.name}</p>
              <p className="text-sm text-muted-foreground">Recipient receives approximately {quote?.toAmount?.toFixed(2)} {toCurrency}</p>

              {/* Reference number */}
              {successData?.reference && (
                <div className="mx-auto max-w-xs rounded-xl border bg-muted/40 px-4 py-3 text-left">
                  <p className="text-xs text-muted-foreground mb-1">Reference Number</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-sm truncate">{successData.reference}</span>
                    <button
                      onClick={() => copyToClipboard(successData.reference, "ref")}
                      className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors"
                      title="Copy reference"
                    >
                      {copied === "ref" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Workflow ID — only shown when Temporal saga was used */}
              {successData?.workflowId && (
                <div className="mx-auto max-w-xs rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 text-left">
                  <p className="text-xs text-violet-600 mb-1 font-medium">Temporal Workflow ID</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-violet-800 truncate">{successData.workflowId}</span>
                    <button
                      onClick={() => copyToClipboard(successData!.workflowId!, "workflow")}
                      className="flex-shrink-0 p-1.5 rounded-lg hover:bg-violet-100 transition-colors"
                      title="Copy workflow ID"
                    >
                      {copied === "workflow" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-violet-500" />}
                    </button>
                  </div>
                  <p className="text-xs text-violet-500 mt-1.5">Paste this ID in Transfer Tracking to see the live saga timeline.</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <Button variant="outline" onClick={() => { setStep("recipient"); setSelected(null); setAmount(""); setSuccessData(null); }}>New Transfer</Button>
                {successData?.workflowId && (
                  <Button variant="outline" className="border-violet-200 text-violet-700 hover:bg-violet-50" onClick={() => {
                    const id = successData.workflowId!;
                    window.location.href = `/transfer-tracking?ref=${encodeURIComponent(id)}`;
                  }}>
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Track Saga
                  </Button>
                )}
                <Button onClick={() => window.location.href = "/transactions"}>View Transactions</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <style dangerouslySetInnerHTML={{ __html: stepAnimationCSS }} />
      <div className={`p-4 sm:p-6 space-y-6 max-w-2xl mx-auto transition-opacity duration-150 ${stepAnimating ? "opacity-70" : "opacity-100"}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Send className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Send Money</h1>
            <p className="text-muted-foreground text-sm">Transfer to anyone, anywhere</p>
          </div>
        </div>

        {/* Full-width mobile-first progress stepper */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-col items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                  stepIndex > i ? "bg-emerald-500 text-white scale-95" :
                  stepIndex === i ? "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110" :
                  "bg-muted text-muted-foreground scale-100"
                }`} style={{ transform: stepIndex === i ? "scale(1.1)" : stepIndex > i ? "scale(0.95)" : "scale(1)" }}>
                  {stepIndex > i ? (
                    <span className="inline-block" style={{ animation: "checkPop 0.3s ease-out" }}>✓</span>
                  ) : i + 1}
                </div>
                <span className={`text-xs mt-1 hidden sm:block ${
                  stepIndex === i ? "font-semibold text-primary" : "text-muted-foreground"
                }`}>{stepLabels[i]}</span>
              </div>
            ))}
          </div>
          {/* Gradient progress bar */}
          <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(0, (stepIndex / (STEPS.length - 1)) * 100)}%` }}
            />
          </div>
          {/* Mobile-only step label */}
          <p className="text-xs text-muted-foreground mt-1 sm:hidden text-center">
            Step {stepIndex + 1} of {STEPS.length}: {stepLabels[stepIndex] ?? "Done"}
          </p>
        </div>


        {step === "recipient" && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Select Recipient</CardTitle>
                <Dialog open={addOpen} onOpenChange={setAddOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />Add New</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Beneficiary</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div><Label>Full Name *</Label><Input value={newRecipient.name} onChange={e => setNewRecipient(p => ({ ...p, name: e.target.value }))} placeholder="John Doe" /></div>
                      <div><Label>Account Number</Label><Input value={newRecipient.account} onChange={e => setNewRecipient(p => ({ ...p, account: e.target.value }))} placeholder="0123456789" /></div>
                      <div><Label>Bank Name</Label><Input value={newRecipient.bank} onChange={e => setNewRecipient(p => ({ ...p, bank: e.target.value }))} placeholder="First Bank" /></div>
                      <div><Label>Country</Label><Input value={newRecipient.country} onChange={e => setNewRecipient(p => ({ ...p, country: e.target.value }))} placeholder="Nigeria" /></div>
                      <Button className="w-full" disabled={!newRecipient.name || addBeneficiaryMutation.isPending} onClick={() => addBeneficiaryMutation.mutate({ name: newRecipient.name, accountNumber: newRecipient.account || undefined, bankName: newRecipient.bank || undefined, country: newRecipient.country || undefined })}>
                        {addBeneficiaryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Beneficiary"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by name, account, or country..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {filtered.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>No beneficiaries found.</p>
                  <p className="text-sm">Add a recipient to get started.</p>
                </div>
              )}
              {filtered.map((r: any) => (
                <button key={r.id} onClick={() => { setSelected(r); goToStep("amount"); }} className="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left hover:border-primary hover:bg-primary/5">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {r.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{r.name}</p>
                      {r.isFavorite && <Star className="h-3 w-3 text-amber-500 fill-amber-500 flex-shrink-0" />}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{r.bankName ?? "—"} {r.accountNumber ? `• ${r.accountNumber}` : ""}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs flex-shrink-0">{r.country ?? "—"}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {step === "amount" && selected && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center text-white font-bold text-sm">
                  {selected.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <CardTitle className="text-base">Sending to {selected.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{selected.bankName} {selected.accountNumber ? `• ${selected.accountNumber}` : ""}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>You send</Label>
                  <div className="flex gap-2 mt-1">
                    <Select value={fromCurrency} onValueChange={setFromCurrency}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="flex-1" />
                  </div>
                </div>
                <div>
                  <Label>They receive (approx.)</Label>
                  <div className="flex gap-2 mt-1">
                    <Select value={toCurrency} onValueChange={setToCurrency}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input readOnly value={quoteLoading ? "..." : (quote?.toAmount?.toFixed(2) ?? "0.00")} className="flex-1 bg-muted" />
                  </div>
                </div>
              </div>
              {quote && (
                <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Exchange rate</span><span>1 {fromCurrency} = {quote.fxRate?.toFixed(4)} {toCurrency}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee (0.5%)</span><span>{quote.fee?.toFixed(2)} {fromCurrency}</span></div>
                  <Separator className="my-1" />
                  <div className="flex justify-between font-semibold"><span>Total deducted</span><span>{(parseFloat(amount) + (quote.fee ?? 0)).toFixed(2)} {fromCurrency}</span></div>
                </div>
              )}
              {isHighValue && (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                  <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-600" />
                  <span>Transfers over $1,000 require 2FA verification for your security.</span>
                </div>
              )}
              {exceedsLimit && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm">
                  <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-amber-600" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-amber-900">Transfer limit exceeded</p>
                    <p className="text-amber-800 mt-0.5">Your current tier ({TIER_LABEL[userTier]}) allows up to <strong>${perTxLimit.toLocaleString()} USD</strong> per transaction. Upgrade your KYC to send more.</p>
                    <button
                      type="button"
                      onClick={() => navigate("/kyc")}
                      className="mt-2 inline-flex items-center gap-1.5 text-amber-900 font-semibold hover:underline"
                    >
                      Upgrade to {TIER_LABEL[nextTier]} <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              {tierLimitError && !exceedsLimit && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-300 rounded-xl p-4 text-sm">
                  <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-600" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-red-900">Transfer blocked</p>
                    <p className="text-red-800 mt-0.5">{tierLimitError}</p>
                    <button
                      type="button"
                      onClick={() => navigate("/kyc")}
                      className="mt-2 inline-flex items-center gap-1.5 text-red-900 font-semibold hover:underline"
                    >
                      Upgrade KYC tier <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <Label>Description (optional)</Label>
                <Input placeholder="e.g. School fees, rent payment..." value={description} onChange={e => setDescription(e.target.value)} className="mt-1" />
              </div>

              {/* Delivery Method */}
              <div>
                <Label>Delivery Method</Label>
                <Select value={deliveryMethod} onValueChange={(v: any) => setDeliveryMethod(v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="mobile_money">Mobile Money</SelectItem>
                    <SelectItem value="cash_pickup">Cash Pickup</SelectItem>
                    <SelectItem value="wallet">Wallet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Recipient Email for notification */}
              <div>
                <Label>Recipient Email (optional — for transfer notification)</Label>
                <Input type="email" placeholder="recipient@example.com" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} className="mt-1" />
              </div>

              {/* Payment Rail / FSP Selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Payment Rail</Label>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setShowFSPSelector(v => !v)}
                  >
                    {showFSPSelector ? "Hide options" : "Change rail"}
                  </button>
                </div>
                {/* Current selection summary */}
                {(() => {
                  const fsp = FSP_OPTIONS.find(f => f.id === selectedFSP) ?? FSP_OPTIONS[0];
                  return (
                    <div className="flex items-center gap-3 p-3 border rounded-xl bg-muted/30 cursor-pointer" onClick={() => setShowFSPSelector(v => !v)}>
                      <fsp.Icon className={`h-5 w-5 flex-shrink-0 ${fsp.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{fsp.label}</span>
                          <Badge variant="secondary" className="text-xs">{fsp.badge}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{fsp.description}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  );
                })()}
                {showFSPSelector && (
                  <div className="mt-2 space-y-1.5 border rounded-xl p-2 bg-background shadow-sm">
                    {FSP_OPTIONS.map(fsp => (
                      <button
                        key={fsp.id}
                        type="button"
                        className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left ${
                          selectedFSP === fsp.id
                            ? "bg-primary/10 border border-primary/30"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => { setSelectedFSP(fsp.id); setShowFSPSelector(false); }}
                      >
                        <fsp.Icon className={`h-4 w-4 flex-shrink-0 ${fsp.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{fsp.label}</span>
                            <Badge variant={selectedFSP === fsp.id ? "default" : "secondary"} className="text-xs">{fsp.badge}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{fsp.description}</p>
                        </div>
                        {selectedFSP === fsp.id && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Real-time FX Rate Chart */}
              <FxRateChart fromCurrency={fromCurrency} toCurrency={toCurrency} className="mt-2" />

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setStep("recipient")}>Back</Button>
                <Button className="flex-1" disabled={!amount || parseFloat(amount) <= 0} onClick={() => setStep("purpose")}>
                  Continue <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "purpose" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span>🎯</span> Purpose & Savings Split
              </CardTitle>
              <p className="text-sm text-muted-foreground">Optionally lock a portion of this transfer into a savings goal on the recipient side.</p>
            </CardHeader>
            <CardContent className="space-y-5">
              {savingsGoals.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <p>You have no savings goals yet.</p>
                  <p className="mt-1">Create one on the <a href="/goals" className="text-primary underline">Goals page</a> to enable split transfers.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Label>Allocate to a Savings Goal (optional)</Label>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => setPurposeGoalId(null)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors text-sm ${purposeGoalId === null ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                    >
                      <span className="font-medium">No goal — send full amount</span>
                    </button>
                    {(savingsGoals as any[]).map((g: any) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setPurposeGoalId(g.id)}
                        className={`w-full text-left p-3 rounded-xl border transition-colors ${purposeGoalId === g.id ? "border-emerald-500 bg-emerald-50" : "border-border hover:border-emerald-400"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{g.name}</span>
                          <span className="text-xs text-muted-foreground">{g.purpose ?? ""}</span>
                        </div>
                        <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (Number(g.currentAmount) / Number(g.targetAmount)) * 100)}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{Number(g.currentAmount).toFixed(2)} / {Number(g.targetAmount).toFixed(2)} {g.currency}</p>
                      </button>
                    ))}
                  </div>
                  {purposeGoalId !== null && (
                    <div className="space-y-2 pt-2">
                      <Label>Split percentage: <span className="font-bold text-emerald-600">{purposeSplitPct}%</span> → <span className="font-bold">{(parseFloat(amount || "0") * purposeSplitPct / 100).toFixed(2)} {fromCurrency}</span> locked to goal</Label>
                      <input
                        type="range"
                        min={5} max={50} step={5}
                        value={purposeSplitPct}
                        onChange={e => setPurposeSplitPct(Number(e.target.value))}
                        className="w-full accent-emerald-600"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>5%</span><span>25%</span><span>50%</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => goToStep("amount")}>Back</Button>
                <Button className="flex-1" onClick={() => setStep("confirm")}>
                  Continue <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "confirm" && selected && (
          <Card>
            <CardHeader><CardTitle className="text-base">Confirm Transfer</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-xl p-4 space-y-3">
                <div className="flex justify-between"><span className="text-muted-foreground">Recipient</span><span className="font-medium">{selected.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span>{selected.bankName ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span>{selected.accountNumber ?? "—"}</span></div>
                <Separator />
                <div className="flex justify-between"><span className="text-muted-foreground">You send</span><span className="font-semibold text-lg">{amount} {fromCurrency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">They receive</span><span className="font-semibold text-lg text-emerald-600">{quote?.toAmount?.toFixed(2)} {toCurrency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fee</span><span>{quote?.fee?.toFixed(2)} {fromCurrency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span>1 {fromCurrency} = {quote?.fxRate?.toFixed(4)} {toCurrency}</span></div>
                {description && <div className="flex justify-between"><span className="text-muted-foreground">Note</span><span className="text-right max-w-[200px]">{description}</span></div>}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Rail</span>
                  <span className="font-medium">{FSP_OPTIONS.find(f => f.id === selectedFSP)?.label ?? "RemitFlow"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Est. Delivery</span>
                  <span className="font-medium text-emerald-600 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {selectedFSP === "swift" ? "1–3 business days" : selectedFSP === "sepa" ? "Instant (SEPA)" : selectedFSP === "mpesa" ? "~2 minutes" : "Instant – 2 min"}
                  </span>
                </div>
              </div>

              {isHighValue && (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                  <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-600" />
                  <span>This transfer exceeds $1,000. If you have 2FA enabled, you will be prompted to verify with your authenticator app.</span>
                </div>
              )}

              {/* Rate lock countdown — 15 minutes from when quote was fetched */}
              {quote && (
                <RateLockBanner
                  durationSeconds={900}
                  rate={`${quote.fxRate?.toFixed(2)} ${toCurrency}`}
                  pair={`${fromCurrency} → ${toCurrency}`}
                  onExpire={() => toast.warning("Rate expired. Please go back and refresh your quote.")}
                />
              )}

              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Please verify all details before confirming. Transfers cannot be reversed once sent.</span>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => goToStep("amount")}>Back</Button>
                <Button className="flex-1" disabled={sendMutation.isPending} onClick={handleSend}>
                  {sendMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Confirm & Send</>}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Transfer Confirmation Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Confirm Transfer
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To</span>
                    <span className="font-semibold">{selected?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You send</span>
                    <span className="font-bold text-base">{amount} {fromCurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">They receive</span>
                    <span className="font-bold text-base text-emerald-600">{quote?.toAmount?.toFixed(2)} {toCurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee</span>
                    <span>{quote?.fee?.toFixed(2)} {fromCurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate</span>
                    <span>1 {fromCurrency} = {quote?.fxRate?.toFixed(4)} {toCurrency}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t">
                    <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Delivery</span>
                    <span className="text-emerald-600 font-medium text-xs">
                      {selectedFSP === "swift" ? "1–3 business days" : "Instant – 2 min"}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  This action cannot be undone. Please verify all details are correct before proceeding.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedSend} className="bg-primary" disabled={sendMutation.isPending}>
              {sendMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send Now</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 2FA Verification Dialog */}
      <Dialog open={twoFAOpen} onOpenChange={(open) => { setTwoFAOpen(open); if (!open) { setTotpCode(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              Two-Factor Verification Required
            </DialogTitle>
            <DialogDescription>
              This transfer of <strong>{amount} {fromCurrency}</strong> exceeds $1,000 and requires 2FA verification. Enter the 6-digit code from your authenticator app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <KeyRound className="h-5 w-5 text-blue-600 flex-shrink-0" />
              <p className="text-sm text-blue-800">Open your authenticator app (Google Authenticator, Authy, etc.) and enter the current code.</p>
            </div>
            <div>
              <Label htmlFor="totp-input">Authenticator Code</Label>
              <Input
                id="totp-input"
                className="mt-1 text-center text-2xl tracking-[0.5em] font-mono"
                placeholder="000000"
                maxLength={6}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={e => { if (e.key === "Enter") handleTwoFASubmit(); }}
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setTwoFAOpen(false); setTotpCode(""); }}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={totpCode.length !== 6 || sendMutation.isPending}
                onClick={handleTwoFASubmit}
              >
                {sendMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying...</> : <><ShieldCheck className="h-4 w-4 mr-2" />Verify & Send</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
