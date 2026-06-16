import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TrendingUp, Users, DollarSign, Loader2 } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function FormalizationDashboard() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [cohortSize, setCohortSize] = useState("1000");
  const [channel, setChannel] = useState<"cash"|"mobile"|"account">("cash");
  const [months, setMonths] = useState("6");
  const [incentive, setIncentive] = useState(false);

  const formalQuery = trpc.outbound.analytics.formalizationRate.useQuery({
    cohort_size:parseInt(cohortSize)||1000,
    current_channel:channel,
    months_observed:parseInt(months)||6,
    incentive_offered:incentive,
  });
  const isError = formalQuery.isError;

  if (!isAuthenticated) return <div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Please log in.</p></div>;

  const data = formalQuery.data as any;

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Formalization Dashboard</h1>
        <p className="text-muted-foreground mt-1">Track informal-to-formal remittance migration and revenue uplift</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Cohort Parameters</CardTitle><CardDescription>Model a sender cohort to estimate formalization potential</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-2"><Label>Cohort Size</Label><Input type="number" value={cohortSize} onChange={e=>setCohortSize(e.target.value)}/></div>
          <div className="space-y-2"><Label>Current Channel</Label>
            <Select value={channel} onValueChange={(v:any)=>setChannel(v)}><SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash / Hawala</SelectItem>
                <SelectItem value="mobile">Mobile Money</SelectItem>
                <SelectItem value="account">Bank Account</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Months Observed</Label><Input type="number" value={months} onChange={e=>setMonths(e.target.value)}/></div>
          <div className="space-y-2"><Label>Incentive Offered</Label>
            <Button variant={incentive?"default":"outline"} className="w-full" onClick={()=>setIncentive(!incentive)}>
              {incentive?"Yes":"No"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {formalQuery.isPending&&<div className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4"/><span>Calculating...</span></div>}
      {data&&(
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg"><TrendingUp className="h-5 w-5 text-blue-600"/></div>
              <div><p className="text-sm text-muted-foreground">Migration Rate</p><p className="text-2xl font-bold">{(data.migration_rate*100).toFixed(1)}%</p></div>
            </div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg"><Users className="h-5 w-5 text-green-600"/></div>
              <div><p className="text-sm text-muted-foreground">Expected Conversions</p><p className="text-2xl font-bold">{data.expected_conversions?.toFixed(0)}</p></div>
            </div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 dark:bg-yellow-900 rounded-lg"><DollarSign className="h-5 w-5 text-yellow-600"/></div>
              <div><p className="text-sm text-muted-foreground">Revenue Uplift</p><p className="text-2xl font-bold">${data.revenue_uplift_usd?.toFixed(0)}</p></div>
            </div>
          </CardContent></Card>
        </div>
      )}
      {data&&(
        <Card>
          <CardHeader><CardTitle>Recommended Incentive</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">{data.recommended_incentive}</p>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Badge variant="outline">Channel: {channel}</Badge>
              <Badge variant="outline">{months} months</Badge>
              {incentive&&<Badge>Incentive active</Badge>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
