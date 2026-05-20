import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Lock, Smartphone, Eye, EyeOff, Clock, CheckCircle, AlertTriangle, QrCode, Copy, Key, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

export default function SecuritySettings() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { data: secData } = trpc.security.status.useQuery();
  const { data: auditLogs = [] } = trpc.security.events.useQuery();

  const [show2FASetup, setShow2FASetup] = useState(false);
  const [show2FADisable, setShow2FADisable] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [qrData, setQrData] = useState<any>(null);
  const [pinForm, setPinForm] = useState({ current: "", next: "", confirm: "" });
  const [showPin, setShowPin] = useState(false);

  const setup2fa = trpc.security.enable2fa.useMutation({
    onSuccess: (data) => { setQrData(data); setShow2FASetup(true); },
    onError: (e) => toast.error(e.message),
  });
  const enable2fa = trpc.security.verify2fa.useMutation({
    onSuccess: () => { toast.success("2FA enabled successfully"); setShow2FASetup(false); setTotpCode(""); setQrData(null); utils.security.status.invalidate(); },
    onError: (e) => toast.error(e.message || "Invalid code"),
  });
  const disable2fa = trpc.security.disable2fa.useMutation({
    onSuccess: () => { toast.success("2FA disabled"); setShow2FADisable(false); setDisableCode(""); utils.security.status.invalidate(); },
    onError: (e) => toast.error(e.message || "Invalid code"),
  });
  const changePin = trpc.security.changePin.useMutation({
    onSuccess: () => { toast.success("PIN updated"); setPinForm({ current: "", next: "", confirm: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const twoFactorEnabled = (secData as any)?.twoFactorEnabled ?? false;
  const logs = Array.isArray(auditLogs) ? auditLogs : [];
  const secScore = Math.min(10 + (twoFactorEnabled ? 40 : 0) + ((secData as any)?.kycVerified ? 30 : 0) + ((secData as any)?.profileComplete ? 20 : 0), 100);
  const scoreColor = secScore >= 80 ? "text-emerald-400" : secScore >= 50 ? "text-yellow-400" : "text-red-400";

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="w-6 h-6 text-primary" />Security Settings</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your account security and authentication</p>
          </div>
          <div className="text-right">
            <div className={"text-3xl font-black " + scoreColor}>{secScore}</div>
            <div className="text-xs text-muted-foreground">{secScore >= 80 ? "Strong" : secScore >= 50 ? "Moderate" : "Weak"} security</div>
          </div>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              {secScore >= 80 ? <ShieldCheck className="w-8 h-8 text-emerald-400" /> : <ShieldAlert className="w-8 h-8 text-yellow-400" />}
              <div>
                <p className="font-semibold">Security Score: {secScore}/100</p>
                <p className="text-xs text-muted-foreground">{secScore < 80 ? "Enable 2FA and complete KYC to reach 100" : "Your account is well protected"}</p>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className={"h-2 rounded-full transition-all " + (secScore >= 80 ? "bg-emerald-500" : secScore >= 50 ? "bg-yellow-500" : "bg-red-500")} style={{ width: secScore + "%" }} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
              {[{ label: "2FA (+40)", ok: twoFactorEnabled }, { label: "KYC (+30)", ok: (secData as any)?.kycVerified }, { label: "Profile (+20)", ok: (secData as any)?.profileComplete }].map(s => (
                <div key={s.label} className={"flex items-center gap-1 " + (s.ok ? "text-emerald-400" : "text-muted-foreground")}>
                  {s.ok ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}{s.label}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="w-4 h-4" />Two-Factor Authentication</CardTitle>
            <CardDescription>TOTP authenticator app (Google Authenticator, Authy, 1Password)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border">
              <div className="flex items-center gap-3">
                <div className={"w-2 h-2 rounded-full " + (twoFactorEnabled ? "bg-emerald-500" : "bg-muted-foreground")} />
                <div>
                  <p className="font-medium text-sm">Authenticator App (TOTP)</p>
                  <p className="text-xs text-muted-foreground">{twoFactorEnabled ? "Active — required for transfers over $1,000" : "Not enabled"}</p>
                </div>
              </div>
              {twoFactorEnabled ? (
                <Button variant="destructive" size="sm" onClick={() => setShow2FADisable(true)}>Disable</Button>
              ) : (
                <Button size="sm" onClick={() => setup2fa.mutate()} disabled={setup2fa.isPending}>
                  {setup2fa.isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <QrCode className="w-3 h-3 mr-1" />}Enable 2FA
                </Button>
              )}
            </div>
            {twoFactorEnabled && (
              <Alert className="border-emerald-500/30 bg-emerald-500/10">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <AlertDescription className="text-emerald-400 text-sm">2FA is active. You will be prompted for a 6-digit code on transfers over $1,000 USD.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="w-4 h-4" />Transaction PIN</CardTitle>
            <CardDescription>6-digit PIN required to confirm all outgoing transfers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Current PIN</Label>
              <div className="relative">
                <Input type={showPin ? "text" : "password"} maxLength={6} value={pinForm.current} onChange={e => setPinForm(p => ({ ...p, current: e.target.value.replace(/\D/g, "") }))} placeholder="••••••" />
              </div>
            </div>
            <div><Label>New PIN</Label><Input type="password" maxLength={6} value={pinForm.next} onChange={e => setPinForm(p => ({ ...p, next: e.target.value.replace(/\D/g, "") }))} placeholder="••••••" /></div>
            <div><Label>Confirm New PIN</Label><Input type="password" maxLength={6} value={pinForm.confirm} onChange={e => setPinForm(p => ({ ...p, confirm: e.target.value.replace(/\D/g, "") }))} placeholder="••••••" /></div>
            {pinForm.next && pinForm.confirm && pinForm.next !== pinForm.confirm && <p className="text-destructive text-sm">PINs do not match</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="w-4 h-4" />Security Activity Log</CardTitle></CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground"><AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No security events recorded yet</p></div>
            ) : (
              <div className="space-y-2">
                {logs.slice(0, 15).map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={"w-2 h-2 rounded-full shrink-0 " + (log.severity === "critical" ? "bg-red-500" : log.severity === "warning" ? "bg-yellow-500" : "bg-emerald-500")} />
                      <div><p className="text-sm font-medium">{log.action?.replace(/_/g, " ")}</p><p className="text-xs text-muted-foreground">{log.description}</p></div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{new Date(log.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={show2FASetup} onOpenChange={v => { setShow2FASetup(v); if (!v) { setQrData(null); setTotpCode(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><QrCode className="w-5 h-5" />Set Up Two-Factor Authentication</DialogTitle></DialogHeader>
            {qrData && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Scan this QR code with your authenticator app</p>
                <div className="flex justify-center p-4 bg-white rounded-lg"><img src={qrData.qrCode} alt="2FA QR" className="w-48 h-48" /></div>
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Manual entry key:</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono flex-1 break-all">{qrData.secret}</code>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { navigator.clipboard.writeText(qrData.secret); toast.success("Copied"); }}><Copy className="w-3 h-3" /></Button>
                  </div>
                </div>
                <div>
                  <Label>Enter the 6-digit code from your app</Label>
                  <Input className="mt-1 text-center text-xl tracking-widest font-mono" maxLength={6} placeholder="000000" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))} onKeyDown={e => e.key === "Enter" && totpCode.length === 6 && enable2fa.mutate({ code: totpCode })} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShow2FASetup(false); setQrData(null); setTotpCode(""); }}>Cancel</Button>
              <Button disabled={totpCode.length !== 6 || enable2fa.isPending} onClick={() => enable2fa.mutate({ code: totpCode })}>{enable2fa.isPending ? "Verifying..." : "Verify & Enable"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={show2FADisable} onOpenChange={setShow2FADisable}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><ShieldAlert className="w-5 h-5" />Disable Two-Factor Authentication</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <Alert className="border-destructive/30 bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <AlertDescription className="text-sm">Disabling 2FA reduces your account security significantly.</AlertDescription>
              </Alert>
              <div>
                <Label>Enter your current 6-digit authenticator code</Label>
                <Input className="mt-1 text-center text-xl tracking-widest font-mono" maxLength={6} placeholder="000000" value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShow2FADisable(false)}>Cancel</Button>
              <Button variant="destructive" disabled={disableCode.length !== 6 || disable2fa.isPending} onClick={() => disable2fa.mutate({ code: disableCode })}>{disable2fa.isPending ? "Disabling..." : "Disable 2FA"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
