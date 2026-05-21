import { useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  User, Mail, Phone, MapPin, Shield, Edit2, Save, X,
  Camera, Calendar, Lock, Bell, CreditCard, ChevronRight,
  CheckCircle2, AlertCircle, Loader2
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';

const KYC_COLORS: Record<string, string> = {
  tier0: "bg-gray-500", tier1: "bg-yellow-500", tier2: "bg-blue-500", tier3: "bg-green-500",
};
const KYC_LABELS: Record<string, string> = {
  tier0: "Unverified", tier1: "Basic KYC", tier2: "Enhanced KYC", tier3: "Full KYC",
};

function completenessScore(profile: any): { score: number; missing: string[] } {
  const checks = [
    { key: "name", label: "Full name" },
    { key: "email", label: "Email address" },
    { key: "phone", label: "Phone number" },
    { key: "address", label: "Address" },
    { key: "dateOfBirth", label: "Date of birth" },
    { key: "avatar", label: "Profile photo" },
  ];
  const missing = checks.filter(c => !profile?.[c.key]).map(c => c.label);
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { score, missing };
}

export default function Profile() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", dateOfBirth: "" });
  const [avatarUploading, setAvatarUploading] = useState(false);

  const { data: profile, refetch } = trpc.profile.get.useQuery(undefined, { enabled: !!user });

  const updateMutation = trpc.profile.update.useMutation({
    onSuccess: () => { toast.success("Profile updated successfully"); setEditing(false); refetch(); },
    onError: (e: any) => toast.error(e.message || "Failed to update profile"),
  });

  const uploadAvatarMutation = trpc.profile.uploadAvatar.useMutation({
    onSuccess: () => { setAvatarUploading(false); toast.success("Profile photo updated"); refetch(); },
    onError: (e: any) => { setAvatarUploading(false); toast.error(e.message || "Failed to upload photo"); },
  });

  const startEdit = () => {
    setForm({
      name: (profile as any)?.name ?? "",
      phone: (profile as any)?.phone ?? "",
      address: (profile as any)?.address ?? "",
      dateOfBirth: (profile as any)?.dateOfBirth
        ? new Date((profile as any).dateOfBirth).toISOString().slice(0, 10)
        : "",
    });
    setEditing(true);
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Photo must be under 5 MB"); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Only JPEG, PNG, or WebP photos accepted"); return;
    }
    setAvatarUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadAvatarMutation.mutate({ fileBase64: base64, mimeType: file.type });
    };
    reader.onerror = () => { setAvatarUploading(false); toast.error("Failed to read photo"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const tier = (profile as any)?.kycTier ?? "tier0";
  const { score, missing } = completenessScore(profile);
  const avatarUrl = (profile as any)?.avatar;
  const initials = ((profile as any)?.name ?? user?.name ?? "U").slice(0, 2).toUpperCase();

  const quickLinks = [
    { label: "Security & 2FA", icon: Lock, path: "/security", description: "Manage passwords, 2FA, and active sessions" },
    { label: "Notification Preferences", icon: Bell, path: "/notifications", description: "Control email, SMS, and push alerts" },
    { label: "KYC Verification", icon: Shield, path: "/kyc", description: "Verify your identity to unlock higher limits" },
    { label: "Payment Methods", icon: CreditCard, path: "/payment-methods", description: "Manage linked cards and bank accounts" },
  ];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Profile</h1>
            <p className="text-muted-foreground text-sm">View and manage your personal information</p>
          </div>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Edit2 className="h-4 w-4 mr-1.5" />Edit Profile
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {updateMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Saving…</> : <><Save className="h-4 w-4 mr-1.5" />Save Changes</>}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-5 mb-6">
              <div className="relative shrink-0">
                <Avatar className="h-20 w-20 ring-2 ring-border">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={initials} />}
                  <AvatarFallback className="text-2xl bg-primary/10 text-primary font-semibold">
                    {avatarUploading ? <Loader2 className="h-6 w-6 animate-spin" /> : initials}
                  </AvatarFallback>
                </Avatar>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={avatarUploading}
                  className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                  title="Change photo">
                  <Camera className="h-3.5 w-3.5" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarSelect} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xl font-bold truncate">{(profile as any)?.name ?? user?.name ?? "—"}</div>
                <div className="text-muted-foreground text-sm truncate">{(profile as any)?.email ?? user?.email ?? "—"}</div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge className={`${KYC_COLORS[tier]} text-white text-xs border-0`}>{KYC_LABELS[tier]}</Badge>
                  {tier !== "tier3" && <button onClick={() => navigate("/kyc")} className="text-emerald-500 text-xs hover:underline">Upgrade KYC →</button>}
                </div>
              </div>
            </div>

            <div className="mb-6 p-3 bg-muted/30 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Profile completeness</span>
                <span className={score === 100 ? "text-emerald-500 font-semibold" : "text-muted-foreground"}>{score}%</span>
              </div>
              <Progress value={score} className="h-1.5" />
              {missing.length > 0 && <p className="text-xs text-muted-foreground">Missing: {missing.join(", ")}</p>}
              {score === 100 && <p className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Profile is complete</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { label: "Full Name", key: "name", icon: User, editable: true, value: (profile as any)?.name },
                { label: "Email Address", key: "email", icon: Mail, editable: false, value: (profile as any)?.email },
                { label: "Phone Number", key: "phone", icon: Phone, editable: true, value: (profile as any)?.phone, placeholder: "+1 234 567 8900" },
                { label: "Address", key: "address", icon: MapPin, editable: true, value: (profile as any)?.address, placeholder: "123 Main St, City, Country" },
                { label: "Date of Birth", key: "dateOfBirth", icon: Calendar, editable: true,
                  value: (profile as any)?.dateOfBirth ? new Date((profile as any).dateOfBirth).toLocaleDateString() : undefined, inputType: "date" },
                { label: "Account ID", key: "id", icon: Shield, editable: false, value: user?.id?.toString() },
              ].map(({ label, key, icon: Icon, editable, value, placeholder, inputType }: any) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" />{label}</label>
                  {editing && editable
                    ? <Input type={inputType ?? "text"} value={(form as any)[key] ?? ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className="h-9" />
                    : <div className="px-3 py-2 bg-muted/30 rounded-md text-sm">{value ?? <span className="text-muted-foreground italic">Not set</span>}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">KYC Verification Tiers</CardTitle>
            <CardDescription>Higher tiers unlock larger transfer limits and more corridors</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(KYC_LABELS).map(([t, label]) => (
              <div key={t} className={`p-3 rounded-lg text-center border transition-colors ${t === tier ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-muted/20"}`}>
                {t === tier ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto mb-1" /> : <AlertCircle className="h-4 w-4 text-muted-foreground mx-auto mb-1" />}
                <div className={`text-xs font-bold ${t === tier ? "text-emerald-500" : "text-muted-foreground"}`}>{t.toUpperCase()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Account Settings</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {quickLinks.map(({ label, icon: Icon, path, description }) => (
              <button key={path} onClick={() => navigate(path)} className="w-full flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors text-left">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Icon className="h-4 w-4 text-primary" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground truncate">{description}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
