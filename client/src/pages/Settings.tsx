import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Settings as SettingsIcon, Bell, Globe, Palette, Shield, Trash2, Download, AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["NGN","USD","GBP","EUR","KES","GHS","ZAR"];
const LANGUAGES = ["English","French","Spanish","Arabic","Swahili","Hausa","Yoruba","Igbo"];
const THEMES = ["dark","light","system"];

function GdprErasureCard() {
  const [reason, setReason] = useState("");
  const { data: erasureStatus, refetch } = trpc.gdpr.erasureStatus.useQuery();
  const requestErasure = trpc.gdpr.requestErasure.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Erasure request submitted", { description: data.message });
      } else {
        toast.warning("Already pending", { description: data.message });
      }
      refetch();
    },
    onError: (err) => toast.error("Failed to submit erasure request", { description: err.message }),
  });
  const cancelErasure = trpc.gdpr.cancelErasure.useMutation({
    onSuccess: (data) => {
      toast.success("Erasure cancelled", { description: data.message });
      refetch();
    },
    onError: (err) => toast.error("Failed to cancel erasure", { description: err.message }),
  });
  const exportData = trpc.gdpr.exportData.useMutation({
    onSuccess: (data) => {
      toast.success("Data export ready", {
        description: `${data.transactionCount} transactions and ${data.walletCount} wallets exported at ${new Date(data.exportedAt).toLocaleString()}`,
      });
    },
  });

  const req = erasureStatus?.request;
  const hasPending = erasureStatus?.hasPendingRequest;

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-destructive" />
          <CardTitle className="text-base">Privacy & Data Rights</CardTitle>
          <Badge variant="outline" className="text-xs ml-auto">GDPR Article 17</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Under GDPR, you have the right to export your data or request permanent erasure. Financial records are retained for regulatory compliance (AML/CFT).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Data Export */}
        <div className="flex items-center justify-between p-3 border rounded-xl">
          <div>
            <p className="text-sm font-medium">Export My Data</p>
            <p className="text-xs text-muted-foreground">Download all your personal data (GDPR Article 20)</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => exportData.mutate()} disabled={exportData.isPending}>
            <Download className="h-3 w-3 mr-1" />
            {exportData.isPending ? "Exporting..." : "Export"}
          </Button>
        </div>

        {/* Erasure Status */}
        {req && (
          <div className={`p-3 rounded-xl border ${
            req.status === 'pending' ? 'border-amber-500/40 bg-amber-500/5' :
            req.status === 'executed' ? 'border-green-500/40 bg-green-500/5' :
            'border-muted'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              {req.status === 'pending' && <Clock className="h-4 w-4 text-amber-500" />}
              {req.status === 'executed' && <CheckCircle className="h-4 w-4 text-green-500" />}
              {req.status === 'cancelled' && <XCircle className="h-4 w-4 text-muted-foreground" />}
              <p className="text-sm font-medium capitalize">Erasure Request — {req.status}</p>
            </div>
            {req.status === 'pending' && req.scheduledAt && (
              <p className="text-xs text-muted-foreground">
                Scheduled for: <span className="font-medium text-amber-600">{new Date(req.scheduledAt).toLocaleDateString()}</span>
                {" "}(30-day cooling-off period)
              </p>
            )}
            {req.status === 'executed' && req.executedAt && (
              <p className="text-xs text-muted-foreground">
                Executed on: {new Date(req.executedAt).toLocaleDateString()}. PII anonymized; financial records retained.
              </p>
            )}
          </div>
        )}

        {/* Request Erasure */}
        {!hasPending && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-destructive flex items-center gap-1">
              <Trash2 className="h-3.5 w-3.5" /> Request Account Erasure
            </p>
            <Textarea
              placeholder="Optional: reason for erasure request..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="text-xs min-h-[60px]"
              maxLength={500}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="w-full">
                  <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                  Request Data Erasure
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Erasure Request</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <span className="block">Your personal data (name, email, phone, address) will be permanently anonymized after a <strong>30-day cooling-off period</strong>.</span>
                    <span className="block text-amber-600 font-medium">Financial records (transactions, audit logs) are retained for 7 years as required by AML/CFT regulations.</span>
                    <span className="block">You can cancel this request at any time before the scheduled date.</span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => requestErasure.mutate({ reason: reason || undefined })}
                  >
                    Confirm Erasure Request
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* Cancel Erasure */}
        {hasPending && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full border-amber-500/50 text-amber-600 hover:bg-amber-500/10">
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Cancel Erasure Request
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel Erasure Request?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your account will remain active and no data will be deleted. You can submit a new erasure request at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep Request</AlertDialogCancel>
                <AlertDialogAction onClick={() => cancelErasure.mutate()}>
                  Cancel Erasure
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  
  const { data: profileData, refetch } = trpc.profile.get.useQuery();
  const updateProfile = trpc.profile.update.useMutation({ onSuccess: () => { refetch(); toast.success("Settings saved"); } });
  const p = (profileData as any) ?? {};
  const [currency, setCurrency] = useState(p.defaultCurrency ?? "NGN");
  const [language, setLanguage] = useState(p.language ?? "English");
  const { theme: currentTheme, toggleTheme } = useTheme();
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    if ((theme === "dark" && currentTheme === "light") || (theme === "light" && currentTheme === "dark")) {
      toggleTheme?.();
    }
  }, [theme]);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [pushNotifs, setPushNotifs] = useState(true);
  const [smsNotifs, setSmsNotifs] = useState(false);
  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3"><SettingsIcon className="h-6 w-6 text-primary" /><div><h1 className="text-2xl font-bold">Settings</h1><p className="text-muted-foreground text-sm">Manage your account preferences</p></div></div>
        <Card>
          <CardHeader className="pb-2"><div className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /><CardTitle className="text-base">Regional Preferences</CardTitle></div></CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs text-muted-foreground mb-1 block">Default Currency</label><Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Language</label><Select value={language} onValueChange={setLanguage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><div className="flex items-center gap-2"><Bell className="h-4 w-4 text-muted-foreground" /><CardTitle className="text-base">Notifications</CardTitle></div></CardHeader>
          <CardContent className="space-y-3">
            {[{ label: "Email Notifications", value: emailNotifs, set: setEmailNotifs }, { label: "Push Notifications", value: pushNotifs, set: setPushNotifs }, { label: "SMS Alerts", value: smsNotifs, set: setSmsNotifs }].map(n => (
              <div key={n.label} className="flex items-center justify-between p-3 border rounded-xl">
                <span className="text-sm font-medium">{n.label}</span>
                <Switch checked={n.value} onCheckedChange={n.set} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><div className="flex items-center gap-2"><Palette className="h-4 w-4 text-muted-foreground" /><CardTitle className="text-base">Appearance</CardTitle></div></CardHeader>
          <CardContent>
            <div><label className="text-xs text-muted-foreground mb-1 block">Theme</label><Select value={theme} onValueChange={(v) => setTheme(v as "dark" | "light")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{THEMES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></div>
          </CardContent>
        </Card>
        <Button className="w-full" onClick={() => updateProfile.mutate({ name: p.name ?? '' })} disabled={updateProfile.isPending}>Save Settings</Button>
        <GdprErasureCard />
      </div>
    </DashboardLayout>
  );
}
