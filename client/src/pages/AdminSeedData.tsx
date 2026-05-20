import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Database, RefreshCw, CheckCircle, AlertTriangle, Users, Wallet, ArrowRightLeft, Target, Globe } from "lucide-react";
import { useTranslation } from 'react-i18next';

const SEED_PREVIEW = [
  { icon: Globe, label: "FX Rates", count: "6 currency pairs", detail: "USD/NGN, GBP/NGN, EUR/NGN, USD/GHS, USD/KES, USD/ZAR" },
  { icon: Wallet, label: "Demo Wallets", count: "4 wallets", detail: "USD $2,500 · GBP £1,800 · EUR €2,100 · NGN ₦1,250,000" },
  { icon: Users, label: "Beneficiaries", count: "3 recipients", detail: "Amaka (GTBank Lagos) · Kwame (MTN MoMo Ghana) · Fatima (Orange Money Senegal)" },
  { icon: ArrowRightLeft, label: "Transactions", count: "5 transfers", detail: "School fees, family support, rent, business investment, incoming" },
  { icon: Target, label: "Savings Goals", count: "2 goals", detail: "Emergency Fund ($5,000 target) · Lagos Property Deposit ($50,000 target)" },
];

export default function AdminSeedData() {
  const { t } = useTranslation();
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const seed = trpc.admin.seedDemoData.useMutation({
    onSuccess: (data) => {
      setLog(data.steps);
      setDone(true);
      toast.success(`Demo data seeded — ${data.totalSteps} steps completed`);
    },
    onError: (err) => {
      toast.error(`Seed failed: ${err.message}`);
    },
  });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-6 h-6 text-emerald-600" />
            Seed Demo Data
          </h1>
          <p className="text-muted-foreground mt-1">
            Populate your account with realistic demo data — wallets, transactions, beneficiaries, FX rates, and savings goals — in one click. No CLI required.
          </p>
        </div>

        {/* Preview table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What will be seeded</CardTitle>
            <CardDescription>All data is attached to your admin account and can be used immediately after seeding.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {SEED_PREVIEW.map((item) => (
              <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <item.icon className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{item.label}</span>
                    <Badge variant="secondary" className="text-xs">{item.count}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Action button */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Ready to seed?</p>
                <p className="text-sm text-muted-foreground">Uses INSERT … ON DUPLICATE KEY UPDATE — safe to run multiple times.</p>
              </div>
              <Button
                onClick={() => { setLog([]); setDone(false); seed.mutate({}); }}
                disabled={seed.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
              >
                {seed.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Seeding…</>
                ) : (
                  <><Database className="w-4 h-4 mr-2" />Seed Demo Data</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Progress log */}
        {(seed.isPending || log.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {done ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />}
                {done ? "Seeding complete" : "Seeding in progress…"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 font-mono text-sm bg-muted rounded-lg p-4 max-h-64 overflow-y-auto">
                {log.length === 0 && seed.isPending && (
                  <p className="text-muted-foreground animate-pulse">Starting seed process…</p>
                )}
                {log.map((line, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {line.startsWith("✅") ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    )}
                    <span className={line.startsWith("✅") ? "text-foreground" : "text-amber-600"}>{line.replace(/^[✅⚠️]\s*/, "")}</span>
                  </div>
                ))}
              </div>
              {done && (
                <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                    ✅ Demo data is live. Navigate to Dashboard, Wallet, or Transactions to see your seeded data.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
