import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Store, CheckCircle, XCircle, Clock, Search, Plus } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function MerchantOnboardingPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<"pending"|"active"|"suspended"|"rejected"|"all">("all");
  const [search, setSearch] = useState("");
  const [approveDialog, setApproveDialog] = useState<number | null>(null);
  const [feeRate, setFeeRate] = useState("1.5");
  const [applyDialog, setApplyDialog] = useState(false);
  const [applyForm, setApplyForm] = useState({ businessName: "", businessType: "retail", country: "NG", registrationNumber: "", expectedMonthlyVolume: "" });

  const { data: merchants, refetch } = trpc.v100.merchantOnboarding.getMerchants.useQuery({ status: statusFilter, limit: 50 });
  const approveMutation = trpc.v100.merchantOnboarding.approveMerchant.useMutation({
    onSuccess: () => { toast.success("Merchant approved"); setApproveDialog(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const applyMutation = trpc.v100.merchantOnboarding.applyAsMerchant.useMutation({
    onSuccess: (d) => { toast.success(d.message); setApplyDialog(false); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = (merchants ?? []).filter((m: any) =>
    !search || m.businessName?.toLowerCase().includes(search.toLowerCase()) || m.email?.toLowerCase().includes(search.toLowerCase())
  );

  const statusIcon = (s: string) => {
    if (s === "active") return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (s === "rejected") return <XCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-orange-500" />;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Merchant Onboarding</h1>
          <p className="text-muted-foreground">KYB verification, fee schedules, and merchant activation</p>
        </div>
        <Dialog open={applyDialog} onOpenChange={setApplyDialog}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Apply as Merchant</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Merchant Application</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Business Name</Label>
                <Input value={applyForm.businessName} onChange={e => setApplyForm(f => ({ ...f, businessName: e.target.value }))} placeholder="Acme Ltd" />
              </div>
              <div><Label>Business Type</Label>
                <Select value={applyForm.businessType} onValueChange={v => setApplyForm(f => ({ ...f, businessType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["retail","ecommerce","services","food","fintech"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Country</Label>
                <Select value={applyForm.country} onValueChange={v => setApplyForm(f => ({ ...f, country: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[["NG","Nigeria"],["GH","Ghana"],["KE","Kenya"],["ZA","South Africa"],["SN","Senegal"]].map(([c,n]) => (
                      <SelectItem key={c} value={c}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Registration Number</Label>
                <Input value={applyForm.registrationNumber} onChange={e => setApplyForm(f => ({ ...f, registrationNumber: e.target.value }))} placeholder="RC123456" />
              </div>
              <div><Label>Expected Monthly Volume (USD)</Label>
                <Input value={applyForm.expectedMonthlyVolume} onChange={e => setApplyForm(f => ({ ...f, expectedMonthlyVolume: e.target.value }))} type="number" placeholder="50000" />
              </div>
              <Button className="w-full" onClick={() => applyMutation.mutate({
                ...applyForm, expectedMonthlyVolume: Number(applyForm.expectedMonthlyVolume),
              })} disabled={applyMutation.isPending}>
                {applyMutation.isPending ? "Submitting..." : "Submit Application"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search merchants..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all","pending","active","suspended","rejected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total", value: (merchants ?? []).length, color: "text-foreground" },
          { label: "Active", value: (merchants ?? []).filter((m: any) => m.status === "active").length, color: "text-green-500" },
          { label: "Pending", value: (merchants ?? []).filter((m: any) => m.status === "pending").length, color: "text-orange-500" },
          { label: "Rejected", value: (merchants ?? []).filter((m: any) => m.status === "rejected").length, color: "text-red-500" },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Merchants Table */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Store className="w-4 h-4" />Merchants ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left p-2">Business</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Country</th>
                  <th className="text-right p-2">Monthly Vol</th>
                  <th className="text-right p-2">Fee Rate</th>
                  <th className="text-left p-2">KYB</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m: any) => (
                  <tr key={m.id} className="border-b hover:bg-muted/30">
                    <td className="p-2">
                      <p className="font-medium">{m.businessName}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </td>
                    <td className="p-2 capitalize">{m.businessType}</td>
                    <td className="p-2">{m.country}</td>
                    <td className="p-2 text-right">${(m.monthlyVolume / 1000).toFixed(0)}K</td>
                    <td className="p-2 text-right">{m.feeRate}%</td>
                    <td className="p-2">
                      <Badge variant={m.kybStatus === "verified" ? "default" : "secondary"}>{m.kybStatus}</Badge>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">{statusIcon(m.status)}<span className="capitalize">{m.status}</span></div>
                    </td>
                    <td className="p-2">
                      {m.status === "pending" && (
                        <Dialog open={approveDialog === m.id} onOpenChange={open => setApproveDialog(open ? m.id : null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">Approve</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Approve {m.businessName}</DialogTitle></DialogHeader>
                            <div className="space-y-3">
                              <div><Label>Fee Rate (%)</Label>
                                <Input value={feeRate} onChange={e => setFeeRate(e.target.value)} type="number" step="0.1" />
                              </div>
                              <Button className="w-full" onClick={() => approveMutation.mutate({ merchantId: m.id, feeRate: Number(feeRate) })}>
                                Confirm Approval
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
