/**
 * Payment Cancel Page — RemitFlow v98.3
 *
 * Shown when user cancels a Stripe checkout session.
 */
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle, Wallet, RefreshCw, Home } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function PaymentCancel() {
  const [, navigate] = useLocation();

  return (

    <DashboardLayout>
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          {/* Cancel icon */}
          <div className="flex justify-center">
            <div className="rounded-full bg-amber-100 dark:bg-amber-900/30 p-6">
              <XCircle className="h-12 w-12 text-amber-500" />
            </div>
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Payment Cancelled</h1>
            <p className="text-muted-foreground mt-2">
              Your payment was cancelled. No charge was made to your card.
            </p>
          </div>

          {/* Info */}
          <div className="bg-muted rounded-lg p-4 text-left space-y-2">
            <p className="text-sm font-medium">What happened?</p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>You clicked "Cancel" on the Stripe checkout page</li>
              <li>Your wallet balance was not changed</li>
              <li>No funds were deducted from your card</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 gap-2" onClick={() => navigate("/wallet")}>
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            <Button className="flex-1 gap-2" onClick={() => navigate("/")}>
              <Home className="h-4 w-4" />
              Dashboard
            </Button>
          </div>

          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => navigate("/wallet")}>
            <Wallet className="h-4 w-4" />
            Go to Wallet
          </Button>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
