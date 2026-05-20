/**
 * SendMoneyWidget — live send-money calculator widget.
 * - Unauthenticated users: shows FX calculator + redirects to login on "Send Now"
 * - Authenticated users: opens a confirmation dialog with recipient details,
 *   calls transfer.send, and requires TOTP 2FA for amounts > $500 USD equivalent.
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight, RefreshCw, Zap, Clock, BadgeCheck,
  Lock, CheckCircle2, AlertCircle, Loader2
} from "lucide-react";

interface SendMoneyWidgetProps {
  /** ISO 4217 destination currency code, e.g. "NGN" */
  toCurrency: string;
  /** Symbol for destination currency, e.g. "₦" */
  toSymbol: string;
  /** Country name shown in the CTA, e.g. "Nigeria" */
  toCountry: string;
  /** Flag emoji */
  toFlag: string;
  /** Optional: override default fee rate (default 0.012 = 1.2%) */
  feeRate?: number;
}

type InputCurrency = "USD" | "NGN";

const HIGH_VALUE_USD = 500; // 2FA required above this threshold

export function SendMoneyWidget({
  toCurrency,
  toSymbol,
  toCountry,
  toFlag,
  feeRate = 0.012,
}: SendMoneyWidgetProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [inputCurrency, setInputCurrency] = useState<InputCurrency>("USD");
  const [rawInput, setRawInput] = useState("500");

  // Confirmation dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientAccount, setRecipientAccount] = useState("");
  const [recipientBank, setRecipientBank] = useState("");
  const [description, setDescription] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [step, setStep] = useState<"details" | "2fa" | "success">("details");

  const { data: fxRates, isLoading: ratesLoading, refetch } = trpc.fx.rates.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const usdToLocal = fxRates?.find(r => r.currency === toCurrency)?.rate ?? 1;
  const usdToNgn = fxRates?.find(r => r.currency === "NGN")?.rate ?? 1540;

  const numericInput = parseFloat(rawInput.replace(/[^0-9.]/g, "")) || 0;
  const sendUSD = inputCurrency === "USD" ? numericInput : numericInput / usdToNgn;
  const feeUSD = sendUSD * feeRate;
  const afterFeeUSD = sendUSD - feeUSD;
  const recipientLocal = afterFeeUSD * usdToLocal;
  const recipientNgn = afterFeeUSD * usdToNgn;

  const fmtLocal = (v: number) =>
    `${toSymbol}${v.toLocaleString("en", { maximumFractionDigits: 0 })}`;
  const fmtNgn = (v: number) =>
    `₦${v.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
  const fmtUSD = (v: number) => `$${v.toFixed(2)}`;

  const displayFee =
    inputCurrency === "USD" ? fmtUSD(feeUSD) : fmtNgn(feeUSD * usdToNgn);

  const requires2FA = sendUSD >= HIGH_VALUE_USD;

  // tRPC mutation
  const sendMutation = trpc.transfer.send.useMutation({
    onSuccess: () => {
      setStep("success");
      toast("Transfer initiated", {
        description: `Your transfer to ${toCountry} is being processed.`,
      });
    },
    onError: (err) => {
      const msg = err.message ?? "Transfer failed";
      if (msg.includes("2FA_REQUIRED")) {
        setStep("2fa");
      } else {
        toast("Transfer failed", { description: msg });
      }
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, "");
    setRawInput(val);
  };

  const handleSendNow = () => {
    if (!user) {
      window.location.href = getLoginUrl();
      return;
    }
    // Reset dialog state
    setStep("details");
    setRecipientName("");
    setRecipientAccount("");
    setRecipientBank("");
    setDescription("");
    setTotpCode("");
    setDialogOpen(true);
  };

  const handleSubmitTransfer = useCallback(async () => {
    if (!recipientName.trim()) {
      toast("Recipient name required");
      return;
    }
    if (requires2FA && step === "details") {
      setStep("2fa");
      return;
    }
    const idempotencyKey = `${user?.id}-${toCurrency}-${Date.now()}`;
    sendMutation.mutate({
      fromCurrency: inputCurrency === "USD" ? "USD" : "NGN",
      amount: numericInput,
      toCurrency,
      recipientName: recipientName.trim(),
      recipientAccount: recipientAccount.trim() || undefined,
      recipientBank: recipientBank.trim() || undefined,
      recipientCountry: toCountry,
      description: description.trim() || undefined,
      totpCode: totpCode.trim() || undefined,
      idempotencyKey,
    });
  }, [recipientName, recipientAccount, recipientBank, description, totpCode, requires2FA, step, inputCurrency, numericInput, toCurrency, toCountry, user, sendMutation]);

  const quickAmountsUSD = [100, 250, 500, 1000];
  const quickAmountsNGN = [50000, 100000, 250000, 500000];
  const quickAmounts = inputCurrency === "USD" ? quickAmountsUSD : quickAmountsNGN;

  return (
    <>
      <div className="rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/80 to-violet-950/60 p-6 sm:p-8 shadow-2xl shadow-indigo-500/10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-white">Send Money to {toCountry}</h3>
            <p className="text-sm text-indigo-300 mt-0.5">See exactly what your family receives</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
              {ratesLoading ? "Loading..." : "Live rates"}
            </Badge>
            <button
              onClick={() => refetch()}
              className="text-indigo-400 hover:text-indigo-200 transition-colors"
              title="Refresh rates"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* You Send row */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-indigo-300 uppercase tracking-wide mb-2 block">
            You send
          </label>
          <div className="flex rounded-2xl border border-indigo-500/30 bg-black/30 overflow-hidden focus-within:border-indigo-400/60 transition-colors">
            <div className="flex border-r border-indigo-500/20">
              {(["USD", "NGN"] as InputCurrency[]).map(c => (
                <button
                  key={c}
                  onClick={() => {
                    setInputCurrency(c);
                    if (c === "NGN" && inputCurrency === "USD") {
                      setRawInput(Math.round(numericInput * usdToNgn).toString());
                    } else if (c === "USD" && inputCurrency === "NGN") {
                      setRawInput((numericInput / usdToNgn).toFixed(0));
                    }
                  }}
                  className={`px-3 py-3 text-sm font-bold transition-colors ${
                    inputCurrency === c
                      ? "bg-indigo-600 text-white"
                      : "text-indigo-400 hover:text-indigo-200"
                  }`}
                >
                  {c === "USD" ? "$" : "₦"}
                </button>
              ))}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={rawInput}
              onChange={handleInputChange}
              className="flex-1 bg-transparent px-4 py-3 text-xl font-bold text-white placeholder-indigo-500 outline-none min-w-0"
              placeholder="0"
            />
            <div className="flex items-center px-4 text-sm font-semibold text-indigo-300">
              {inputCurrency}
            </div>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            {quickAmounts.map(amt => (
              <button
                key={amt}
                onClick={() => setRawInput(amt.toString())}
                className="text-xs px-3 py-1 rounded-full border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-400/40 transition-colors"
              >
                {inputCurrency === "USD" ? `$${amt.toLocaleString()}` : `₦${amt.toLocaleString()}`}
              </button>
            ))}
          </div>
        </div>

        {/* Fee row */}
        <div className="flex items-center justify-between py-2 px-1 mb-2">
          <span className="text-sm text-indigo-400">RemitFlow fee (1.2%)</span>
          <span className="text-sm font-semibold text-indigo-300">{displayFee}</span>
        </div>
        <div className="flex items-center justify-between py-2 px-1 mb-4">
          <span className="text-sm text-indigo-400">Exchange rate</span>
          <span className="text-sm font-semibold text-indigo-300">
            $1 = {toSymbol}{usdToLocal.toLocaleString("en", { maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Recipient gets row */}
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 mb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wide mb-1">
                {toFlag} Your family receives
              </p>
              <p className="text-3xl font-extrabold text-white">
                {fmtLocal(recipientLocal)}
              </p>
              {toCurrency !== "NGN" && (
                <p className="text-sm text-emerald-300 mt-1">
                  ≈ {fmtNgn(recipientNgn)}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-indigo-400 mb-1">{toCurrency}</p>
              <BadgeCheck className="h-8 w-8 text-emerald-400 ml-auto" />
            </div>
          </div>
        </div>

        {/* Trust signals */}
        <div className="flex flex-wrap gap-3 mb-5 justify-center">
          {[
            { icon: <Zap className="h-3.5 w-3.5" />, label: "Arrives in ~2 min" },
            { icon: <Clock className="h-3.5 w-3.5" />, label: "24/7 transfers" },
            { icon: <BadgeCheck className="h-3.5 w-3.5" />, label: "FCA Regulated" },
          ].map(({ icon, label }) => (
            <span key={label} className="flex items-center gap-1 text-xs text-indigo-300">
              <span className="text-emerald-400">{icon}</span> {label}
            </span>
          ))}
        </div>

        {/* 2FA badge for high-value transfers */}
        {requires2FA && user && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 mb-4 text-xs text-amber-300">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            Transfers above ${HIGH_VALUE_USD} require 2FA verification
          </div>
        )}

        {/* CTA */}
        <Button
          onClick={handleSendNow}
          size="lg"
          className="w-full gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-500/30 text-base"
          disabled={sendUSD <= 0}
        >
          {user ? `Send to ${toCountry} Now` : "Sign In to Send"} <ArrowRight className="h-5 w-5" />
        </Button>
        <p className="text-center text-xs text-indigo-400 mt-3">
          Free to sign up · No hidden fees · Cancel anytime
        </p>
      </div>

      {/* ── Send Confirmation Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!sendMutation.isPending) setDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md bg-[#0f172a] border-indigo-500/20 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">
              {step === "success" ? "Transfer Initiated" : step === "2fa" ? "2FA Verification" : `Send to ${toCountry}`}
            </DialogTitle>
            <DialogDescription className="text-indigo-300">
              {step === "success"
                ? "Your transfer is being processed."
                : step === "2fa"
                ? "Enter your authenticator code to confirm this high-value transfer."
                : `Confirm recipient details for your ${inputCurrency === "USD" ? fmtUSD(sendUSD) : fmtNgn(numericInput)} transfer.`}
            </DialogDescription>
          </DialogHeader>

          {step === "success" && (
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle2 className="h-16 w-16 text-emerald-400" />
              <p className="text-emerald-300 font-semibold">Transfer submitted successfully</p>
              <p className="text-sm text-indigo-300">
                {fmtLocal(recipientLocal)} will arrive in ~2 minutes
              </p>
              <Button
                onClick={() => setDialogOpen(false)}
                className="mt-2 bg-indigo-600 hover:bg-indigo-500"
              >
                Done
              </Button>
            </div>
          )}

          {step === "details" && (
            <div className="space-y-4">
              {/* Transfer summary */}
              <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-4 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-indigo-300">You send</span>
                  <span className="font-semibold text-white">
                    {inputCurrency === "USD" ? fmtUSD(sendUSD) : fmtNgn(numericInput)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-indigo-300">Fee</span>
                  <span className="text-indigo-300">{displayFee}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-indigo-500/20 pt-1 mt-1">
                  <span className="text-emerald-300 font-semibold">They receive</span>
                  <span className="text-emerald-300 font-bold">{fmtLocal(recipientLocal)}</span>
                </div>
              </div>

              {/* Recipient details */}
              <div className="space-y-3">
                <div>
                  <Label className="text-indigo-300 text-xs">Recipient full name *</Label>
                  <Input
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="e.g. Amara Okonkwo"
                    className="mt-1 bg-black/30 border-indigo-500/30 text-white placeholder-indigo-500 focus:border-indigo-400"
                  />
                </div>
                <div>
                  <Label className="text-indigo-300 text-xs">Account / mobile number (optional)</Label>
                  <Input
                    value={recipientAccount}
                    onChange={e => setRecipientAccount(e.target.value)}
                    placeholder="Bank account or mobile money number"
                    className="mt-1 bg-black/30 border-indigo-500/30 text-white placeholder-indigo-500 focus:border-indigo-400"
                  />
                </div>
                <div>
                  <Label className="text-indigo-300 text-xs">Bank name (optional)</Label>
                  <Input
                    value={recipientBank}
                    onChange={e => setRecipientBank(e.target.value)}
                    placeholder="e.g. Zenith Bank, MTN Mobile Money"
                    className="mt-1 bg-black/30 border-indigo-500/30 text-white placeholder-indigo-500 focus:border-indigo-400"
                  />
                </div>
                <div>
                  <Label className="text-indigo-300 text-xs">Note (optional)</Label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="e.g. School fees, rent"
                    className="mt-1 bg-black/30 border-indigo-500/30 text-white placeholder-indigo-500 focus:border-indigo-400"
                  />
                </div>
              </div>
            </div>
          )}

          {step === "2fa" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                <Lock className="h-5 w-5 text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-300">High-value transfer</p>
                  <p className="text-xs text-amber-300/70 mt-0.5">
                    This transfer of {inputCurrency === "USD" ? fmtUSD(sendUSD) : fmtNgn(numericInput)} requires 2FA confirmation.
                  </p>
                </div>
              </div>
              <div>
                <Label className="text-indigo-300 text-xs">Authenticator code (6 digits)</Label>
                <Input
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  className="mt-1 bg-black/30 border-indigo-500/30 text-white placeholder-indigo-500 focus:border-indigo-400 text-center text-2xl tracking-[0.5em] font-mono"
                />
              </div>
              <button
                onClick={() => setStep("details")}
                className="text-xs text-indigo-400 hover:text-indigo-200 transition-colors"
              >
                ← Back to recipient details
              </button>
            </div>
          )}

          {step !== "success" && (
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={sendMutation.isPending}
                className="border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitTransfer}
                disabled={sendMutation.isPending || !recipientName.trim() || (step === "2fa" && totpCode.length < 6)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2"
              >
                {sendMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                ) : step === "2fa" ? (
                  <><Lock className="h-4 w-4" /> Verify & Send</>
                ) : requires2FA ? (
                  <><Lock className="h-4 w-4" /> Continue to 2FA</>
                ) : (
                  <>Confirm Transfer <ArrowRight className="h-4 w-4" /></>
                )}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
