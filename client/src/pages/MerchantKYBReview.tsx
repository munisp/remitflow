import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, CheckCircle, XCircle, Clock, Plus, FileCheck } from "lucide-react";
import { useTranslation } from 'react-i18next';

const INDUSTRIES = ["retail", "ecommerce", "hospitality", "logistics", "healthcare", "education", "fintech", "agriculture", "manufacturing", "other"];
const COUNTRIES = ["NG", "GH", "KE", "ZA", "GB", "US", "CA", "AE", "DE", "FR"];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  under_review: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  suspended: "bg-orange-100 text-orange-700",
};

export default function MerchantKYBReview() {
  const { t } = useTranslation();
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({
    businessName: "", registrationNumber: "", taxId: "",
    industry: "retail", country: "NG", website: "",
  });

  const utils = trpc.useUtils();
  const { data: applications, isLoading } = trpc.merchantKybReview.adminList.useQuery({});

  // submit: { businessName, registrationNumber?, taxId?, country, industry?, website? }
  const submitApplication = trpc.merchantKybReview.submit.useMutation({
    onSuccess: () => {
      toast("Application submitted", { description: "Your KYB application is under review. Typical turnaround: 2-3 business days." });
      utils.merchantKybReview.adminList.invalidate();
      setApplyOpen(false);
      setForm({ businessName: "", registrationNumber: "", taxId: "", industry: "retail", country: "NG", website: "" });
    },
    onError: (e) => toast.error("Submission failed", { description: e.message }),
  });

  // adminReview: { reviewId, decision, riskRating?, rejectionReason?, notes? }
  const adminReview = trpc.merchantKybReview.adminReview.useMutation({
    onSuccess: () => {
      toast("Review submitted", { description: "KYB application status updated." });
      utils.merchantKybReview.adminList.invalidate();
    },
    onError: (e) => toast.error("Review failed", { description: e.message }),
  });

  const total = applications?.length ?? 0;
  const underReview = applications?.filter((a: any) => a.status === "under_review").length ?? 0;
  const approved = applications?.filter((a: any) => a.status === "approved").length ?? 0;
  const rejected = applications?.filter((a: any) => a.status === "rejected").length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Merchant KYB Review</h1>
          <p className="text-muted-foreground text-sm mt-1">Know Your Business — onboard and verify merchant partners</p>
        </div>
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Apply as Merchant</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Merchant KYB Application</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="col-span-2">
                <Label className="text-xs">Business Name</Label>
                <Input placeholder="Acme Ltd" value={form.businessName}
                  onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Registration Number</Label>
                <Input placeholder="RC123456" value={form.registrationNumber}
                  onChange={e => setForm(f => ({ ...f, registrationNumber: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Tax ID / TIN</Label>
                <Input placeholder="12345678-0001" value={form.taxId}
                  onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Industry</Label>
                <Select value={form.industry} onValueChange={v => setForm(f => ({ ...f, industry: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Country (2-letter)</Label>
                <Select value={form.country} onValueChange={v => setForm(f => ({ ...f, country: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Website (optional)</Label>
                <Input placeholder="https://acme.com" value={form.website}
                  onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full mt-4"
              onClick={() => submitApplication.mutate({
                businessName: form.businessName,
                registrationNumber: form.registrationNumber || undefined,
                taxId: form.taxId || undefined,
                country: form.country,
                industry: form.industry || undefined,
                website: form.website || undefined,
              })}
              disabled={submitApplication.isPending || !form.businessName || !form.country}>
              {submitApplication.isPending ? "Submitting..." : "Submit KYB Application"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Applications", value: String(total), icon: Building2, color: "text-blue-600" },
          { label: "Under Review", value: String(underReview), icon: Clock, color: "text-amber-600" },
          { label: "Approved Merchants", value: String(approved), icon: CheckCircle, color: "text-green-600" },
          { label: "Rejected", value: String(rejected), icon: XCircle, color: "text-red-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted"><Icon className={`w-5 h-5 ${color}`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">KYB Applications</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : !applications?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No applications yet.</p>
            </div>
          ) : (
            <div className="divide-y">
              {applications?.map((app: any) => (
                <div key={app.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{app.businessName}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {app.industry} · {app.country}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(app.createdAt).toLocaleDateString()}</p>
                  <Badge className={`text-xs ${STATUS_COLORS[app.status] ?? ""}`}>{app.status.replace(/_/g, " ")}</Badge>
                  {(app.status === "pending" || app.status === "under_review") && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => adminReview.mutate({ reviewId: app.id, decision: "approved" })}
                        disabled={adminReview.isPending}>
                        <CheckCircle className="w-3 h-3 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-600"
                        onClick={() => adminReview.mutate({ reviewId: app.id, decision: "rejected", rejectionReason: "Documentation incomplete" })}
                        disabled={adminReview.isPending}>
                        <XCircle className="w-3 h-3 mr-1" />Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
