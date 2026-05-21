import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, History, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const CONSENT_TYPES = [
  { id: "essential", label: "Essential Processing", description: "Required for account operation, transaction processing, and legal compliance.", required: true, category: "Essential" },
  { id: "aml_screening", label: "AML/Sanctions Screening", description: "Required by law — screen transactions against sanctions lists and AML databases.", required: true, category: "Compliance" },
  { id: "location", label: "Location Data", description: "Use approximate location for fraud detection and regulatory compliance.", required: false, category: "Security" },
  { id: "biometric", label: "Biometric Data Processing", description: "Process facial recognition data for liveness checks during enhanced KYC.", required: false, category: "KYC" },
  { id: "analytics", label: "Analytics & Performance", description: "Collect anonymised usage data to improve the platform experience.", required: false, category: "Analytics" },
  { id: "marketing", label: "Marketing Communications", description: "Receive promotional emails, SMS, and push notifications about offers.", required: false, category: "Marketing" },
  { id: "third_party_sharing", label: "Third-Party Data Sharing", description: "Share data with regulated financial partners for enhanced services.", required: false, category: "Data Sharing" },
  { id: "profiling", label: "Automated Profiling", description: "Allow automated decision-making for personalised FX rates and recommendations.", required: false, category: "AI/ML" },
];

type ConsentHistoryItem = { id: number; type: string; action: string; date: string; method: string };

export default function ConsentManagement() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"preferences" | "history">("preferences");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [consents, setConsents] = useState<Record<string, boolean>>({ marketing: true, analytics: true, third_party_sharing: false, profiling: false, biometric: false, location: true, essential: true, aml_screening: true });
  const { data: consentData, refetch } = trpc.consent.list.useQuery();
  const updateConsent = trpc.consent.update.useMutation({ onSuccess: () => refetch() });
  const exportData = trpc.gdpr.exportData.useMutation({ onSuccess: () => toast.success("Data export request submitted. You will receive an email within 72 hours."), onError: (e: any) => toast.error(e.message) });
  const deleteAccount = trpc.gdpr.deleteAccount.useMutation({ onSuccess: () => toast.success("Account deletion request submitted."), onError: (e: any) => toast.error(e.message) });
  const handleToggle = (id: string, value: boolean) => {
    setConsents(prev => ({ ...prev, [id]: value }));
    updateConsent.mutate({ consentType: id, granted: value });
    toast.success(`${value ? "Consent granted" : "Consent withdrawn"} for ${CONSENT_TYPES.find(t => t.id === id)?.label}`);
  };
  const handleWithdrawAll = () => { const u: Record<string, boolean> = {}; CONSENT_TYPES.forEach(t => { u[t.id] = t.required; }); setConsents(u); setWithdrawAll(false); toast.success("All optional consents withdrawn."); };
  const grantedCount = CONSENT_TYPES.filter(t => !t.required && consents[t.id]).length;
  const totalOptional = CONSENT_TYPES.filter(t => !t.required).length;
  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-primary" /><div><h1 className="text-2xl font-bold">Consent Management</h1><p className="text-muted-foreground text-sm">Manage your data processing preferences under GDPR</p></div></div>
        <Card className="bg-primary/5 border-primary/20"><CardContent className="p-4 flex items-center justify-between">
          <div><div className="font-semibold text-sm">{grantedCount}/{totalOptional} optional consents granted</div><div className="text-xs text-muted-foreground mt-0.5">Required processing is always active per legal obligations</div></div>
          <Button variant="outline" size="sm" onClick={() => setWithdrawAll(true)} className="text-red-400 border-red-500/30 hover:bg-red-500/10">Withdraw All</Button>
        </CardContent></Card>
        <div className="flex gap-2 border-b">
          {(["preferences", "history"] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`pb-2 px-1 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t === "preferences" ? "Preferences" : "Consent History"}</button>)}
        </div>
        {tab === "preferences" ? (
          <div className="space-y-3">
            {["Essential", "Compliance", "Security", "KYC", "Analytics", "Marketing", "Data Sharing", "AI/ML"].map(category => {
              const items = CONSENT_TYPES.filter(t => t.category === category);
              if (!items.length) return null;
              return (<div key={category}>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{category}</div>
                <div className="space-y-2">{items.map(ct => (
                  <Card key={ct.id} className={ct.required ? "opacity-80" : ""}><CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1"><div className="flex items-center gap-2 mb-1"><Label htmlFor={ct.id} className="font-medium text-sm cursor-pointer">{ct.label}</Label>{ct.required && <Badge className="text-xs bg-blue-500/10 text-blue-400">Required</Badge>}</div><p className="text-xs text-muted-foreground">{ct.description}</p></div>
                      <Switch id={ct.id} checked={consents[ct.id] ?? false} onCheckedChange={v => !ct.required && handleToggle(ct.id, v)} disabled={ct.required} />
                    </div>
                  </CardContent></Card>
                ))}</div>
              </div>);
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {(((consentData as any)?.history ?? []) as ConsentHistoryItem[]).map((h: ConsentHistoryItem) => (
              <Card key={h.id}><CardContent className="p-4 flex items-center justify-between">
                <div><div className="font-medium text-sm capitalize">{h.type.replace(/_/g, " ")}</div><div className="text-xs text-muted-foreground">{new Date(h.date).toLocaleString()} · {h.method}</div></div>
                <Badge className={`text-xs capitalize ${h.action === "granted" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{h.action}</Badge>
              </CardContent></Card>
            ))}
          </div>
        )}
        <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />Your GDPR Rights</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between p-3 border rounded-xl"><div><div className="font-medium text-sm">Right to Data Portability</div><div className="text-xs text-muted-foreground">Download all your personal data</div></div><Button variant="outline" size="sm" onClick={() => exportData.mutate()} disabled={exportData.isPending}><Download className="h-3.5 w-3.5 mr-1.5" />{exportData.isPending ? "Requesting..." : "Export"}</Button></div>
            <div className="flex items-center justify-between p-3 border rounded-xl"><div><div className="font-medium text-sm text-red-400">Right to Erasure</div><div className="text-xs text-muted-foreground">Request deletion of your account and all data</div></div><Button variant="outline" size="sm" className="text-red-400 border-red-500/30" onClick={() => deleteAccount.mutate()} disabled={deleteAccount.isPending}><AlertTriangle className="h-3.5 w-3.5 mr-1.5" />{deleteAccount.isPending ? "Requesting..." : "Delete"}</Button></div>
          </CardContent>
        </Card>
        <Dialog open={withdrawAll} onOpenChange={setWithdrawAll}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-red-400"><AlertTriangle className="h-5 w-5" />Withdraw All Optional Consents</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground py-2">This will withdraw all optional consents. Required processing continues as required by law.</p><DialogFooter><Button variant="outline" onClick={() => setWithdrawAll(false)}>Cancel</Button><Button variant="destructive" onClick={handleWithdrawAll}>Withdraw All Optional</Button></DialogFooter></DialogContent></Dialog>
      </div>
    </DashboardLayout>
  );
}
