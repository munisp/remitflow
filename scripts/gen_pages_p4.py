#!/usr/bin/env python3
"""Generate pages - Part 4: Final 21 missing pages"""
import os

D = "/home/ubuntu/remitflow/client/src/pages"
os.makedirs(D, exist_ok=True)

pages = {}

# ── KYCVerification ───────────────────────────────────────────────────────────
pages["KYCVerification"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Shield, Upload, CheckCircle2, Clock, AlertCircle, ChevronRight, User, FileText, Camera } from "lucide-react";
import { toast } from "sonner";

const TIERS = [
  { tier: 1, name: "Basic", limit: "₦500K/day", requirements: ["Phone number", "Email address", "BVN verification"], status: "completed" },
  { tier: 2, name: "Standard", limit: "₦5M/day", requirements: ["Government ID", "Selfie verification", "Address proof"], status: "in_progress" },
  { tier: 3, name: "Enhanced", limit: "Unlimited", requirements: ["Bank statement (3 months)", "Utility bill", "Enhanced due diligence"], status: "locked" },
];

const DOCS = [
  { id: "nin", label: "National ID (NIN)", icon: FileText, status: "uploaded", uploadedAt: "Mar 10, 2024" },
  { id: "selfie", label: "Selfie / Liveness Check", icon: Camera, status: "verified", uploadedAt: "Mar 10, 2024" },
  { id: "address", label: "Proof of Address", icon: FileText, status: "pending", uploadedAt: null },
];

