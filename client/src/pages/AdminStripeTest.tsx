import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CreditCard, ExternalLink, CheckCircle, XCircle, AlertTriangle, Zap, Copy, DollarSign } from "lucide-react";
import { useTranslation } from 'react-i18next';

const TEST_CARDS = [
  { number: "4242 4242 4242 4242", type: "Visa", result: "✅ Success", badge: "success", detail: "Any future date, any 3-digit CVC" },
  { number: "4000 0025 0000 3155", type: "Visa (3D Secure)", result: "🔐 3D Secure", badge: "warning", detail: "Requires authentication step" },
  { number: "4000 0000 0000 9995", type: "Visa", result: "❌ Declined (insufficient funds)", badge: "destructive", detail: "Card declined with insufficient_funds code" },
  { number: "4000 0000 0000 0002", type: "Visa", result: "❌ Declined (generic)", badge: "destructive", detail: "Generic card_declined error" },
  { number: "4000 0000 0000 0069", type: "Visa", result: "❌ Expired card", badge: "destructive", detail: "expired_card error code" },
  { number: "4000 0000 0000 0127", type: "Visa", result: "❌ Incorrect CVC", badge: "destructive", detail: "incorrect_cvc error code" },
];

const AMOUNTS = [10, 25, 50, 100, 250, 500];

export default function AdminStripeTest() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(50);
  const [customAmount, setCustomAmount] = useState("");

  const createSession = trpc.wallet.stripeTopup.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.info("Opening Stripe checkout in a new tab…");
        window.open(data.checkoutUrl, "_blank");
      }
    },
    onError: (err) => toast.error(`Checkout failed: ${err.message}`),
  });

  const copyCard = (num: string) => {
    navigator.clipboard.writeText(num.replace(/\s/g, ""));
    toast.success("Card number copied to clipboard");
  };

  const finalAmount = customAmount ? parseFloat(customAmount) : amount;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-violet-600" />
            Stripe Payment Testing
          </h1>
          <p className="text-muted-foreground mt-1">
            Test the full payment flow using Stripe test cards. All transactions in test mode are free and never charge real money.
          </p>
        </div>

        {/* Stripe sandbox claim banner */}
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-300 text-sm">Claim your Stripe sandbox to activate test payments</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Your Stripe test sandbox has been provisioned but needs to be claimed before it expires. Click below to complete the setup — it takes under 2 minutes.
                </p>
                <Button
                  size="sm"
                  className="mt-2 bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => window.open("https://dashboard.stripe.com/claim_sandbox/YWNjdF8xVE1iTHBQT3ZoSWtIRzdHLDE3NzY4OTUzNjkv100BUtiTYmc", "_blank")}
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Claim Stripe Sandbox
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Test top-up */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Test a Top-Up Payment
              </CardTitle>
              <CardDescription>Select an amount and open Stripe Checkout to test the full payment flow.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Quick amounts (USD)</Label>
                <div className="grid grid-cols-3 gap-2">
                  {AMOUNTS.map((a) => (
                    <Button
                      key={a}
                      variant={amount === a && !customAmount ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setAmount(a); setCustomAmount(""); }}
                      className="text-sm"
                    >
                      ${a}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Or enter custom amount</Label>
                <Input
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="e.g. 75"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="text-sm"
                />
              </div>
              <Button
                className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                disabled={createSession.isPending || !finalAmount || finalAmount < 1}
                onClick={() => createSession.mutate({ amount: Math.round(finalAmount * 100), currency: "usd", walletCurrency: "USD" })}
              >
                {createSession.isPending ? (
                  "Opening checkout…"
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Open Stripe Checkout — ${finalAmount || "?"}</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Use card <code className="bg-muted px-1 rounded">4242 4242 4242 4242</code> with any future date and any CVC
              </p>
            </CardContent>
          </Card>

          {/* Webhook status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-600" />
                Webhook Configuration
              </CardTitle>
              <CardDescription>Stripe sends events to your server to confirm payments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm font-medium">Webhook Endpoint</span>
                  <code className="text-xs bg-muted px-2 py-0.5 rounded">/api/stripe/webhook</code>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm font-medium">Signature Verification</span>
                  <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700">Active</Badge>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm font-medium">Events Handled</span>
                  <span className="text-xs text-muted-foreground">checkout.session.completed</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm font-medium">Test Event Support</span>
                  <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700">✓ evt_test_ handled</Badge>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => window.open("https://dashboard.stripe.com/test/webhooks", "_blank")}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                View Webhooks in Stripe Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Test cards reference */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test Card Reference</CardTitle>
            <CardDescription>Use these card numbers in Stripe Checkout. Expiry: any future date. CVC: any 3 digits. ZIP: any 5 digits.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-4 font-medium">Card Number</th>
                    <th className="text-left py-2 pr-4 font-medium">Type</th>
                    <th className="text-left py-2 pr-4 font-medium">Result</th>
                    <th className="text-left py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {TEST_CARDS.map((card) => (
                    <tr key={card.number} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{card.number}</code>
                          <button
                            onClick={() => copyCard(card.number)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy card number"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground">{card.type}</td>
                      <td className="py-2.5 pr-4">
                        <Badge
                          variant={card.badge as any}
                          className={`text-xs ${card.badge === "success" ? "bg-emerald-100 text-emerald-700" : card.badge === "warning" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}
                        >
                          {card.result}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground">{card.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-400">
                <strong>Going live?</strong> Once your Stripe account is verified (KYC complete), replace the test keys with live keys in Settings → Payment. A 99% discount promo code is available for live mode testing with real cards.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
