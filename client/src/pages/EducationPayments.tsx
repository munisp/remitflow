import { toast } from 'sonner';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Loader2, ArrowRight } from "lucide-react";
import { AnnualLimitBadge } from "@/components/AnnualLimitBadge";
import { CrossSellOfferModal } from "@/components/CrossSellOfferModal";

const EDU_COUNTRIES = [
  {code:"GB",name:"United Kingdom",currency:"GBP"},{code:"US",name:"United States",currency:"USD"},
  {code:"CA",name:"Canada",currency:"CAD"},{code:"AU",name:"Australia",currency:"AUD"},
  {code:"DE",name:"Germany",currency:"EUR"},{code:"NL",name:"Netherlands",currency:"EUR"},
];

export default function EducationPayments() {
  const { isAuthenticated } = useAuth();
  const [amountNgn, setAmountNgn] = useState("");
  const [country, setCountry] = useState("GB");
  const [institution, setInstitution] = useState("");
  const [studentId, setStudentId] = useState("");

  const selectedCountry = EDU_COUNTRIES.find(c=>c.code===country);

  const quoteQuery = trpc.outbound.swift.getQuote.useQuery(
    {amount_ngn:parseFloat(amountNgn)||1,destination_currency:selectedCountry?.currency??"GBP",purpose_code:"EDU",sender_segment:"education"},
    {enabled:parseFloat(amountNgn)>0}
  );
  const crossSellQuery = trpc.outbound.analytics.scoreCrossSell.useQuery(
    {segment:"education",amount_usd:(parseFloat(amountNgn)||0)/1600,frequency_per_year:2,months_active:6,has_nigerian_account:true,has_diaspora_account:false,age_group:"26-35"},
    {enabled:parseFloat(amountNgn)>0}
  );
  const submitMutation = trpc.outbound.swift.submitTransfer.useMutation({
    onSuccess:()=>toast("Education Payment Submitted", { description: "Your tuition payment is being processed." }),
    onError:(e)=>toast.error("Error"),
  });

  if (!isAuthenticated) return <div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Please log in.</p></div>;

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <CrossSellOfferModal segment="education" />
      <AnnualLimitBadge purposeCode="EDU" />
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg"><GraduationCap className="h-6 w-6 text-blue-600"/></div>
        <div>
          <h1 className="text-3xl font-bold">Education Payments</h1>
          <p className="text-muted-foreground">Direct tuition payments to universities abroad — CBN Form A approved</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Payment Details</CardTitle><CardDescription>Tuition, accommodation, and school fees</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Amount (NGN)</Label><Input type="number" placeholder="e.g. 8000000" value={amountNgn} onChange={e=>setAmountNgn(e.target.value)}/></div>
            <div className="space-y-2"><Label>Destination Country</Label>
              <Select value={country} onValueChange={setCountry}><SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{EDU_COUNTRIES.map(c=><SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Institution Name</Label><Input placeholder="University of Manchester" value={institution} onChange={e=>setInstitution(e.target.value)}/></div>
            <div className="space-y-2"><Label>Student ID / Reference</Label><Input placeholder="STU-2024-001234" value={studentId} onChange={e=>setStudentId(e.target.value)}/></div>
            <Button className="w-full" disabled={!amountNgn||!institution||submitMutation.isPending}
              onClick={()=>submitMutation.mutate({amount_ngn:parseFloat(amountNgn),destination_currency:selectedCountry?.currency??"GBP",purpose_code:"EDU",sender_segment:"education",beneficiary_name:institution,beneficiary_account:studentId||"PENDING",beneficiary_bank_swift:"PENDING00",beneficiary_country:country})}>
              {submitMutation.isPending?<><Loader2 className="animate-spin h-4 w-4 mr-2"/>Processing...</>:<>Submit Payment <ArrowRight className="ml-2 h-4 w-4"/></>}
            </Button>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {quoteQuery.data&&(
            <Card>
              <CardHeader><CardTitle className="text-base">Live Quote</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">You send</span><span className="font-bold">NGN {parseFloat(amountNgn).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Institution receives</span><span className="font-bold">{(quoteQuery.data as any)?.destination_amount?.toFixed(2)} {selectedCountry?.currency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">FX Rate</span><span>{(quoteQuery.data as any)?.exchange_rate?.toFixed(4)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fee</span><span>NGN {(quoteQuery.data as any)?.total_fee_ngn?.toLocaleString()}</span></div>
                <Badge className="mt-2" variant="outline">Education corridor — reduced spread</Badge>
              </CardContent>
            </Card>
          )}
          {crossSellQuery.data&&(
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader><CardTitle className="text-base text-blue-700 dark:text-blue-300">Recommended for You</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                <p className="font-medium">{(crossSellQuery.data as any)?.recommended_product}</p>
                <p className="text-muted-foreground">{(crossSellQuery.data as any)?.next_best_action}</p>
                <p className="text-xs text-muted-foreground">Est. LTV: ${(crossSellQuery.data as any)?.expected_ltv_usd?.toFixed(0)}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