export default function KYCVerification() {
  const [bvn, setBvn] = useState("");
  const [step, setStep] = useState(1);

  const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
    completed: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, label: "Completed" },
    in_progress: { color: "bg-blue-100 text-blue-700", icon: Clock, label: "In Progress" },
    locked: { color: "bg-gray-100 text-gray-500", icon: Shield, label: "Locked" },
    uploaded: { color: "bg-blue-100 text-blue-700", icon: Clock, label: "Under Review" },
    verified: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, label: "Verified" },
    pending: { color: "bg-yellow-100 text-yellow-700", icon: AlertCircle, label: "Required" },
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Shield className="h-5 w-5 text-emerald-600" /></div>
          <div><h1 className="text-2xl font-bold">KYC Verification</h1><p className="text-muted-foreground text-sm">Verify your identity to unlock higher limits</p></div>
        </div>

        <div className="grid gap-3">
          {TIERS.map(t => {
            const cfg = STATUS_CONFIG[t.status];
            const Icon = cfg.icon;
            return (
              <Card key={t.tier} className={t.status === "locked" ? "opacity-60" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={"w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg " + cfg.color}>{t.tier}</div>
                      <div><div className="font-semibold">Tier {t.tier} — {t.name}</div><div className="text-xs text-muted-foreground">Limit: {t.limit}</div></div>
                    </div>
                    <Badge className={"text-xs border-0 " + cfg.color}><Icon className="h-3 w-3 mr-1" />{cfg.label}</Badge>
                  </div>
                  <div className="space-y-1">
                    {t.requirements.map(r => (
                      <div key={r} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className={"h-3 w-3 " + (t.status === "completed" ? "text-emerald-500" : "text-muted-foreground/40")} />
                        {r}
                      </div>
                    ))}
                  </div>
                  {t.status === "in_progress" && (
                    <Button className="mt-3 w-full" size="sm" onClick={() => toast.success("Opening verification flow...")}>Continue Verification <ChevronRight className="h-4 w-4 ml-1" /></Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Document Status</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {DOCS.map(doc => {
              const cfg = STATUS_CONFIG[doc.status];
              const Icon = doc.icon;
              const CfgIcon = cfg.icon;
              return (
                <div key={doc.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{doc.label}</div>
                    {doc.uploadedAt && <div className="text-xs text-muted-foreground">Uploaded {doc.uploadedAt}</div>}
                  </div>
                  {doc.status === "pending"
                    ? <Button size="sm" variant="outline" onClick={() => toast.success("Opening upload...")}><Upload className="h-4 w-4 mr-1" />Upload</Button>
                    : <Badge className={"text-xs border-0 " + cfg.color}><CfgIcon className="h-3 w-3 mr-1" />{cfg.label}</Badge>
                  }
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── PropertyKYC ───────────────────────────────────────────────────────────────
pages["PropertyKYC"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Home, Upload, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";

const PROPERTY_DOCS = [
  { id: "title_deed", label: "Title Deed / Certificate of Occupancy", status: "verified", uploadedAt: "Feb 5, 2024" },
  { id: "survey", label: "Survey Plan", status: "uploaded", uploadedAt: "Feb 6, 2024" },
  { id: "valuation", label: "Property Valuation Report", status: "pending", uploadedAt: null },
  { id: "tax", label: "Land Use Charge Receipt", status: "pending", uploadedAt: null },
];

export default function PropertyKYC() {
  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><Home className="h-5 w-5 text-amber-600" /></div>
          <div><h1 className="text-2xl font-bold">Property KYC</h1><p className="text-muted-foreground text-sm">Property verification for real estate transactions</p></div>
        </div>

        <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
              <div className="text-sm"><span className="font-medium">Property verification required</span> for transactions above ₦10M involving real estate. Upload all required documents to proceed.</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Property Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Property address" />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="State" />
              <Input placeholder="LGA" />
            </div>
            <Input placeholder="Property type (e.g. Residential, Commercial)" />
            <Input placeholder="Estimated value (NGN)" type="number" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Required Documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {PROPERTY_DOCS.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{doc.label}</div>
                  {doc.uploadedAt && <div className="text-xs text-muted-foreground">Uploaded {doc.uploadedAt}</div>}
                </div>
                {doc.status === "pending"
                  ? <Button size="sm" variant="outline" onClick={() => toast.success("Opening upload...")}><Upload className="h-4 w-4 mr-1" />Upload</Button>
                  : <Badge className={"text-xs border-0 " + (doc.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                      <CheckCircle2 className="h-3 w-3 mr-1" />{doc.status === "verified" ? "Verified" : "Under Review"}
                    </Badge>
                }
              </div>
            ))}
          </CardContent>
        </Card>

        <Button className="w-full" onClick={() => toast.success("Property KYC submitted for review!")}>Submit for Review</Button>
      </div>
    </AppLayout>
  );
}
'''

# ── TravelRule ────────────────────────────────────────────────────────────────
pages["TravelRule"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Shield, CheckCircle2, Clock, AlertTriangle, Search } from "lucide-react";

export default function TravelRule() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const { data: records } = trpc.travelRule.records.useQuery({ search, status });

  const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
    compliant: { color: "bg-emerald-100 text-emerald-700", label: "Compliant" },
    pending: { color: "bg-yellow-100 text-yellow-700", label: "Pending" },
    flagged: { color: "bg-red-100 text-red-700", label: "Flagged" },
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Globe className="h-5 w-5 text-blue-600" /></div>
          <div><h1 className="text-2xl font-bold">Travel Rule</h1><p className="text-muted-foreground text-sm">FATF Travel Rule compliance for cross-border transfers</p></div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Records", value: "1,247", color: "text-foreground" },
            { label: "Compliant", value: "1,189", color: "text-emerald-600" },
            { label: "Pending Review", value: "58", color: "text-yellow-600" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <div className={"text-2xl font-bold " + s.color}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by reference or name..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="compliant">Compliant</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {(records ?? []).map((r: any) => {
            const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending;
            return (
              <div key={r.id} className="flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{r.reference}</span>
                    <Badge className={"text-xs border-0 " + cfg.color}>{cfg.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.originatorName} → {r.beneficiaryName}</div>
                  <div className="text-xs text-muted-foreground">{r.originatorVASP} → {r.beneficiaryVASP}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-sm">{r.currency} {r.amount?.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{r.createdAt}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── FCACompliance ─────────────────────────────────────────────────────────────
pages["FCACompliance"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, CheckCircle2, AlertTriangle, Clock, FileText, Download } from "lucide-react";
import { toast } from "sonner";

export default function FCACompliance() {
  const { data: report } = trpc.compliance.fcaReport.useQuery();

  const checks = [
    { label: "AML Policy", status: "compliant", lastReview: "Jan 2024", nextReview: "Jan 2025" },
    { label: "CTF Procedures", status: "compliant", lastReview: "Jan 2024", nextReview: "Jan 2025" },
    { label: "Customer Due Diligence", status: "compliant", lastReview: "Feb 2024", nextReview: "Feb 2025" },
    { label: "Transaction Monitoring", status: "review_needed", lastReview: "Nov 2023", nextReview: "Overdue" },
    { label: "Suspicious Activity Reporting", status: "compliant", lastReview: "Mar 2024", nextReview: "Mar 2025" },
    { label: "Record Keeping", status: "compliant", lastReview: "Mar 2024", nextReview: "Mar 2025" },
    { label: "Staff Training", status: "in_progress", lastReview: "Dec 2023", nextReview: "Jun 2024" },
    { label: "Senior Manager Accountability", status: "compliant", lastReview: "Jan 2024", nextReview: "Jan 2025" },
  ];

  const compliantCount = checks.filter(c => c.status === "compliant").length;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Shield className="h-5 w-5 text-blue-600" /></div>
            <div><h1 className="text-2xl font-bold">FCA Compliance</h1><p className="text-muted-foreground text-sm">UK Financial Conduct Authority regulatory compliance</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => toast.success("Generating compliance report...")}><Download className="h-4 w-4 mr-1" />Export Report</Button>
        </div>

        <Card className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-medium opacity-80">Overall Compliance Score</div>
              <Badge className="bg-white/20 text-white border-0">FCA Registered</Badge>
            </div>
            <div className="text-5xl font-bold mb-2">{Math.round((compliantCount / checks.length) * 100)}%</div>
            <Progress value={(compliantCount / checks.length) * 100} className="h-2 bg-white/20 [&>div]:bg-white" />
            <div className="text-sm opacity-80 mt-2">{compliantCount} of {checks.length} requirements met</div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Compliant", value: compliantCount, color: "text-emerald-600" },
            { label: "In Progress", value: checks.filter(c => c.status === "in_progress").length, color: "text-blue-600" },
            { label: "Review Needed", value: checks.filter(c => c.status === "review_needed").length, color: "text-red-600" },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 text-center"><div className={"text-2xl font-bold " + s.color}>{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Compliance Checklist</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {checks.map(c => {
              const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
                compliant: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, label: "Compliant" },
                in_progress: { color: "bg-blue-100 text-blue-700", icon: Clock, label: "In Progress" },
                review_needed: { color: "bg-red-100 text-red-700", icon: AlertTriangle, label: "Review Needed" },
              };
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.compliant;
              const Icon = cfg.icon;
              return (
                <div key={c.label} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Icon className={"h-4 w-4 " + (c.status === "compliant" ? "text-emerald-500" : c.status === "in_progress" ? "text-blue-500" : "text-red-500")} />
                    <div>
                      <div className="text-sm font-medium">{c.label}</div>
                      <div className="text-xs text-muted-foreground">Last review: {c.lastReview} · Next: {c.nextReview}</div>
                    </div>
                  </div>
                  <Badge className={"text-xs border-0 " + cfg.color}>{cfg.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── GDPRData ──────────────────────────────────────────────────────────────────
pages["GDPRData"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Shield, Download, Trash2, Eye, Lock, Database, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const DATA_CATEGORIES = [
  { id: "identity", label: "Identity Data", desc: "Name, email, phone, date of birth", retained: "7 years", size: "2.4 KB" },
  { id: "financial", label: "Financial Data", desc: "Transaction history, balances, payment methods", retained: "7 years", size: "145 KB" },
  { id: "kyc", label: "KYC Documents", desc: "ID documents, selfies, address proofs", retained: "5 years", size: "8.2 MB" },
  { id: "behavioral", label: "Behavioral Data", desc: "Login history, device info, IP addresses", retained: "2 years", size: "18 KB" },
  { id: "communications", label: "Communications", desc: "Support tickets, chat history", retained: "3 years", size: "34 KB" },
];

const CONSENTS = [
  { id: "marketing", label: "Marketing Communications", desc: "Receive promotional emails and offers", granted: false },
  { id: "analytics", label: "Analytics & Improvement", desc: "Help improve our services with usage data", granted: true },
  { id: "third_party", label: "Third-Party Sharing", desc: "Share data with trusted partners for better rates", granted: false },
];

export default function GDPRData() {
  const [consents, setConsents] = useState(CONSENTS);

  const toggle = (id: string) => setConsents(p => p.map(c => c.id === id ? { ...c, granted: !c.granted } : c));

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center"><Shield className="h-5 w-5 text-purple-600" /></div>
          <div><h1 className="text-2xl font-bold">GDPR & Data Privacy</h1><p className="text-muted-foreground text-sm">Your data rights under GDPR</p></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-auto py-4 flex-col gap-2" onClick={() => toast.success("Data export requested — you'll receive an email within 24 hours")}>
            <Download className="h-5 w-5" /><span className="text-sm">Export My Data</span>
          </Button>
          <Button variant="outline" className="h-auto py-4 flex-col gap-2 text-destructive border-destructive/30" onClick={() => toast.error("Please contact support to request account deletion")}>
            <Trash2 className="h-5 w-5" /><span className="text-sm">Delete My Data</span>
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" />Data We Hold</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {DATA_CATEGORIES.map(cat => (
              <div key={cat.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <div className="text-sm font-medium">{cat.label}</div>
                  <div className="text-xs text-muted-foreground">{cat.desc}</div>
                  <div className="text-xs text-muted-foreground">Retained for: {cat.retained}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium">{cat.size}</div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toast.success(`Viewing ${cat.label}...`)}><Eye className="h-3 w-3 mr-1" />View</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" />Consent Management</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {consents.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.desc}</div>
                </div>
                <Switch checked={c.granted} onCheckedChange={() => { toggle(c.id); toast.success("Consent preference updated"); }} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── ConsentManagement ─────────────────────────────────────────────────────────
pages["ConsentManagement"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { FileCheck, Clock, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

const CONSENTS = [
  { id: 1, name: "Open Banking Data Access", provider: "Plaid", scope: "Account balances, transaction history", granted: true, grantedAt: "Jan 15, 2024", expires: "Jan 15, 2025" },
  { id: 2, name: "Credit Score Access", provider: "CreditChek", scope: "Credit score, credit history", granted: true, grantedAt: "Feb 1, 2024", expires: "Feb 1, 2025" },
  { id: 3, name: "Identity Verification", provider: "Smile Identity", scope: "Government ID, selfie", granted: true, grantedAt: "Jan 10, 2024", expires: "Jan 10, 2026" },
  { id: 4, name: "Payment Initiation", provider: "Paystack", scope: "Initiate payments on your behalf", granted: false, grantedAt: null, expires: null },
];

export default function ConsentManagement() {
  const [consents, setConsents] = useState(CONSENTS);

  const toggle = (id: number) => setConsents(p => p.map(c => c.id === id ? { ...c, granted: !c.granted, grantedAt: !c.granted ? new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null } : c));

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center"><FileCheck className="h-5 w-5 text-teal-600" /></div>
          <div><h1 className="text-2xl font-bold">Consent Management</h1><p className="text-muted-foreground text-sm">Control what third parties can access</p></div>
        </div>

        <div className="space-y-3">
          {consents.map(c => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-semibold text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground">Provider: {c.provider}</div>
                    <div className="text-xs text-muted-foreground mt-1">Scope: {c.scope}</div>
                  </div>
                  <Switch checked={c.granted} onCheckedChange={() => { toggle(c.id); toast.success(c.name + (c.granted ? " access revoked" : " access granted")); }} />
                </div>
                {c.granted && (
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" />Granted {c.grantedAt}</span>
                    {c.expires && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Expires {c.expires}</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── DPIA ──────────────────────────────────────────────────────────────────────
pages["DPIA"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Shield, Plus, FileText, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

const DPIAS = [
  { id: "DPIA-001", title: "Biometric Data Processing", risk: "high", status: "completed", date: "Jan 2024", owner: "DPO" },
  { id: "DPIA-002", title: "AI-Based Transaction Monitoring", risk: "high", status: "in_review", date: "Mar 2024", owner: "CTO" },
  { id: "DPIA-003", title: "Third-Party Data Sharing", risk: "medium", status: "completed", date: "Feb 2024", owner: "Legal" },
  { id: "DPIA-004", title: "Cross-Border Data Transfers", risk: "medium", status: "pending", date: "Apr 2024", owner: "DPO" },
];

const RISK_CONFIG: Record<string, string> = { high: "bg-red-100 text-red-700", medium: "bg-yellow-100 text-yellow-700", low: "bg-emerald-100 text-emerald-700" };
const STATUS_CONFIG: Record<string, { color: string; icon: any }> = {
  completed: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  in_review: { color: "bg-blue-100 text-blue-700", icon: Clock },
  pending: { color: "bg-yellow-100 text-yellow-700", icon: AlertTriangle },
};

export default function DPIA() {
  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center"><Shield className="h-5 w-5 text-indigo-600" /></div>
            <div><h1 className="text-2xl font-bold">DPIA Register</h1><p className="text-muted-foreground text-sm">Data Protection Impact Assessments</p></div>
          </div>
          <Button size="sm" onClick={() => toast.success("Opening new DPIA form...")}><Plus className="h-4 w-4 mr-1" />New DPIA</Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total DPIAs", value: DPIAS.length },
            { label: "High Risk", value: DPIAS.filter(d => d.risk === "high").length },
            { label: "Completed", value: DPIAS.filter(d => d.status === "completed").length },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>
          ))}
        </div>

        <div className="space-y-3">
          {DPIAS.map(d => {
            const scfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.pending;
            const Icon = scfg.icon;
            return (
              <Card key={d.id}>
                <CardContent className="p-4 flex items-center gap-4">
                  <FileText className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-xs text-muted-foreground">{d.id} · Owner: {d.owner} · {d.date}</div>
                    <div className="flex gap-2 mt-1">
                      <Badge className={"text-xs border-0 " + RISK_CONFIG[d.risk]}>{d.risk} risk</Badge>
                      <Badge className={"text-xs border-0 " + scfg.color}><Icon className="h-3 w-3 mr-1" />{d.status.replace("_", " ")}</Badge>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => toast.success("Opening DPIA " + d.id)}>View</Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── CorridorPricing ───────────────────────────────────────────────────────────
pages["CorridorPricing"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Search, Edit2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function CorridorPricing() {
  const [search, setSearch] = useState("");
  const { data: corridors } = trpc.corridors.list.useQuery({ search });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-emerald-600" /></div>
            <div><h1 className="text-2xl font-bold">Corridor Pricing</h1><p className="text-muted-foreground text-sm">FX rates and fees by transfer corridor</p></div>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search corridors..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="space-y-2">
          {(corridors ?? []).map((c: any) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="text-2xl">{c.fromFlag}</div>
                    <div>
                      <div className="font-bold text-sm">{c.fromCurrency}</div>
                      <div className="text-xs text-muted-foreground">{c.fromCountry}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground mx-1" />
                    <div className="text-2xl">{c.toFlag}</div>
                    <div>
                      <div className="font-bold text-sm">{c.toCurrency}</div>
                      <div className="text-xs text-muted-foreground">{c.toCountry}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">1 {c.fromCurrency} = {c.rate} {c.toCurrency}</div>
                    <div className="text-xs text-muted-foreground">Fee: {c.feePercent}% + {c.fixedFee} {c.fromCurrency}</div>
                    <div className="text-xs text-muted-foreground">Updated: {c.lastUpdated}</div>
                  </div>
                  <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-xs capitalize ml-2">{c.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── SavingsGoals ──────────────────────────────────────────────────────────────
pages["SavingsGoals"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Target, Plus, TrendingUp, Calendar, PiggyBank } from "lucide-react";
import { toast } from "sonner";

export default function SavingsGoals() {
  const { data: goals, refetch } = trpc.savings.goals.useQuery();
  const createMutation = trpc.savings.create.useMutation({ onSuccess: () => { toast.success("Goal created!"); refetch(); setOpen(false); } });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", targetAmount: "", currency: "NGN", targetDate: "", autoSave: false, autoSaveAmount: "" });

  const ICONS = ["🏠", "✈️", "🎓", "🚗", "💍", "💻", "🏖️", "💰"];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Target className="h-5 w-5 text-emerald-600" /></div>
            <div><h1 className="text-2xl font-bold">Savings Goals</h1><p className="text-muted-foreground text-sm">Save towards your goals</p></div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Goal</Button>
        </div>

        <div className="grid gap-4">
          {(goals ?? []).map((g: any) => {
            const pct = Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100));
            return (
              <Card key={g.id} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="text-3xl">{g.emoji ?? "💰"}</div>
                    <div className="flex-1">
                      <div className="font-bold">{g.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Target: {g.targetDate}</div>
                    </div>
                    <Badge variant={pct >= 100 ? "default" : "secondary"} className="text-xs">{pct >= 100 ? "🎉 Achieved!" : `${pct}%`}</Badge>
                  </div>
                  <Progress value={pct} className="h-2 mb-2" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{g.currency} {g.currentAmount?.toLocaleString()}</span>
                    <span className="text-muted-foreground">of {g.currency} {g.targetAmount?.toLocaleString()}</span>
                  </div>
                  {g.autoSave && (
                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3 text-emerald-500" />Auto-saving {g.currency} {g.autoSaveAmount?.toLocaleString()} monthly</div>
                  )}
                  <Button size="sm" className="mt-3 w-full" variant="outline" onClick={() => toast.success("Opening top-up for " + g.name)}><PiggyBank className="h-4 w-4 mr-1" />Top Up</Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Savings Goal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Goal name (e.g. New Car)" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Input type="number" placeholder="Target amount" value={form.targetAmount} onChange={e => setForm(p => ({ ...p, targetAmount: e.target.value }))} />
            <Input type="date" placeholder="Target date" value={form.targetDate} onChange={e => setForm(p => ({ ...p, targetDate: e.target.value }))} />
            <Button className="w-full" disabled={!form.name || !form.targetAmount || createMutation.isPending}
              onClick={() => createMutation.mutate({ ...form, targetAmount: parseFloat(form.targetAmount), autoSaveAmount: parseFloat(form.autoSaveAmount || "0") })}>
              {createMutation.isPending ? "Creating..." : "Create Goal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

# ── POSManagement ─────────────────────────────────────────────────────────────
pages["POSManagement"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Monitor, Plus, Search, Wifi, WifiOff, MapPin, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function POSManagement() {
  const [search, setSearch] = useState("");
  const { data: terminals } = trpc.pos.terminals.useQuery({ search });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center"><Monitor className="h-5 w-5 text-slate-600" /></div>
            <div><h1 className="text-2xl font-bold">POS Management</h1><p className="text-muted-foreground text-sm">Manage point-of-sale terminals</p></div>
          </div>
          <Button size="sm" onClick={() => toast.success("Opening terminal provisioning...")}><Plus className="h-4 w-4 mr-1" />Add Terminal</Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Terminals", value: (terminals ?? []).length, color: "text-foreground" },
            { label: "Online", value: (terminals ?? []).filter((t: any) => t.status === "online").length, color: "text-emerald-600" },
            { label: "Offline", value: (terminals ?? []).filter((t: any) => t.status === "offline").length, color: "text-red-600" },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 text-center"><div className={"text-2xl font-bold " + s.color}>{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search terminals..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="space-y-2">
          {(terminals ?? []).map((t: any) => (
            <Card key={t.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + (t.status === "online" ? "bg-emerald-100" : "bg-red-100")}>
                  {t.status === "online" ? <Wifi className="h-5 w-5 text-emerald-600" /> : <WifiOff className="h-5 w-5 text-red-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{t.terminalId}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{t.location}</div>
                  <div className="text-xs text-muted-foreground">Merchant: {t.merchantName}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-sm">₦{t.todayVolume?.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Today</div>
                  <Badge variant={t.status === "online" ? "default" : "secondary"} className="text-xs capitalize mt-1">{t.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── AgentNetwork ──────────────────────────────────────────────────────────────
pages["AgentNetwork"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Search, MapPin, Star, TrendingUp, Plus } from "lucide-react";
import { toast } from "sonner";

export default function AgentNetwork() {
  const [search, setSearch] = useState("");
  const { data: agents } = trpc.agents.list.useQuery({ search });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center"><Users className="h-5 w-5 text-violet-600" /></div>
            <div><h1 className="text-2xl font-bold">Agent Network</h1><p className="text-muted-foreground text-sm">Manage your agent network</p></div>
          </div>
          <Button size="sm" onClick={() => toast.success("Opening agent onboarding...")}><Plus className="h-4 w-4 mr-1" />Add Agent</Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Agents", value: (agents ?? []).length },
            { label: "Active Today", value: Math.floor((agents ?? []).length * 0.7) },
            { label: "Avg Rating", value: "4.7★" },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search agents..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="space-y-2">
          {(agents ?? []).map((a: any) => (
            <Card key={a.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center font-bold text-violet-700">{a.name?.[0]}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{a.location}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground"><Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />{a.rating} · {a.totalTransactions} txns</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-sm">₦{a.monthlyVolume?.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Monthly</div>
                  <Badge variant={a.status === "active" ? "default" : "secondary"} className="text-xs capitalize mt-1">{a.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── APIChangelog ──────────────────────────────────────────────────────────────
pages["APIChangelog"] = '''import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Code, Plus, Minus, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CHANGELOG = [
  {
    version: "v2.4.1", date: "Apr 10, 2024", type: "patch",
    changes: [
      { type: "fix", desc: "Fixed duplicate transaction detection in batch payments" },
      { type: "fix", desc: "Corrected FX rate precision for NGN/KES corridor" },
      { type: "improvement", desc: "Improved webhook retry logic with exponential backoff" },
    ]
  },
  {
    version: "v2.4.0", date: "Mar 25, 2024", type: "minor",
    changes: [
      { type: "new", desc: "Added Travel Rule compliance endpoints (FATF)" },
      { type: "new", desc: "CBDC wallet integration API" },
      { type: "new", desc: "Mojaloop FSPIOP v1.1 support" },
      { type: "deprecated", desc: "Legacy /v1/transfer endpoint (use /v2/transfers)" },
    ]
  },
  {
    version: "v2.3.0", date: "Feb 14, 2024", type: "minor",
    changes: [
      { type: "new", desc: "Batch payment API supporting up to 1,000 transfers" },
      { type: "new", desc: "Webhook event subscriptions for all transaction states" },
      { type: "improvement", desc: "Reduced P99 latency from 450ms to 120ms" },
      { type: "fix", desc: "Fixed race condition in concurrent wallet top-ups" },
    ]
  },
];

const CHANGE_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  new: { color: "bg-emerald-100 text-emerald-700", icon: Plus, label: "New" },
  fix: { color: "bg-red-100 text-red-700", icon: Minus, label: "Fix" },
  improvement: { color: "bg-blue-100 text-blue-700", icon: RefreshCw, label: "Improved" },
  deprecated: { color: "bg-yellow-100 text-yellow-700", icon: AlertTriangle, label: "Deprecated" },
};

const VERSION_COLORS: Record<string, string> = { major: "bg-red-100 text-red-700", minor: "bg-blue-100 text-blue-700", patch: "bg-gray-100 text-gray-700" };

export default function APIChangelog() {
  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center"><Code className="h-5 w-5 text-slate-600" /></div>
            <div><h1 className="text-2xl font-bold">API Changelog</h1><p className="text-muted-foreground text-sm">Version history and breaking changes</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => toast.success("Opening API documentation...")}>View Docs</Button>
        </div>

        <div className="space-y-6">
          {CHANGELOG.map(release => (
            <div key={release.version}>
              <div className="flex items-center gap-3 mb-3">
                <div className="font-bold text-lg">{release.version}</div>
                <Badge className={"text-xs border-0 " + VERSION_COLORS[release.type]}>{release.type}</Badge>
                <div className="text-sm text-muted-foreground">{release.date}</div>
              </div>
              <Card>
                <CardContent className="p-4 space-y-2">
                  {release.changes.map((c, i) => {
                    const cfg = CHANGE_CONFIG[c.type] ?? CHANGE_CONFIG.improvement;
                    const Icon = cfg.icon;
                    return (
                      <div key={i} className="flex items-start gap-3">
                        <Badge className={"text-xs border-0 flex-shrink-0 " + cfg.color}><Icon className="h-3 w-3 mr-1" />{cfg.label}</Badge>
                        <span className="text-sm">{c.desc}</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── AccountHealth ─────────────────────────────────────────────────────────────
pages["AccountHealth"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, AlertTriangle, XCircle, TrendingUp, Shield, CreditCard, User } from "lucide-react";
import { toast } from "sonner";

const HEALTH_CHECKS = [
  { category: "Identity", icon: User, score: 100, status: "excellent", items: [{ label: "Email verified", ok: true }, { label: "Phone verified", ok: true }, { label: "BVN linked", ok: true }] },
  { category: "KYC", icon: Shield, score: 75, status: "good", items: [{ label: "Tier 1 complete", ok: true }, { label: "Tier 2 in progress", ok: false }, { label: "Tier 3 locked", ok: false }] },
  { category: "Security", icon: Shield, score: 90, status: "excellent", items: [{ label: "2FA enabled", ok: true }, { label: "Strong password", ok: true }, { label: "Biometric set up", ok: false }] },
  { category: "Payment Methods", icon: CreditCard, score: 80, status: "good", items: [{ label: "Bank account linked", ok: true }, { label: "Card added", ok: true }, { label: "Default method set", ok: false }] },
];

const STATUS_COLORS: Record<string, string> = { excellent: "text-emerald-600", good: "text-blue-600", fair: "text-yellow-600", poor: "text-red-600" };
const SCORE_COLORS: Record<string, string> = { excellent: "bg-emerald-500", good: "bg-blue-500", fair: "bg-yellow-500", poor: "bg-red-500" };

export default function AccountHealth() {
  const overallScore = Math.round(HEALTH_CHECKS.reduce((s, c) => s + c.score, 0) / HEALTH_CHECKS.length);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Activity className="h-5 w-5 text-emerald-600" /></div>
          <div><h1 className="text-2xl font-bold">Account Health</h1><p className="text-muted-foreground text-sm">Your account completeness and security score</p></div>
        </div>

        <Card className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
          <CardContent className="p-6 text-center">
            <div className="text-6xl font-bold mb-2">{overallScore}</div>
            <div className="text-lg font-medium opacity-90 mb-3">Overall Health Score</div>
            <Progress value={overallScore} className="h-3 bg-white/20 [&>div]:bg-white" />
            <div className="text-sm opacity-80 mt-2">{overallScore >= 90 ? "Excellent" : overallScore >= 75 ? "Good" : "Needs Improvement"}</div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {HEALTH_CHECKS.map(check => {
            const Icon = check.icon;
            return (
              <Card key={check.category}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{check.category}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={"font-bold " + STATUS_COLORS[check.status]}>{check.score}%</span>
                      <Badge className={"text-xs border-0 capitalize " + (check.status === "excellent" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>{check.status}</Badge>
                    </div>
                  </div>
                  <Progress value={check.score} className="h-1.5 mb-3" />
                  <div className="space-y-1">
                    {check.items.map(item => (
                      <div key={item.label} className="flex items-center gap-2 text-sm">
                        {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" /> : <XCircle className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />}
                        <span className={item.ok ? "" : "text-muted-foreground"}>{item.label}</span>
                        {!item.ok && <Button size="sm" variant="link" className="h-auto p-0 text-xs ml-auto" onClick={() => toast.success("Opening setup...")}>Fix →</Button>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── PaymentPerformance ────────────────────────────────────────────────────────
pages["PaymentPerformance"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { TrendingUp, Clock, CheckCircle2, XCircle, Zap } from "lucide-react";

const MONTHLY_DATA = [
  { month: "Oct", success: 98.2, volume: 12400 }, { month: "Nov", success: 97.8, volume: 14200 },
  { month: "Dec", success: 98.9, volume: 18900 }, { month: "Jan", success: 99.1, volume: 15600 },
  { month: "Feb", success: 98.7, volume: 16800 }, { month: "Mar", success: 99.3, volume: 19200 },
];

const CORRIDOR_PERF = [
  { corridor: "NGN→USD", successRate: 99.5, avgTime: "2.1s", volume: 4821 },
  { corridor: "NGN→GBP", successRate: 98.9, avgTime: "3.4s", volume: 2156 },
  { corridor: "NGN→KES", successRate: 97.2, avgTime: "8.2s", volume: 1893 },
  { corridor: "NGN→GHS", successRate: 98.1, avgTime: "5.7s", volume: 1247 },
];

export default function PaymentPerformance() {
  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-blue-600" /></div>
          <div><h1 className="text-2xl font-bold">Payment Performance</h1><p className="text-muted-foreground text-sm">Success rates, latency, and volume analytics</p></div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Success Rate", value: "99.3%", icon: CheckCircle2, color: "text-emerald-600" },
            { label: "Avg Latency", value: "2.4s", icon: Zap, color: "text-blue-600" },
            { label: "Failed Today", value: "14", icon: XCircle, color: "text-red-600" },
            { label: "P99 Latency", value: "8.1s", icon: Clock, color: "text-yellow-600" },
          ].map(s => {
            const Icon = s.icon;
            return (
              <Card key={s.label}><CardContent className="p-4 text-center"><Icon className={"h-6 w-6 mx-auto mb-1 " + s.color} /><div className={"text-xl font-bold " + s.color}>{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>
            );
          })}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Monthly Success Rate (%)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={MONTHLY_DATA}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis domain={[96, 100]} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => [v + "%", "Success Rate"]} />
                <Line type="monotone" dataKey="success" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Performance by Corridor</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {CORRIDOR_PERF.map(c => (
              <div key={c.corridor} className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                <div className="font-mono text-sm font-bold w-24 flex-shrink-0">{c.corridor}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>{c.successRate}% success</span><span>{c.volume.toLocaleString()} txns</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: c.successRate + "%" }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-medium">{c.avgTime}</div>
                  <div className="text-xs text-muted-foreground">avg</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── RateCalculator ────────────────────────────────────────────────────────────
pages["RateCalculator"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, ArrowRight, ArrowLeftRight, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const RATES: Record<string, number> = {
  "NGN-USD": 0.000625, "NGN-GBP": 0.000495, "NGN-EUR": 0.000578, "NGN-KES": 0.0815,
  "NGN-GHS": 0.00934, "USD-NGN": 1600, "GBP-NGN": 2020, "EUR-NGN": 1730,
  "USD-GBP": 0.792, "USD-EUR": 0.925, "GBP-EUR": 1.168,
};

const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "CAD", "AUD"];

export default function RateCalculator() {
  const [amount, setAmount] = useState("100000");
  const [from, setFrom] = useState("NGN");
  const [to, setTo] = useState("USD");

  const key = `${from}-${to}`;
  const reverseKey = `${to}-${from}`;
  const rate = RATES[key] ?? (RATES[reverseKey] ? 1 / RATES[reverseKey] : 0.001);
  const fee = parseFloat(amount || "0") * 0.015;
  const converted = (parseFloat(amount || "0") - fee) * rate;

  const swap = () => { const t = from; setFrom(to); setTo(t); };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-sm mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center"><Calculator className="h-5 w-5 text-indigo-600" /></div>
          <div><h1 className="text-2xl font-bold">Rate Calculator</h1><p className="text-muted-foreground text-sm">Calculate exact conversion amounts</p></div>
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">You Send</label>
              <div className="flex gap-2">
                <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="text-xl font-bold" />
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-center">
              <button onClick={swap} className="w-10 h-10 rounded-full border-2 border-border flex items-center justify-center hover:bg-muted transition-colors">
                <ArrowLeftRight className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Recipient Gets</label>
              <div className="flex gap-2">
                <div className="flex-1 px-3 py-2 bg-muted/50 rounded-md text-xl font-bold text-primary">{isNaN(converted) ? "—" : converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Exchange Rate</span><span className="font-medium">1 {from} = {rate.toFixed(6)} {to}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Transfer Fee (1.5%)</span><span className="font-medium">{from} {fee.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total Cost</span><span>{from} {parseFloat(amount || "0").toLocaleString()}</span></div>
            </div>

            <Button className="w-full" onClick={() => toast.success("Opening transfer with these rates...")}>Send {from} {parseFloat(amount || "0").toLocaleString()} <ArrowRight className="h-4 w-4 ml-1" /></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Popular Corridors</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[["NGN","USD",1600],["NGN","GBP",2020],["NGN","EUR",1730],["NGN","KES",130.4]].map(([f,t,r]) => (
              <button key={`${f}-${t}`} className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 text-sm" onClick={() => { setFrom(f as string); setTo(t as string); }}>
                <span className="font-medium">{f} → {t}</span>
                <span className="text-muted-foreground">1 {f} = {r} {t}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── RateLock ──────────────────────────────────────────────────────────────────
pages["RateLock"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Clock, CheckCircle2, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const LOCKED_RATES = [
  { id: 1, pair: "NGN/USD", lockedRate: 1598.50, currentRate: 1604.20, amount: 500000, currency: "NGN", expiresAt: "Apr 20, 2024 14:00", status: "active", saving: 2850 },
  { id: 2, pair: "NGN/GBP", lockedRate: 2015.00, currentRate: 2022.80, amount: 200000, currency: "NGN", expiresAt: "Apr 18, 2024 10:00", status: "active", saving: 1560 },
  { id: 3, pair: "NGN/EUR", lockedRate: 1725.00, currentRate: 1718.50, amount: 300000, currency: "NGN", expiresAt: "Apr 15, 2024 09:00", status: "expired", saving: -1950 },
];

export default function RateLock() {
  const [from, setFrom] = useState("NGN");
  const [to, setTo] = useState("USD");
  const [amount, setAmount] = useState("100000");
  const [duration, setDuration] = useState("24");

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><Lock className="h-5 w-5 text-amber-600" /></div>
          <div><h1 className="text-2xl font-bold">Rate Lock</h1><p className="text-muted-foreground text-sm">Lock in today\'s exchange rate for future transfers</p></div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Lock a New Rate</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 items-center">
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["NGN","USD","GBP","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["USD","GBP","EUR","KES","GHS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Input type="number" placeholder="Amount to lock" value={amount} onChange={e => setAmount(e.target.value)} />
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger><SelectValue placeholder="Lock duration" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 hours</SelectItem>
                <SelectItem value="12">12 hours</SelectItem>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="48">48 hours</SelectItem>
                <SelectItem value="72">72 hours</SelectItem>
              </SelectContent>
            </Select>
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Current Rate</span><span className="font-medium">1 {from} = 1,604.20 {to}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Lock Fee</span><span className="font-medium">₦500</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Valid Until</span><span className="font-medium">{duration}h from now</span></div>
            </div>
            <Button className="w-full" onClick={() => toast.success("Rate locked for " + duration + " hours!")}><Lock className="h-4 w-4 mr-2" />Lock Rate Now</Button>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="font-semibold">Active Rate Locks</h2>
          {LOCKED_RATES.map(r => (
            <Card key={r.id} className={r.status === "expired" ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold">{r.pair}</div>
                  <Badge className={"text-xs border-0 " + (r.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>
                    {r.status === "active" ? <><CheckCircle2 className="h-3 w-3 mr-1" />Active</> : "Expired"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                  <div><div className="text-xs text-muted-foreground">Locked Rate</div><div className="font-semibold">{r.lockedRate.toLocaleString()}</div></div>
                  <div><div className="text-xs text-muted-foreground">Current Rate</div><div className="font-semibold">{r.currentRate.toLocaleString()}</div></div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Expires: {r.expiresAt}</span>
                  <span className={r.saving > 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                    {r.saving > 0 ? "Saving" : "Cost"} ₦{Math.abs(r.saving).toLocaleString()}
                  </span>
                </div>
                {r.status === "active" && (
                  <Button size="sm" className="mt-3 w-full" onClick={() => toast.success("Opening transfer with locked rate...")}>Use This Rate <ArrowRight className="h-4 w-4 ml-1" /></Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── RecurringPayments ─────────────────────────────────────────────────────────
pages["RecurringPayments"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Plus, Calendar, DollarSign } from "lucide-react";
import { toast } from "sonner";

export default function RecurringPayments() {
  const { data: payments, refetch } = trpc.recurring.list.useQuery();
  const toggleMutation = trpc.recurring.toggle.useMutation({ onSuccess: () => refetch() });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center"><RefreshCw className="h-5 w-5 text-cyan-600" /></div>
            <div><h1 className="text-2xl font-bold">Recurring Payments</h1><p className="text-muted-foreground text-sm">Automated scheduled transfers</p></div>
          </div>
          <Button size="sm" onClick={() => toast.success("Opening recurring payment setup...")}><Plus className="h-4 w-4 mr-1" />New</Button>
        </div>

        <div className="space-y-3">
          {(payments ?? []).map((p: any) => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center font-bold text-cyan-700 text-sm">{p.recipientName?.[0]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{p.recipientName}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />{p.frequency} · Next: {p.nextDate}</div>
                  </div>
                  <div className="text-right mr-2">
                    <div className="font-semibold">{p.currency} {p.amount?.toLocaleString()}</div>
                    <Badge variant={p.active ? "default" : "secondary"} className="text-xs">{p.active ? "Active" : "Paused"}</Badge>
                  </div>
                  <Switch checked={p.active} onCheckedChange={() => { toggleMutation.mutate({ id: p.id, active: !p.active }); toast.success(p.active ? "Paused" : "Resumed"); }} />
                </div>
              </CardContent>
            </Card>
          ))}
          {(!payments || payments.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No recurring payments set up</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── CheckoutSDK ───────────────────────────────────────────────────────────────
pages["CheckoutSDK"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Code, Copy, CheckCircle2, ExternalLink, Zap } from "lucide-react";
import { toast } from "sonner";

const SDK_SNIPPET = `import RemitFlow from "@remitflow/checkout";

const checkout = new RemitFlow({
  publicKey: "rf_live_pk_xxxxxxxxxxxxxxxx",
  amount: 50000,
  currency: "NGN",
  email: "customer@example.com",
  onSuccess: (ref) => console.log("Payment:", ref),
  onClose: () => console.log("Closed"),
});

checkout.openIframe();`;

const WEBHOOKS = [
  { event: "payment.success", desc: "Triggered when payment is completed", lastFired: "2 min ago" },
  { event: "payment.failed", desc: "Triggered when payment fails", lastFired: "1 hour ago" },
  { event: "payment.pending", desc: "Triggered when payment is pending", lastFired: "30 min ago" },
  { event: "refund.processed", desc: "Triggered when refund is processed", lastFired: "2 days ago" },
];

export default function CheckoutSDK() {
  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("https://yoursite.com/webhooks/remitflow");

  const copy = () => { navigator.clipboard.writeText(SDK_SNIPPET); setCopied(true); toast.success("Copied!"); setTimeout(() => setCopied(false), 2000); };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center"><Code className="h-5 w-5 text-white" /></div>
            <div><h1 className="text-2xl font-bold">Checkout SDK</h1><p className="text-muted-foreground text-sm">Embed payments into your website or app</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => toast.success("Opening developer docs...")}><ExternalLink className="h-4 w-4 mr-1" />Docs</Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "API Calls (Today)", value: "1,247", icon: Zap, color: "text-blue-600" },
            { label: "Success Rate", value: "99.1%", icon: CheckCircle2, color: "text-emerald-600" },
            { label: "Avg Response", value: "142ms", icon: Code, color: "text-purple-600" },
          ].map(s => {
            const Icon = s.icon;
            return <Card key={s.label}><CardContent className="p-4 text-center"><Icon className={"h-5 w-5 mx-auto mb-1 " + s.color} /><div className={"font-bold " + s.color}>{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></CardContent></Card>;
          })}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">API Keys</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Live Public Key", value: "rf_live_pk_a1b2c3d4e5f6g7h8", env: "live" },
              { label: "Test Public Key", value: "rf_test_pk_x9y8z7w6v5u4t3s2", env: "test" },
            ].map(k => (
              <div key={k.label} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground mb-0.5">{k.label}</div>
                  <code className="text-sm font-mono">{k.value}</code>
                </div>
                <Badge variant={k.env === "live" ? "default" : "secondary"} className="text-xs capitalize flex-shrink-0">{k.env}</Badge>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(k.value); toast.success("Copied!"); }}><Copy className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Integration Snippet</CardTitle></CardHeader>
          <CardContent>
            <div className="relative bg-slate-900 rounded-lg p-4 overflow-x-auto">
              <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-8 w-8 text-slate-400 hover:text-white" onClick={copy}>
                {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </Button>
              <pre className="text-sm text-slate-300 font-mono whitespace-pre">{SDK_SNIPPET}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Webhook Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://yoursite.com/webhooks" />
              <Button onClick={() => toast.success("Webhook URL saved!")}>Save</Button>
            </div>
            <div className="space-y-2">
              {WEBHOOKS.map(w => (
                <div key={w.event} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <code className="text-sm font-mono font-medium">{w.event}</code>
                    <div className="text-xs text-muted-foreground">{w.desc}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{w.lastFired}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── MPesa ─────────────────────────────────────────────────────────────────────
pages["MPesa"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Smartphone, ArrowRight, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const MPESA_TXS = [
  { id: 1, type: "send", phone: "+254 712 345 678", name: "James Kamau", amount: 5000, currency: "KES", status: "completed", date: "Today 14:32" },
  { id: 2, type: "receive", phone: "+254 798 765 432", name: "Grace Wanjiku", amount: 2500, currency: "KES", status: "completed", date: "Yesterday" },
  { id: 3, type: "send", phone: "+254 722 111 222", name: "Peter Mwangi", amount: 10000, currency: "KES", status: "pending", date: "Yesterday" },
];

export default function MPesa() {
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"form" | "confirm" | "success">("form");

  const send = () => {
    if (!phone || !amount) return;
    setStep("confirm");
  };

  const confirm = () => {
    setStep("success");
    toast.success("M-Pesa transfer initiated! Check your phone for STK push.");
    setTimeout(() => setStep("form"), 3000);
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-sm mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center"><Smartphone className="h-5 w-5 text-white" /></div>
          <div><h1 className="text-2xl font-bold">M-Pesa</h1><p className="text-muted-foreground text-sm">Send money to M-Pesa wallets in Kenya</p></div>
        </div>

        <Card className="bg-gradient-to-br from-emerald-600 to-green-700 text-white">
          <CardContent className="p-5">
            <div className="text-sm opacity-80 mb-1">Exchange Rate</div>
            <div className="text-2xl font-bold">1 NGN = 0.0815 KES</div>
            <div className="text-sm opacity-80 mt-1">Updated 5 minutes ago</div>
          </CardContent>
        </Card>

        {step === "form" && (
          <Card>
            <CardHeader><CardTitle className="text-base">Send to M-Pesa</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="+254 7XX XXX XXX" value={phone} onChange={e => setPhone(e.target.value)} />
              <Input type="number" placeholder="Amount in NGN" value={amount} onChange={e => setAmount(e.target.value)} />
              {amount && (
                <div className="bg-muted/30 rounded-lg p-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Recipient gets</span><span className="font-bold text-emerald-600">KES {(parseFloat(amount) * 0.0815 * 0.985).toFixed(2)}</span></div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>Fee</span><span>NGN {(parseFloat(amount) * 0.015).toFixed(2)}</span></div>
                </div>
              )}
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!phone || !amount} onClick={send}>Continue <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </CardContent>
          </Card>
        )}

        {step === "confirm" && (
          <Card>
            <CardContent className="p-5 text-center space-y-4">
              <div className="text-lg font-bold">Confirm Transfer</div>
              <div className="text-3xl font-bold text-emerald-600">KES {(parseFloat(amount) * 0.0815 * 0.985).toFixed(2)}</div>
              <div className="text-muted-foreground">to {phone}</div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("form")}>Back</Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={confirm}>Confirm</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "success" && (
          <Card>
            <CardContent className="p-5 text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <div className="text-lg font-bold">Transfer Sent!</div>
              <div className="text-muted-foreground text-sm">An STK push has been sent to {phone}</div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Recent M-Pesa Transfers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {MPESA_TXS.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 p-2">
                <div className={"w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold " + (tx.type === "send" ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600")}>{tx.name[0]}</div>
                <div className="flex-1"><div className="text-sm font-medium">{tx.name}</div><div className="text-xs text-muted-foreground">{tx.date}</div></div>
                <div className="text-right">
                  <div className={"font-semibold text-sm " + (tx.type === "send" ? "text-red-600" : "text-emerald-600")}>{tx.type === "send" ? "-" : "+"}{tx.currency} {tx.amount.toLocaleString()}</div>
                  <Badge variant={tx.status === "completed" ? "default" : "secondary"} className="text-xs capitalize">{tx.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── WiseTransfer ──────────────────────────────────────────────────────────────
pages["WiseTransfer"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Zap, Globe, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

const WISE_RATES: Record<string, { rate: number; fee: number; time: string }> = {
  "NGN-GBP": { rate: 0.000495, fee: 1200, time: "Instant" },
  "NGN-EUR": { rate: 0.000578, fee: 1100, time: "Instant" },
  "NGN-USD": { rate: 0.000625, fee: 950, time: "Instant" },
  "NGN-CAD": { rate: 0.000845, fee: 1050, time: "1-2 hours" },
  "NGN-AUD": { rate: 0.000960, fee: 1150, time: "1-2 hours" },
};

export default function WiseTransfer() {
  const [from, setFrom] = useState("NGN");
  const [to, setTo] = useState("GBP");
  const [amount, setAmount] = useState("200000");

  const key = `${from}-${to}`;
  const rateInfo = WISE_RATES[key] ?? { rate: 0.0005, fee: 1000, time: "1-3 hours" };
  const received = (parseFloat(amount || "0") - rateInfo.fee) * rateInfo.rate;

  const RECENT = [
    { name: "Oluwaseun Adeyemi", country: "UK", amount: "£450.00", date: "Mar 28", status: "completed" },
    { name: "Chidinma Okafor", country: "Germany", amount: "€380.00", date: "Mar 15", status: "completed" },
  ];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-sm mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><Globe className="h-5 w-5 text-green-600" /></div>
          <div><h1 className="text-2xl font-bold">Wise Transfer</h1><p className="text-muted-foreground text-sm">International transfers via Wise</p></div>
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">You Send</label>
              <div className="flex gap-2">
                <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="text-xl font-bold" />
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="NGN">NGN</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Recipient Gets</label>
              <div className="flex gap-2">
                <div className="flex-1 px-3 py-2 bg-muted/50 rounded-md text-xl font-bold text-green-600">{isNaN(received) ? "—" : received.toFixed(2)}</div>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{["GBP","EUR","USD","CAD","AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span className="font-medium">1 {from} = {rateInfo.rate.toFixed(6)} {to}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Wise Fee</span><span className="font-medium">₦{rateInfo.fee.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span className="flex items-center gap-1 font-medium"><Zap className="h-3 w-3 text-emerald-500" />{rateInfo.time}</span></div>
            </div>
            <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => toast.success("Opening Wise transfer flow...")}>Continue with Wise <ArrowRight className="h-4 w-4 ml-1" /></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent Wise Transfers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {RECENT.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center font-bold text-green-700 text-sm">{r.name[0]}</div>
                <div className="flex-1"><div className="text-sm font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.country} · {r.date}</div></div>
                <div className="text-right">
                  <div className="font-semibold text-sm">{r.amount}</div>
                  <Badge variant="default" className="text-xs">{r.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── FxAlerts ──────────────────────────────────────────────────────────────────
pages["FxAlerts"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bell, Plus, TrendingUp, TrendingDown, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function FxAlerts() {
  const { data: alerts, refetch } = trpc.fxAlerts.list.useQuery();
  const createMutation = trpc.fxAlerts.create.useMutation({ onSuccess: () => { toast.success("Alert created!"); refetch(); setOpen(false); } });
  const deleteMutation = trpc.fxAlerts.remove.useMutation({ onSuccess: () => { toast.success("Alert deleted"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fromCurrency: "NGN", toCurrency: "USD", targetRate: "", condition: "above" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><Bell className="h-5 w-5 text-amber-600" /></div>
            <div><h1 className="text-2xl font-bold">FX Rate Alerts</h1><p className="text-muted-foreground text-sm">Get notified when rates hit your target</p></div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Alert</Button>
        </div>

        <div className="space-y-3">
          {(alerts ?? []).map((a: any) => (
            <Card key={a.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + (a.condition === "above" ? "bg-emerald-100" : "bg-red-100")}>
                  {a.condition === "above" ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{a.fromCurrency}/{a.toCurrency}</div>
                  <div className="text-xs text-muted-foreground">Alert when rate goes {a.condition} {a.targetRate}</div>
                  <div className="text-xs text-muted-foreground">Current: {a.currentRate}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={"text-xs border-0 " + (a.triggered ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                    {a.triggered ? <><CheckCircle2 className="h-3 w-3 mr-1" />Triggered</> : "Watching"}
                  </Badge>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate({ id: a.id })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!alerts || alerts.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No rate alerts set up</p>
              <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>Create your first alert</Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Rate Alert</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select value={form.fromCurrency} onValueChange={v => setForm(p => ({ ...p, fromCurrency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["NGN","USD","GBP","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={form.toCurrency} onValueChange={v => setForm(p => ({ ...p, toCurrency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["USD","GBP","EUR","KES","GHS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Select value={form.condition} onValueChange={v => setForm(p => ({ ...p, condition: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="above">Rate goes above</SelectItem>
                <SelectItem value="below">Rate goes below</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Target rate" value={form.targetRate} onChange={e => setForm(p => ({ ...p, targetRate: e.target.value }))} />
            <Button className="w-full" disabled={!form.targetRate || createMutation.isPending}
              onClick={() => createMutation.mutate({ ...form, targetRate: parseFloat(form.targetRate) })}>
              {createMutation.isPending ? "Creating..." : "Create Alert"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

for name, content in pages.items():
    path = os.path.join(D, f"{name}.tsx")
    with open(path, "w") as f:
        f.write(content)
    print(f"Written: {name}.tsx")

print(f"\nDone! Written {len(pages)} pages.")
