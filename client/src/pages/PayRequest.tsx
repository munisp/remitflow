import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle2, Clock, AlertCircle, DollarSign, RefreshCw, ArrowRight } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function PayRequest() {
  const params = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [customAmount, setCustomAmount] = useState("");

  const { data: req, isLoading, error } = trpc.requestMoney.getByToken.useQuery(
    { token: params.token ?? "" },
    { enabled: !!params.token, retry: false }
  );

  const payMutation = trpc.requestMoney.pay.useMutation({
    onSuccess: () => {
      toast.success("Payment sent successfully!");
      navigate("/transactions");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading payment request...</p>
        </div>
      </div>
    );
  }

  if (error || !req) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold">Request Not Found</h2>
            <p className="text-muted-foreground text-sm">
              {error?.message ?? "This payment request is invalid, expired, or has already been paid."}
            </p>
            <Button onClick={() => navigate("/")} variant="outline">Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasFixedAmount = req.amount !== null && req.amount !== undefined;
  const displayAmount = hasFixedAmount ? Number(req.amount) : null;

  return (

    <DashboardLayout>
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
            <DollarSign className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Payment Request</CardTitle>
          <CardDescription>Someone is requesting a payment via RemitFlow</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Request Details */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            {displayAmount && (
              <div className="text-center">
                <p className="text-3xl font-bold">
                  {displayAmount.toLocaleString()} <span className="text-lg text-muted-foreground">{req.currency}</span>
                </p>
              </div>
            )}
            {req.description && (
              <div className="text-center">
                <p className="text-sm text-muted-foreground">"{req.description}"</p>
              </div>
            )}
            {req.expiresAt && (
              <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Expires {new Date(req.expiresAt).toLocaleString()}
              </div>
            )}
          </div>

          {/* Amount input if not fixed */}
          {!hasFixedAmount && (
            <div className="space-y-1">
              <Label>Amount ({req.currency})</Label>
              <Input
                type="number"
                placeholder="Enter amount to pay"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                min="0.01"
                step="0.01"
              />
            </div>
          )}

          {req.status === "paid" ? (
            <div className="flex items-center justify-center gap-2 text-green-600 font-medium py-3">
              <CheckCircle2 className="h-5 w-5" />
              This request has already been paid
            </div>
          ) : (
            <Button
              className="w-full"
              size="lg"
              onClick={() => payMutation.mutate({
                token: params.token!,
                amount: !hasFixedAmount && customAmount ? Number(customAmount) : undefined,
              })}
              disabled={payMutation.isPending || (!hasFixedAmount && !customAmount)}
            >
              {payMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Pay Now
            </Button>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Powered by <span className="font-semibold text-primary">RemitFlow</span>
          </p>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
