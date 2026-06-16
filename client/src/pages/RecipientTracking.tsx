import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, Send, Truck } from "lucide-react";
import { trpc } from "@/lib/trpc";

const STAGE_ICONS = [
  { icon: <Send className="h-5 w-5" />, label: "Initiated" },
  { icon: <Clock className="h-5 w-5" />, label: "Processing" },
  { icon: <Truck className="h-5 w-5" />, label: "Sent to Provider" },
  { icon: <CheckCircle2 className="h-5 w-5" />, label: "Delivered" },
];

export default function RecipientTracking() {
  const [transactionId, setTransactionId] = useState("");
  const txIdNum = Number(transactionId) || 0;
  const tracking = trpc.recipientExperience.trackDelivery.useQuery(
    { transactionId: txIdNum },
    { enabled: txIdNum > 0 }
  );

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Recipient Tracking">
      <h1 className="text-2xl font-bold">Track Your Transfer</h1>
      <div className="flex gap-3 max-w-md">
        <Input
          placeholder="Enter transaction ID"
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
          aria-label="Transaction ID"
        />
        <Button disabled={!transactionId}>Track</Button>
      </div>
      {tracking.data && (
        <Card>
          <CardHeader><CardTitle>Delivery Status</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {STAGE_ICONS.map((stage, i) => {
                const isActive = i <= (tracking.data.currentStage ?? 0);
                return (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-full ${isActive ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground"}`}>
                      {stage.icon}
                    </div>
                    <span className={`text-xs ${isActive ? "font-medium" : "text-muted-foreground"}`}>{stage.label}</span>
                    {i < STAGE_ICONS.length - 1 && <div className={`h-0.5 w-8 ${isActive ? "bg-green-400" : "bg-muted"}`} />}
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Estimated delivery: {tracking.data.eta ?? "2-4 hours"}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
