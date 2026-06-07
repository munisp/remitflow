import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, TrendingUp, AlertCircle, Gift, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";

const NUDGE_ICONS: Record<string, React.ReactNode> = {
  rate_alert: <TrendingUp className="h-5 w-5 text-green-600" />,
  balance_threshold: <AlertCircle className="h-5 w-5 text-amber-600" />,
  kyc_upgrade: <Gift className="h-5 w-5 text-blue-600" />,
  inactivity: <Clock className="h-5 w-5 text-gray-600" />,
  recurring_reminder: <Bell className="h-5 w-5 text-purple-600" />,
};

export default function SmartNotifications() {
  const nudges = trpc.nudgeEngine.getUserNudges.useQuery();

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Smart Notifications">
      <h1 className="text-2xl font-bold">Smart Notifications</h1>
      <p className="text-muted-foreground">Personalized alerts and suggestions based on your activity</p>
      <div className="space-y-4">
        {nudges.data?.map((nudge: { type: string; title: string; message: string; actionUrl: string; priority: number }, i: number) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                {NUDGE_ICONS[nudge.type] ?? <Bell className="h-5 w-5" />}
              </div>
              <div className="flex-1">
                <p className="font-medium">{nudge.title}</p>
                <p className="text-sm text-muted-foreground">{nudge.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.href = nudge.actionUrl}>
                View
              </Button>
            </CardContent>
          </Card>
        )) ?? <p className="text-muted-foreground">No notifications right now</p>}
      </div>
    </div>
  );
}
