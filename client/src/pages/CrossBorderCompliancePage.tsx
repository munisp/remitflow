import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Globe, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function CrossBorderCompliancePage() {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    userId: 1,
    amount: 5000,
    fromCountry: "NG",
    toCountry: "GB",
    currency: "USD",
    purpose: "Family support",
  });

  const { data: riskMatrix } = trpc.v101.crossBorderCompliance.getCountryRiskMatrix.useQuery();
  const checkTx = trpc.v101.crossBorderCompliance.checkTransaction.useMutation({
    onSuccess: (d) => {
      if (d.approved) toast.success(`Transaction approved — Risk Score: ${d.riskScore}`);
      else toast.error(`Transaction declined — Risk Score: ${d.riskScore}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cross-Border Compliance</h1>
        <p className="text-muted-foreground">
          Real-time compliance checks for cross-border transactions with jurisdiction risk mapping
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              Transaction Compliance Check
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>User ID</Label>
                <Input
                  type="number"
                  value={form.userId}
                  onChange={(e) => setForm((p) => ({ ...p, userId: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>Amount (USD)</Label>
                <Input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>From Country</Label>
                <Input
                  value={form.fromCountry}
                  onChange={(e) => setForm((p) => ({ ...p, fromCountry: e.target.value }))}
                  placeholder="NG"
                />
              </div>
              <div>
                <Label>To Country</Label>
                <Input
                  value={form.toCountry}
                  onChange={(e) => setForm((p) => ({ ...p, toCountry: e.target.value }))}
                  placeholder="GB"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Input
                  value={form.currency}
                  onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
                />
              </div>
              <div>
                <Label>Purpose</Label>
                <Input
                  value={form.purpose}
                  onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))}
                />
              </div>
            </div>
            <Button
              onClick={() => checkTx.mutate(form)}
              disabled={checkTx.isPending}
              className="w-full"
            >
              {checkTx.isPending ? "Checking..." : "Run Compliance Check"}
            </Button>

            {checkTx.data && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center gap-2">
                  {checkTx.data.approved ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  <span className="font-semibold">
                    {checkTx.data.approved ? "APPROVED" : "DECLINED"}
                  </span>
                  <Badge
                    className={
                      checkTx.data.riskScore > 70
                        ? "bg-red-100 text-red-800"
                        : checkTx.data.riskScore > 40
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-green-100 text-green-800"
                    }
                  >
                    Risk Score: {checkTx.data.riskScore}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(checkTx.data.checks).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1">
                      {v ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-500" />
                      )}
                      <span className="capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                    </div>
                  ))}
                </div>
                {checkTx.data.requiresDocumentation && (
                  <div className="flex items-center gap-2 text-yellow-700 bg-yellow-50 p-2 rounded text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Documentation required (amount &gt; $10,000)
                  </div>
                )}
                {checkTx.data.requiresEnhancedDueDiligence && (
                  <div className="flex items-center gap-2 text-red-700 bg-red-50 p-2 rounded text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Enhanced due diligence required (amount &gt; $25,000)
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Country Risk Matrix
            </CardTitle>
          </CardHeader>
          <CardContent>
            {riskMatrix ? (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-red-600 mb-2">
                    High Risk Countries ({riskMatrix.highRisk.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {riskMatrix.highRisk.map((c: string) => (
                      <Badge key={c} className="bg-red-100 text-red-800 text-xs">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-yellow-600 mb-2">
                    Medium Risk Countries ({riskMatrix.mediumRisk.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {riskMatrix.mediumRisk.map((c: string) => (
                      <Badge key={c} className="bg-yellow-100 text-yellow-800 text-xs">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-green-600 mb-2">
                    Low Risk Countries ({riskMatrix.lowRisk.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {riskMatrix.lowRisk.slice(0, 24).map((c: string) => (
                      <Badge key={c} className="bg-green-100 text-green-800 text-xs">
                        {c}
                      </Badge>
                    ))}
                    {riskMatrix.lowRisk.length > 24 && (
                      <Badge className="bg-gray-100 text-gray-600 text-xs">
                        +{riskMatrix.lowRisk.length - 24} more
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm text-center py-8">
                Loading risk matrix...
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  

    </DashboardLayout>

  );
}
