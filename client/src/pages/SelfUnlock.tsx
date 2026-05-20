/**
 * SelfUnlock.tsx — v152
 * Self-service account unlock page for users who have been locked out.
 * Accessible at /unlock?token=<token> or /unlock (to request an unlock email).
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Lock, Unlock, Mail, CheckCircle, AlertTriangle, ArrowLeft } from "lucide-react";

function getTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

export default function SelfUnlock() {
  const [, navigate] = useLocation();
  const [token] = useState<string | null>(() => getTokenFromUrl());
  const [userId, setUserId] = useState<string>("");
  const [requestSent, setRequestSent] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Request unlock email ────────────────────────────────────────────────────
  const requestMutation = trpc.securityAudit.requestSelfUnlock.useMutation({
    onSuccess: () => {
      setRequestSent(true);
      setErrorMsg(null);
    },
    onError: (err) => {
      setErrorMsg(err.message);
    },
  });

  // ── Verify token ────────────────────────────────────────────────────────────
  const verifyMutation = trpc.securityAudit.verifySelfUnlock.useMutation({
    onSuccess: () => {
      setUnlocked(true);
      setErrorMsg(null);
    },
    onError: (err) => {
      setErrorMsg(err.message);
    },
  });

  // Auto-verify if token is in URL
  useEffect(() => {
    if (token && !unlocked && !verifyMutation.isPending) {
      verifyMutation.mutate({ token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleRequestUnlock = () => {
    setErrorMsg(null);
    const id = parseInt(userId.trim(), 10);
    if (!id || id <= 0) {
      setErrorMsg("Please enter a valid User ID (found in your account settings or welcome email).");
      return;
    }
    requestMutation.mutate({ userId: id });
  };

  // ── Unlocked success state ──────────────────────────────────────────────────
  if (unlocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl text-green-700">Account Unlocked</CardTitle>
            <CardDescription>Your account has been successfully unlocked.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                You can now log in to your RemitFlow account. If you continue to experience issues,
                please contact our support team.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={() => navigate("/")}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Token verification in progress ─────────────────────────────────────────
  if (token && verifyMutation.isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-4 animate-pulse">
              <Unlock className="h-8 w-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl">Verifying Unlock Token</CardTitle>
            <CardDescription>Please wait while we verify your unlock link…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ── Request sent confirmation ───────────────────────────────────────────────
  if (requestSent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
              <Mail className="h-8 w-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl">Unlock Email Sent</CardTitle>
            <CardDescription>Check your inbox for the unlock link.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-blue-200 bg-blue-50">
              <Mail className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                An unlock link has been sent. The link expires in <strong>1 hour</strong>.
                If you don&apos;t see the email, check your spam folder.
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground text-center">
              You can request another unlock email after 1 hour.
            </p>
            <Button variant="outline" className="w-full" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main form (request unlock or show token error) ──────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <Lock className="h-8 w-8 text-amber-600" />
          </div>
          <CardTitle className="text-2xl">Account Locked</CardTitle>
          <CardDescription>
            Your account has been temporarily locked due to multiple failed login attempts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Show token error if token was provided but invalid */}
          {token && errorMsg && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          {/* Show general error */}
          {!token && errorMsg && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <Shield className="h-4 w-4" />
              Why was my account locked?
            </div>
            <p>
              For your security, accounts are temporarily locked for 30 minutes after 5 consecutive
              failed login attempts. This protects against unauthorized access.
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="userId">Your User ID</Label>
              <Input
                id="userId"
                type="number"
                placeholder="e.g. 12345"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRequestUnlock()}
                disabled={requestMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Your User ID is shown in Account Settings or your welcome email.
              </p>
            </div>

            <Button
              className="w-full"
              onClick={handleRequestUnlock}
              disabled={requestMutation.isPending || !userId.trim()}
            >
              {requestMutation.isPending ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Sending unlock email…
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Send Unlock Email
                </>
              )}
            </Button>
          </div>

          <div className="text-center text-sm text-muted-foreground">
            <p>
              Your account will automatically unlock after <strong>30 minutes</strong>.
            </p>
            <p className="mt-1">
              Need help?{" "}
              <a href="mailto:support@remitflow.com" className="text-primary underline underline-offset-2">
                Contact Support
              </a>
            </p>
          </div>

          <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
