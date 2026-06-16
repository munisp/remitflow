import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Home, Upload, CheckCircle, Clock, FileText, AlertCircle, Plus, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const OWNERSHIP_TYPES = ["sole_owner", "joint_owner", "company_owned", "trust_owned", "leasehold"];
const DOC_TYPES = ["property_deed", "land_certificate", "mortgage_statement", "utility_bill", "council_tax", "lease_agreement"];
type PropertySubmission = { id: number; address: string; value: number; ownershipType: string; docType: string; status: string; submittedAt: string };

const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
  verified: { color: "bg-green-500/10 text-green-400", icon: CheckCircle, label: "Verified" },
  under_review: { color: "bg-yellow-500/10 text-yellow-400", icon: Clock, label: "Under Review" },
  rejected: { color: "bg-red-500/10 text-red-400", icon: AlertCircle, label: "Rejected" },
  pending: { color: "bg-blue-500/10 text-blue-400", icon: Clock, label: "Pending" },
};

export default function PropertyKYC() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [value, setValue] = useState("");
  const [ownershipType, setOwnershipType] = useState("sole_owner");
  const [docType, setDocType] = useState("property_deed");
  const { data: kycData, refetch } = trpc.kyc.status.useQuery();
  const submitKyc = trpc.kyc.uploadDocument.useMutation({
    onSuccess: () => { refetch(); toast.success("Property KYC submitted for review!"); setOpen(false); setAddress(""); setValue(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const tier = (kycData as any)?.currentTier ?? 1;
  const submissions: PropertySubmission[] = ((kycData as any)?.documents ?? []).map((d: any, i: number) => ({
    id: d.id ?? i + 1,
    address: d.address ?? d.documentType ?? "Property",
    value: d.value ?? 0,
    ownershipType: d.ownershipType ?? "sole_owner",
    docType: d.documentType ?? "property_deed",
    status: d.status ?? "pending",
    submittedAt: d.createdAt ?? d.submittedAt ?? new Date().toISOString(),
  }));
  const verifiedCount = submissions.filter(s => s.status === "verified" || s.status === "approved").length;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><Home className="h-5 w-5 text-amber-600" /></div>
            <div><h1 className="text-2xl font-bold">Property KYC</h1><p className="text-muted-foreground text-sm">Verify property ownership for high-value transfers</p></div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add Property</Button>
        </div>

        {/* KYC Status Banner */}
        <Card className={tier >= 3 ? "border-green-500/30 bg-green-500/5" : "border-yellow-500/30 bg-yellow-500/5"}>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className={"h-8 w-8 " + (tier >= 3 ? "text-green-400" : "text-yellow-400")} />
            <div className="flex-1">
              <div className="font-medium">KYC Tier {tier} — {tier >= 3 ? "Property transfers unlocked" : "Tier 3 required for property transfers"}</div>
              <div className="text-xs text-muted-foreground">{verifiedCount} of {submissions.length} properties verified</div>
            </div>
            <Badge className={tier >= 3 ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}>{tier >= 3 ? "Active" : "Upgrade Required"}</Badge>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Verified", value: submissions.filter(s => s.status === "verified").length, color: "text-green-400" },
            { label: "Under Review", value: submissions.filter(s => s.status === "under_review").length, color: "text-yellow-400" },
            { label: "Rejected", value: submissions.filter(s => s.status === "rejected").length, color: "text-red-400" },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent></Card>
          ))}
        </div>

        {/* Submissions List */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Property Submissions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {submissions.map(sub => {
              const cfg = statusConfig[sub.status] ?? statusConfig.pending;
              const Icon = cfg.icon;
              return (
                <div key={sub.id} className="flex items-start gap-3 p-3 border rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{sub.address}</div>
                    <div className="text-xs text-muted-foreground">
                      ${Number(sub.value ?? 0).toLocaleString()} · {sub.ownershipType.replace(/_/g, " ")} · {sub.docType.replace(/_/g, " ")}
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(sub.submittedAt).toLocaleDateString()}</div>
                  </div>
                  <Badge className={`text-xs flex items-center gap-1 ${cfg.color}`}>
                    <Icon className="h-3 w-3" />{cfg.label}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Requirements */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Accepted Documents</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {DOC_TYPES.map(d => (
                <div key={d} className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50">
                  <CheckCircle className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                  <span className="capitalize">{d.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Submit Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Add Property for Verification</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Full property address" value={address} onChange={e => setAddress(e.target.value)} />
              <Input placeholder="Estimated value (USD)" type="number" value={value} onChange={e => setValue(e.target.value)} />
              <Select value={ownershipType} onValueChange={setOwnershipType}>
                <SelectTrigger><SelectValue placeholder="Ownership type" /></SelectTrigger>
                <SelectContent>{OWNERSHIP_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue placeholder="Document type" /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
              <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                Documents are reviewed within 2–5 business days. You will be notified by email upon completion.
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!address || !value || submitKyc.isPending}
                onClick={() => submitKyc.mutate({ type: docType as any, fileBase64: "pending", fileName: `${docType}.pdf`, mimeType: "application/pdf" })}>
                <Upload className="h-4 w-4 mr-2" />{submitKyc.isPending ? "Submitting..." : "Submit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
