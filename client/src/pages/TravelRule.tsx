import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Shield, FileText, AlertTriangle, CheckCircle, Info } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const COUNTRIES = [
  { code: "NG", name: "Nigeria" }, { code: "KE", name: "Kenya" }, { code: "GH", name: "Ghana" },
  { code: "TZ", name: "Tanzania" }, { code: "UG", name: "Uganda" }, { code: "SN", name: "Senegal" },
  { code: "CM", name: "Cameroon" }, { code: "ZA", name: "South Africa" }, { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

export default function TravelRule() {
  const { t } = useTranslation();
  const [checkAmount, setCheckAmount] = useState(1500);
  const [toCountry, setToCountry] = useState("NG");
  const [form, setForm] = useState({
    beneficiaryFullName: "", beneficiaryAddress: "", beneficiaryAccountNumber: "",
    beneficiaryBankName: "", beneficiaryBankCountry: "NG", purposeOfTransfer: "", sourceOfFunds: "",
  });

  const { data: requirements } = trpc.travelRule.requirements.useQuery({
    amount: checkAmount, fromCurrency: "USD", toCurrency: "NGN", toCountry,
  });
  const { data: myRecords } = trpc.travelRule.myRecords.useQuery({ limit: 20, offset: 0 });
  const submitMutation = trpc.travelRule.submit.useMutation({
    onSuccess: () => { toast.success("Travel rule information submitted successfully"); },
    onError: (e) => toast.error(e.message),
  });

  const statusColor: Record<string, string> = {
    submitted: "bg-blue-100 text-blue-800",
    verified: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
  };

  return (

    <DashboardLayout>
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 rounded-lg"><Shield className="h-6 w-6 text-blue-600" /></div>
        <div>
          <h1 className="text-2xl font-bold">Travel Rule Compliance</h1>
          <p className="text-muted-foreground">FATF Recommendation 16 — Wire Transfer Information</p>
        </div>
      </div>

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4 flex gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800">
            <strong>What is the Travel Rule?</strong> The Financial Action Task Force (FATF) requires financial institutions to collect and transmit beneficiary and originator information for wire transfers of $1,000 or more. This helps prevent money laundering and terrorist financing.
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="check">
        <TabsList>
          <TabsTrigger value="check">Check Requirements</TabsTrigger>
          <TabsTrigger value="submit">Submit Information</TabsTrigger>
          <TabsTrigger value="records">My Records</TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle>Check Travel Rule Requirements</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Transfer Amount (USD)</Label>
                  <Input type="number" value={checkAmount} onChange={e => setCheckAmount(Number(e.target.value))} className="mt-1" />
                </div>
                <div>
                  <Label>Destination Country</Label>
                  <Select value={toCountry} onValueChange={setToCountry}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              {requirements && (
                <div className={`p-4 rounded-lg border ${requirements.required ? "border-orange-300 bg-orange-50" : "border-green-300 bg-green-50"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {requirements.required ? <AlertTriangle className="h-5 w-5 text-orange-600" /> : <CheckCircle className="h-5 w-5 text-green-600" />}
                    <span className={`font-semibold ${requirements.required ? "text-orange-800" : "text-green-800"}`}>
                      Travel Rule {requirements.required ? "REQUIRED" : "Not Required"}
                    </span>
                  </div>
                  {requirements.reason && <p className="text-sm text-orange-700 mb-3">{requirements.reason}</p>}
                  {requirements.isHighRisk && <Badge className="bg-red-100 text-red-800 mb-3">High-Risk Corridor — Enhanced Due Diligence Required</Badge>}
                  {requirements.requiredFields.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-orange-800 mb-2">Required information:</p>
                      <ul className="space-y-1">
                        {requirements.requiredFields.map((f: any) => (
                          <li key={f.field} className="text-sm text-orange-700 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                            {f.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">{requirements.regulatoryBasis}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="submit" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Submit Travel Rule Information</CardTitle>
              <CardDescription>Required for transfers of $1,000 or more</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: "beneficiaryFullName", label: "Beneficiary Full Legal Name" },
                  { key: "beneficiaryAddress", label: "Beneficiary Physical Address" },
                  { key: "beneficiaryAccountNumber", label: "Beneficiary Account Number" },
                  { key: "beneficiaryBankName", label: "Beneficiary Bank Name" },
                  { key: "purposeOfTransfer", label: "Purpose of Transfer" },
                  { key: "sourceOfFunds", label: "Source of Funds (if high-risk corridor)" },
                ].map(field => (
                  <div key={field.key} className={field.key === "beneficiaryAddress" || field.key === "purposeOfTransfer" ? "col-span-2" : ""}>
                    <Label>{field.label}</Label>
                    <Input className="mt-1" value={(form as any)[field.key]} onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <Label>Beneficiary Bank Country</Label>
                  <Select value={form.beneficiaryBankCountry} onValueChange={v => setForm(f => ({ ...f, beneficiaryBankCountry: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button className="w-full" disabled={submitMutation.isPending || !form.beneficiaryFullName || !form.beneficiaryAccountNumber}
                onClick={() => submitMutation.mutate({ ...form })}>
                {submitMutation.isPending ? "Submitting..." : "Submit Travel Rule Information"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="records" className="space-y-3 mt-4">
          {!myRecords?.records.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No travel rule records yet.</CardContent></Card>
          ) : myRecords.records.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex justify-between items-start">
                <div>
                  <div className="font-medium">{r.beneficiary_name}</div>
                  <div className="text-sm text-muted-foreground">{r.beneficiary_bank} · {r.purpose}</div>
                  <div className="text-xs text-muted-foreground mt-1">{new Date(r.submitted_at).toLocaleDateString()}</div>
                </div>
                <Badge className={statusColor[r.status] ?? "bg-gray-100 text-gray-800"}>{r.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
