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
import { Loader2, ArrowRight, ShieldCheck, Globe } from "lucide-react";
import { AnnualLimitBadge } from "@/components/AnnualLimitBadge";
import { CrossSellOfferModal } from "@/components/CrossSellOfferModal";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["USD","GBP","EUR","CAD","AUD","JPY","CNY"];
const PURPOSE_CODES = [
  {code:"EDU",label:"Education / Tuition"},{code:"MED",label:"Medical / Healthcare"},
  {code:"TRD",label:"Trade / Import Payment"},{code:"FAM",label:"Family Support"},
  {code:"INV",label:"Investment"},{code:"SVC",label:"Professional Services"},
];

export default function SendFromNigeria() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [amountNgn, setAmountNgn] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [purposeCode, setPurposeCode] = useState("FAM");
  const [segment, setSegment] = useState<"labor"|"education"|"medical"|"sme"|"hnw">("labor");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryAccount, setBeneficiaryAccount] = useState("");
  const [beneficiarySwift, setBeneficiarySwift] = useState("");
  const [beneficiaryCountry, setBeneficiaryCountry] = useState("GB");
  const [step, setStep] = useState<"form"|"quote"|"confirm">("form");

  const quoteQuery = trpc.outbound.swift.getQuote.useQuery(
    {amount_ngn:parseFloat(amountNgn)||1,destination_currency:currency,purpose_code:purposeCode,sender_segment:segment},
    {enabled:step==="quote"&&parseFloat(amountNgn)>0}
  );
  const submitMutation = trpc.outbound.swift.submitTransfer.useMutation({
    onSuccess:(data:any)=>{toast("Transfer Submitted", { description: "SWIFT ref: " });setStep("form");},
    onError:(e)=>toast.error("Error"),
  });
  const feeScheduleQuery = trpc.outbound.swift.getFeeSchedule.useQuery();

  if (!isAuthenticated) return <div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Please log in.</p></div>;

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <CrossSellOfferModal segment={segment} />
      <div>
        <h1 className="text-3xl font-bold">Send Money Abroad</h1>
        <p className="text-muted-foreground mt-1">CBN-compliant outbound SWIFT transfers from Nigeria</p>
      </div>
      {/* v199: Annual limit badge for selected purpose code */}
      <AnnualLimitBadge purposeCode={purposeCode} />
      {step==="form"&&(
        <Card>
          <CardHeader><CardTitle>Transfer Details</CardTitle><CardDescription>All transfers are subject to CBN Form A/M approval</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Amount (NGN)</Label><Input type="number" placeholder="e.g. 5000000" value={amountNgn} onChange={e=>setAmountNgn(e.target.value)}/></div>
              <div className="space-y-2"><Label>Destination Currency</Label>
                <Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Purpose Code</Label>
                <Select value={purposeCode} onValueChange={setPurposeCode}><SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{PURPOSE_CODES.map(p=><SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Sender Segment</Label>
                <Select value={segment} onValueChange={(v:any)=>setSegment(v)}><SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="labor">Labour Diaspora</SelectItem>
                    <SelectItem value="education">Education</SelectItem>
                    <SelectItem value="medical">Medical</SelectItem>
                    <SelectItem value="sme">SME / Trade</SelectItem>
                    <SelectItem value="hnw">High Net Worth</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* v199: compact limit badge inside form */}
            <AnnualLimitBadge purposeCode={purposeCode} compact className="mb-2" />
            <div className="space-y-2"><Label>Beneficiary Name</Label><Input placeholder="Full legal name" value={beneficiaryName} onChange={e=>setBeneficiaryName(e.target.value)}/></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Account / IBAN</Label><Input placeholder="GB29NWBK..." value={beneficiaryAccount} onChange={e=>setBeneficiaryAccount(e.target.value)}/></div>
              <div className="space-y-2"><Label>SWIFT / BIC Code</Label><Input placeholder="NWBKGB2L" value={beneficiarySwift} onChange={e=>setBeneficiarySwift(e.target.value)}/></div>
            </div>
            <div className="space-y-2"><Label>Beneficiary Country (ISO-2)</Label><Input placeholder="GB" maxLength={2} value={beneficiaryCountry} onChange={e=>setBeneficiaryCountry(e.target.value.toUpperCase())}/></div>
            <Button className="w-full" onClick={()=>setStep("quote")} disabled={!amountNgn||!beneficiaryName||!beneficiaryAccount||!beneficiarySwift}>
              Get Quote <ArrowRight className="ml-2 h-4 w-4"/>
            </Button>
          </CardContent>
        </Card>
      )}
      {step==="quote"&&(
        <Card>
          <CardHeader><CardTitle>Transfer Quote</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {quoteQuery.isPending&&<div className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4"/><span>Fetching live rate...</span></div>}
            {quoteQuery.data?(
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">You send</p><p className="text-xl font-bold">NGN {parseFloat(amountNgn).toLocaleString()}</p></div>
                  <div><p className="text-muted-foreground">Recipient gets</p><p className="text-xl font-bold">{(quoteQuery.data as any)?.destination_amount?.toFixed(2)} {currency}</p></div>
                  <div><p className="text-muted-foreground">FX Rate</p><p className="font-semibold">{(quoteQuery.data as any)?.exchange_rate?.toFixed(4)}</p></div>
                  <div><p className="text-muted-foreground">Total Fee</p><p className="font-semibold">NGN {(quoteQuery.data as any)?.total_fee_ngn?.toLocaleString()}</p></div>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline"><ShieldCheck className="h-3 w-3 mr-1"/>CBN Compliant</Badge>
                  <Badge variant="outline"><Globe className="h-3 w-3 mr-1"/>SWIFT Network</Badge>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={()=>setStep("form")}>Back</Button>
                  <Button className="flex-1" onClick={()=>setStep("confirm")}>Confirm Transfer</Button>
                </div>
              </div>
            ):null}
            {quoteQuery.error&&<p className="text-destructive text-sm">{quoteQuery.error.message}</p>}
          </CardContent>
        </Card>
      )}
      {step==="confirm"&&(
        <Card>
          <CardHeader><CardTitle>Confirm Transfer</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">By confirming, you authorise RemitFlow to process this SWIFT transfer under CBN regulations.</p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={()=>setStep("quote")}>Back</Button>
              <Button className="flex-1" disabled={submitMutation.isPending} onClick={()=>submitMutation.mutate({
                amount_ngn:parseFloat(amountNgn),destination_currency:currency,purpose_code:purposeCode,
                sender_segment:segment,beneficiary_name:beneficiaryName,beneficiary_account:beneficiaryAccount,
                beneficiary_bank_swift:beneficiarySwift,beneficiary_country:beneficiaryCountry,
              })}>
                {submitMutation.isPending?<><Loader2 className="animate-spin h-4 w-4 mr-2"/>Submitting...</>:"Submit Transfer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">Fee Schedule</CardTitle></CardHeader>
        <CardContent>
          {feeScheduleQuery.isPending&&<Loader2 className="animate-spin h-4 w-4"/>}
          {feeScheduleQuery.data?(
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b"><th className="text-left py-2">Segment</th><th className="text-right py-2">Fee %</th><th className="text-right py-2">Spread (bps)</th><th className="text-right py-2">Min Fee</th></tr></thead>
                <tbody>
                  {Object.entries((feeScheduleQuery.data as any)?.segments??{}).map(([seg,info]:[string,any])=>(
                    <tr key={seg} className="border-b last:border-0">
                      <td className="py-2 capitalize">{seg}</td>
                      <td className="text-right">{info.fee_pct}%</td>
                      <td className="text-right">{info.spread_bps} bps</td>
                      <td className="text-right">NGN {info.min_fee_ngn?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ):null}
        </CardContent>
      </Card>
    </div>
  );
}
