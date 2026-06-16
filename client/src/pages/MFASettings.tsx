import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, KeyRound, QrCode, Copy, Eye, EyeOff } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function MFASettings() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [enrollData, setEnrollData] = useState<{ secret: string; otpAuthUrl: string; qrCodeUrl: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showSecret, setShowSecret] = useState(false);

  const { data: status, isLoading } = trpc.mfa.status.useQuery();

  const enrollMut = trpc.mfa.enroll.useMutation({
    onSuccess: (data) => { setEnrollData(data); },
    onError: (e) => toast.error(e.message),
  });

  const verifyMut = trpc.mfa.verify.useMutation({
    onSuccess: () => {
      utils.mfa.status.invalidate();
      setEnrollOpen(false);
      setEnrollData(null);
      setVerifyCode("");
      toast.success("MFA enabled successfully! Your account is now more secure.");
    },
    onError: (e) => toast.error(e.message),
  });

  const disableMut = trpc.mfa.disable.useMutation({
    onSuccess: () => {
      utils.mfa.status.invalidate();
      setDisableOpen(false);
      setDisableCode("");
      toast.success("MFA disabled");
    },
    onError: (e) => toast.error(e.message),
  });

  const backupMut = trpc.mfa.generateBackupCodes.useMutation({
    onSuccess: (data) => { setBackupCodes(data.codes); setBackupOpen(true); },
    onError: (e) => toast.error(e.message),
  });

  function startEnroll() {
    setEnrollOpen(true);
    enrollMut.mutate();
  }

  function copySecret() {
    if (enrollData?.secret) { navigator.clipboard.writeText(enrollData.secret); toast.success("Secret copied"); }
  }

  if (isLoading) return <div className="p-6 animate-pulse"><div className="h-40 bg-muted rounded-lg" /></div>;

  return (

    <DashboardLayout>
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-green-500" /> Two-Factor Authentication</h1>
        <p className="text-muted-foreground text-sm mt-1">Add an extra layer of security to your RemitFlow account</p>
      </div>

      {/* Status Card */}
      <Card className={status?.enabled ? "border-green-300 bg-green-50/30" : "border-orange-300 bg-orange-50/30"}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {status?.enabled ? <ShieldCheck className="w-8 h-8 text-green-500" /> : <ShieldOff className="w-8 h-8 text-orange-500" />}
              <div>
                <p className="font-semibold">{status?.enabled ? "MFA is Enabled" : "MFA is Disabled"}</p>
                <p className="text-sm text-muted-foreground">
                  {status?.enabled
                    ? `Enrolled ${status.enrolledAt ? new Date(status.enrolledAt).toLocaleDateString() : ""}${status.lastUsedAt ? ` · Last used ${new Date(status.lastUsedAt).toLocaleDateString()}` : ""}`
                    : "Your account is protected by password only"}
                </p>
              </div>
            </div>
            <Badge className={status?.enabled ? "bg-green-500" : "bg-orange-500"}>{status?.enabled ? "Active" : "Inactive"}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="grid gap-4">
        {!status?.enabled ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><QrCode className="w-4 h-4" /> Enable Authenticator App</CardTitle>
              <CardDescription>Use Google Authenticator, Authy, or any TOTP app to generate time-based codes</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={startEnroll} disabled={enrollMut.isPending} className="gap-2">
                <ShieldCheck className="w-4 h-4" /> {enrollMut.isPending ? "Setting up..." : "Enable MFA"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><KeyRound className="w-4 h-4" /> Backup Codes</CardTitle>
                <CardDescription>Generate one-time backup codes in case you lose access to your authenticator app</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => backupMut.mutate()} disabled={backupMut.isPending} className="gap-2">
                  <KeyRound className="w-4 h-4" /> {backupMut.isPending ? "Generating..." : "Generate Backup Codes"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive"><ShieldOff className="w-4 h-4" /> Disable MFA</CardTitle>
                <CardDescription>This will remove two-factor authentication from your account</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="destructive" onClick={() => setDisableOpen(true)} className="gap-2">
                  <ShieldOff className="w-4 h-4" /> Disable MFA
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Enroll Dialog */}
      <Dialog open={enrollOpen} onOpenChange={(o) => { if (!o) { setEnrollOpen(false); setEnrollData(null); setVerifyCode(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Set Up Two-Factor Authentication</DialogTitle></DialogHeader>
          {enrollMut.isPending && !enrollData ? (
            <div className="py-8 text-center text-muted-foreground">Generating your secret key...</div>
          ) : enrollData ? (
            <div className="space-y-5">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Step 1: Scan QR Code</p>
                <p>Open your authenticator app and scan this QR code, or enter the secret key manually.</p>
              </div>
              <div className="flex justify-center">
                <img src={enrollData.qrCodeUrl} alt="QR Code" className="w-48 h-48 border rounded-lg" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Manual Entry Key</Label>
                <div className="flex gap-2">
                  <Input
                    value={showSecret ? enrollData.secret : enrollData.secret.replace(/./g, "•")}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="icon" onClick={() => setShowSecret(s => !s)}>{showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
                  <Button variant="outline" size="icon" onClick={copySecret}><Copy className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Step 2: Enter Verification Code</p>
                <Input
                  placeholder="000000"
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  className="text-center text-2xl font-mono tracking-widest"
                />
              </div>
              <Button onClick={() => verifyMut.mutate({ code: verifyCode })} disabled={verifyCode.length !== 6 || verifyMut.isPending} className="w-full">
                {verifyMut.isPending ? "Verifying..." : "Verify & Enable MFA"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Disable Dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Disable Two-Factor Authentication</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter your current authenticator code to confirm disabling MFA.</p>
            <Input
              placeholder="000000"
              value={disableCode}
              onChange={e => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="text-center text-2xl font-mono tracking-widest"
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDisableOpen(false)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={() => disableMut.mutate({ code: disableCode })} disabled={disableCode.length !== 6 || disableMut.isPending}>
                {disableMut.isPending ? "Disabling..." : "Disable MFA"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Backup Codes Dialog */}
      <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Your Backup Codes</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Save these codes in a safe place. Each code can only be used once.</p>
            <div className="bg-muted rounded-lg p-4 grid grid-cols-2 gap-2">
              {backupCodes.map(code => (
                <code key={code} className="text-sm font-mono text-center py-1 bg-background rounded border">{code}</code>
              ))}
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={() => { navigator.clipboard.writeText(backupCodes.join("\n")); toast.success("Codes copied"); }}>
              <Copy className="w-4 h-4" /> Copy All Codes
            </Button>
            <Button className="w-full" onClick={() => setBackupOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
