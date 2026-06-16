import { toast } from 'sonner';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, CheckCircle } from "lucide-react";
import { useTranslation } from 'react-i18next';

const NG_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];

export default function RecipientOnboarding() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [bvn, setBvn] = useState("");
  const [state, setState] = useState("Lagos");
  const [channel, setChannel] = useState<"cash"|"mobile"|"account">("cash");
  const [completed, setCompleted] = useState(false);

  const addBeneficiaryMutation = trpc.beneficiaries.add.useMutation({
    onSuccess: () => { toast.success("Recipient onboarded successfully!"); setCompleted(true); },
    onError: (err) => toast.error(err.message),
  });
  const crossSellQuery = trpc.outbound.analytics.scoreCrossSell.useQuery(
    {segment:"labor",amount_usd:300,frequency_per_year:6,months_active:0,has_nigerian_account:false,has_diaspora_account:false,age_group:"26-35"},
    {enabled:step===3}
  );

  if (!isAuthenticated) return <div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Please log in.</p></div>;

  if (completed) return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-96"><CardContent className="pt-6 text-center space-y-4">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto"/>
        <h2 className="text-xl font-bold">Onboarding Complete!</h2>
        <p className="text-muted-foreground text-sm">{firstName} has been onboarded to RemitFlow.</p>
        <Button className="w-full" onClick={()=>{setStep(1);setCompleted(false);setFirstName("");setLastName("");setPhone("");setBvn("");}}>Onboard Another Recipient</Button>
      </CardContent></Card>
    </div>
  );

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg"><UserPlus className="h-6 w-6 text-green-600"/></div>
        <div>
          <h1 className="text-3xl font-bold">Recipient Onboarding</h1>
          <p className="text-muted-foreground">Migrate informal recipients to the formal RemitFlow network</p>
        </div>
      </div>
      <div className="flex gap-2">{[1,2,3].map(s=><div key={s} className={"flex-1 h-2 rounded-full "+(step>=s?"bg-primary":"bg-muted")}/>)}</div>
      {step===1&&(
        <Card>
          <CardHeader><CardTitle>Personal Details</CardTitle><CardDescription>Step 1 of 3</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>First Name</Label><Input value={firstName} onChange={e=>setFirstName(e.target.value)}/></div>
              <div className="space-y-2"><Label>Last Name</Label><Input value={lastName} onChange={e=>setLastName(e.target.value)}/></div>
            </div>
            <div className="space-y-2"><Label>Phone Number</Label><Input placeholder="+234..." value={phone} onChange={e=>setPhone(e.target.value)}/></div>
            <div className="space-y-2"><Label>State of Residence</Label>
              <Select value={state} onValueChange={setState}><SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{NG_STATES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={!firstName||!lastName||!phone} onClick={()=>setStep(2)}>Continue</Button>
          </CardContent>
        </Card>
      )}
      {step===2&&(
        <Card>
          <CardHeader><CardTitle>Verification and Channel</CardTitle><CardDescription>Step 2 of 3</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>BVN</Label><Input placeholder="22xxxxxxxxx" maxLength={11} value={bvn} onChange={e=>setBvn(e.target.value)}/></div>
            <div className="space-y-2"><Label>Preferred Receive Channel</Label>
              <Select value={channel} onValueChange={(v:any)=>setChannel(v)}><SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash pickup (agent network)</SelectItem>
                  <SelectItem value="mobile">Mobile money wallet</SelectItem>
                  <SelectItem value="account">Bank account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={()=>setStep(1)}>Back</Button>
              <Button className="flex-1" disabled={!bvn||bvn.length<11} onClick={()=>setStep(3)}>Continue</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {step===3&&(
        <Card>
          <CardHeader><CardTitle>Review and Confirm</CardTitle><CardDescription>Step 3 of 3</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">Name</span><span className="font-medium">{firstName} {lastName}</span>
              <span className="text-muted-foreground">Phone</span><span className="font-medium">{phone}</span>
              <span className="text-muted-foreground">State</span><span className="font-medium">{state}</span>
              <span className="text-muted-foreground">Channel</span><span className="font-medium capitalize">{channel}</span>
              <span className="text-muted-foreground">BVN</span><span className="font-medium">{"*".repeat(7)+bvn.slice(-4)}</span>
            </div>
            {crossSellQuery.data?(
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium">Recommended: {(crossSellQuery.data as any)?.recommended_product}</p>
                <p className="text-muted-foreground text-xs mt-1">{(crossSellQuery.data as any)?.next_best_action}</p>
              </div>
            ):null}
            <div className="flex gap-3">
              <Button variant="outline" onClick={()=>setStep(2)}>Back</Button>
              <Button className="flex-1" disabled={addBeneficiaryMutation.isPending} onClick={() => addBeneficiaryMutation.mutate({ name: `${firstName} ${lastName}`, phone, country: state, currency: "NGN" })}>
                Confirm Onboarding
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
