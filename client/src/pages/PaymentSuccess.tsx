/**
 * Payment Success Page — RemitFlow v98.3
 *
 * Shown after a successful Stripe checkout session.
 * Reads session_id from query params, polls wallet balance, and shows confirmation.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Wallet, ArrowRight, Home, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

export default function PaymentSuccess() {
  const [, navigate] = useLocation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [credited, setCredited] = useState(false);

  // Read session_id from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session_id") ?? params.get("topup");
    if (sid && sid !== "success") setSessionId(sid);
  }, []);

  // Poll wallet to detect credit
  const { data: wallets, refetch } = trpc.wallet.list.useQuery(undefined, {
    refetchInterval: credited ? false : pollCount < 10 ? 3000 : false,
  });

  useEffect(() => {
    if (wallets && pollCount > 0) {
      setCredited(true);
      toast.success("Your wallet has been credited!", { duration: 5000 });
    }
    if (pollCount < 10) setPollCount(c => c + 1);
  }, [wallets]);

  const totalBalance = wallets?.reduce((sum, w) => sum + Number(w.balance ?? 0), 0) ?? 0;

  return (

    <DashboardLayout>
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          {/* Success icon */}
          <div className="flex justify-center">
            <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 p-6">
              <CheckCircle className="h-12 w-12 text-emerald-500" />
            </div>
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Payment Successful!</h1>
            <p className="text-muted-foreground mt-2">
              Your Stripe payment was processed successfully. Your wallet will be credited within seconds.
            </p>
          </div>

          {/* Session ID */}
          {sessionId && (
            <div className="bg-muted rounded-lg p-3 text-left">
              <p className="text-xs text-muted-foreground">Session ID</p>
              <p className="font-mono text-xs break-all mt-1">{sessionId}</p>
            </div>
          )}

          {/* Wallet status */}
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium">Wallet Balance</span>
              </div>
              {!credited && pollCount < 10 && (
                <Badge variant="secondary" className="gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Updating…
                </Badge>
              )}
              {credited && <Badge className="bg-emerald-500">Credited</Badge>}
            </div>
            {wallets && wallets.length > 0 && (
              <div className="mt-3 space-y-1">
                {wallets.map(w => (
                  <div key={w.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{w.currency}</span>
                    <span className="font-semibold">{Number(w.balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Test card notice */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-left">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Test Mode</p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
              This was a test payment. Use card <span className="font-mono font-bold">4242 4242 4242 4242</span> with any future date and any CVC for test transactions.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 gap-2" onClick={() => navigate("/wallet")}>
              <Wallet className="h-4 w-4" />
              View Wallet
            </Button>
            <Button className="flex-1 gap-2" onClick={() => navigate("/")}>
              <Home className="h-4 w-4" />
              Dashboard
            </Button>
          </div>

          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => navigate("/send")}>
            Send Money
            <ArrowRight className="h-3 w-3" />
          </Button>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
