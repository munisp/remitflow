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
import { Heart, Loader2, ArrowRight } from "lucide-react";

const MED_COUNTRIES = [
  {code:"IN",name:"India",currency:"INR"},{code:"TH",name:"Thailand",currency:"THB"},
  {code:"DE",name:"Germany",currency:"EUR"},{code:"GB",name:"United Kingdom",currency:"GBP"},
  {code:"US",name:"United States",currency:"USD"},{code:"ZA",name:"South Africa",currency:"ZAR"},
];
const TREATMENT_TYPES = ["Cardiac Surgery","Orthopaedic Surgery","Oncology Treatment","Fertility Treatment","Dental / Oral Surgery","Ophthalmology","General Consultation"];

export default function MedicalTourism() {
  const { isAuthenticated } = useAuth();
  const [amountNgn, setAmountNgn] = useState("");
  const [country, setCountry] = useState("IN");
  const [hospital, setHospital] = useState("");
  const [treatment, setTreatment] = useState("Cardiac Surgery");
  const [patientRef, setPatientRef] = useState("");

  const selectedCountry = MED_COUNTRIES.find(c=>c.code===country);

  const quoteQuery = trpc.outbound.swift.getQuote.useQuery(
    {amount_ngn:parseFloat(amountNgn)||1,destination_currency:selectedCountry?.currency??"USD",purpose_code:"MED",sender_segment:"medical"},
    {enabled:parseFloat(amountNgn)>0}
  );
  const submitMutation = trpc.outbound.swift.submitTransfer.useMutation({
    onSuccess:()=>toast("Medical Payment Submitted", { description: "Your hospital payment is being processed via SWIFT." }),
    onError:(e)=>toast.error("Error"),
  });

  if (!isAuthenticated) return <div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Please log in.</p></div>;

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg"><Heart className="h-6 w-6 text-red-600"/></div>
        <div>
          <h1 className="text-3xl font-bold">Medical Tourism Payments</h1>
          <p className="text-muted-foreground">Direct hospital payments abroad — CBN Form M approved</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Payment Details</CardTitle><CardDescription>Hospital deposits, treatment fees, and accommodation</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Amount (NGN)</Label><Input type="number" placeholder="e.g. 12000000" value={amountNgn} onChange={e=>setAmountNgn(e.target.value)}/></div>
            <div className="space-y-2"><Label>Destination Country</Label>
              <Select value={country} onValueChange={setCountry}><SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{MED_COUNTRIES.map(c=><SelectItem key={c.code} value={c.code}>{c.name} ({c.currency})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Hospital / Clinic Name</Label><Input placeholder="Apollo Hospitals, Chennai" value={hospital} onChange={e=>setHospital(e.target.value)}/></div>
            <div className="space-y-2"><Label>Treatment Type</Label>
              <Select value={treatment} onValueChange={setTreatment}><SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{TREATMENT_TYPES.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Patient Reference / Invoice No.</Label><Input placeholder="PAT-2024-0012" value={patientRef} onChange={e=>setPatientRef(e.target.value)}/></div>
            <Button className="w-full" disabled={!amountNgn||!hospital||submitMutation.isPending}
              onClick={()=>submitMutation.mutate({amount_ngn:parseFloat(amountNgn),destination_currency:selectedCountry?.currency??"USD",purpose_code:"MED",sender_segment:"medical",beneficiary_name:hospital,beneficiary_account:patientRef||"PENDING",beneficiary_bank_swift:"PENDING00",beneficiary_country:country})}>
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
                <div className="flex justify-between"><span className="text-muted-foreground">Hospital receives</span><span className="font-bold">{(quoteQuery.data as any)?.destination_amount?.toFixed(2)} {selectedCountry?.currency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">FX Rate</span><span>{(quoteQuery.data as any)?.exchange_rate?.toFixed(4)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fee</span><span>NGN {(quoteQuery.data as any)?.total_fee_ngn?.toLocaleString()}</span></div>
                <Badge className="mt-2" variant="outline">Medical corridor — priority processing</Badge>
              </CardContent>
            </Card>
          )}
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader><CardTitle className="text-base">Required Documents</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1 text-muted-foreground">
              <p>- Hospital invoice or admission letter</p>
              <p>- Valid Nigerian passport (BVN-linked)</p>
              <p>- CBN Form M (generated automatically)</p>
              <p>- Medical referral letter (if applicable)</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
