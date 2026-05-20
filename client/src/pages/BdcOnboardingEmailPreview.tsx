import { toast } from 'sonner';
/**
 * BdcOnboardingEmailPreview.tsx — v194
 *
 * Admin-only page at /admin/email-preview/bdc-onboarding
 * Renders the BDC partner onboarding email HTML in an iframe so compliance
 * staff can review the template before it goes live.
 */
import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Eye, RefreshCw, Mail, Shield, ChevronLeft, Copy, Check } from "lucide-react";

export default function BdcOnboardingEmailPreview() {
  const { user } = useAuth();
  const authLoading = false;
  const [, navigate] = useLocation();
  const [partnerName, setPartnerName] = useState("Acme BDC Limited");
  const [cbnLicenceNumber, setCbnLicenceNumber] = useState("");
  const [adbName, setAdbName] = useState("Access Bank Nigeria");
  const [maxDailyFxUsd, setMaxDailyFxUsd] = useState(100000);

  // Pre-fill from URL query params (e.g. when navigated from BDC Partners tab)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qPartnerName = params.get("partnerName");
    const qCbnLicenceNumber = params.get("cbnLicenceNumber");
    const qAdbName = params.get("adbName");
    const qMaxDailyFxUsd = params.get("maxDailyFxUsd");
    if (qPartnerName) setPartnerName(qPartnerName);
    if (qCbnLicenceNumber) setCbnLicenceNumber(qCbnLicenceNumber);
    if (qAdbName) setAdbName(qAdbName);
    if (qMaxDailyFxUsd) setMaxDailyFxUsd(Number(qMaxDailyFxUsd));
  }, []);
  const [copied, setCopied] = useState(false);

  const { data: preview, refetch } = trpc.cbnCompliance.getBdcOnboardingEmailPreview.useQuery(
    { partnerName, cbnLicenceNumber, adbName, maxDailyFxUsd },
    { enabled: !!user && user.role === "admin" }
  );

  const handleCopyHtml = useCallback(() => {
    if (!preview?.html) return;
    navigator.clipboard.writeText(preview.html).then(() => {
      setCopied(true);
      toast("HTML Copied", { description: "Email HTML copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    });
  }, [preview?.html, toast]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-white/50 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Card className="bg-white/5 border-white/10 max-w-sm w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <Shield className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <h2 className="text-white font-semibold mb-2">Admin Access Required</h2>
            <p className="text-white/50 text-sm mb-4">This page is restricted to administrators.</p>
            <Button onClick={() => navigate("/admin")} variant="outline" className="border-white/20 text-white hover:bg-white/10">
              Go to Admin
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-white/60 hover:text-white hover:bg-white/10"
            onClick={() => navigate("/admin")}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Admin
          </Button>
          <span className="text-white/30">/</span>
          <span className="text-white/70 text-sm">Email Preview</span>
          <span className="text-white/30">/</span>
          <span className="text-white text-sm font-medium">BDC Onboarding</span>
          <Badge className="bg-indigo-500/20 text-indigo-300 ml-auto">Preview Only</Badge>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Mail className="w-7 h-7 text-indigo-400" />
            BDC Onboarding Email Preview
          </h1>
          <p className="text-white/50 mt-1 text-sm">
            Preview the onboarding email sent to BDC partners when their application is approved.
            Credentials shown are sample values only — no real data is used.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Eye className="w-4 h-4 text-indigo-400" />
                  Preview Parameters
                </CardTitle>
                <CardDescription className="text-white/50 text-xs">
                  Adjust sample values to see how the email renders for different partners.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-white/70 text-xs mb-1 block">Partner Name</Label>
                  <Input
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                    placeholder="Acme BDC Limited"
                  />
                </div>
                <div>
                  <Label className="text-white/70 text-xs mb-1 block">CBN Licence Number</Label>
                  <Input
                    value={cbnLicenceNumber}
                    onChange={(e) => setCbnLicenceNumber(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                    placeholder="BDC/2024/DEMO-001"
                  />
                </div>
                <div>
                  <Label className="text-white/70 text-xs mb-1 block">ADB Name</Label>
                  <Input
                    value={adbName}
                    onChange={(e) => setAdbName(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                    placeholder="Access Bank Nigeria"
                  />
                </div>
                <div>
                  <Label className="text-white/70 text-xs mb-1 block">Daily FX Limit (USD)</Label>
                  <Input
                    type="number"
                    value={maxDailyFxUsd}
                    onChange={(e) => setMaxDailyFxUsd(Number(e.target.value))}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                    placeholder="100000"
                    min={0}
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => refetch()}
                    disabled={false}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${false ? "animate-spin" : ""}`} />
                    {false ? "Refreshing..." : "Refresh Preview"}
                  </Button>
                  <Button
                    onClick={handleCopyHtml}
                    disabled={!preview?.html}
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                    title="Copy HTML to clipboard"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Metadata */}
            {preview?.previewData && (
              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Generated Values</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/50">Subject</span>
                    <span className="text-white/80 font-mono truncate max-w-[180px]" title={preview.subject}>{preview.subject}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Keycloak Client ID</span>
                    <span className="text-indigo-300 font-mono">{preview.previewData.keycloakClientId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Realm URL</span>
                    <span className="text-white/60 font-mono truncate max-w-[180px]" title={preview.previewData.keycloakRealmUrl}>{preview.previewData.keycloakRealmUrl}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Gateway URL</span>
                    <span className="text-sky-300 font-mono truncate max-w-[180px]" title={preview.previewData.apisixGatewayUrl}>{preview.previewData.apisixGatewayUrl}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Email Preview Iframe */}
          <div className="lg:col-span-2">
            <Card className="bg-white/5 border-white/10 h-full">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Mail className="w-4 h-4 text-indigo-400" />
                  Email Render
                  <Badge className="bg-yellow-500/20 text-yellow-300 text-xs ml-auto">Sample Data</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {false ? (
                  <div className="flex items-center justify-center h-96 text-white/40">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                    <span className="text-sm">Generating preview...</span>
                  </div>
                ) : preview?.html ? (
                  <iframe
                    title="BDC Onboarding Email Preview"
                    srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#1e293b;}</style></head><body>${preview.html}</body></html>`}
                    className="w-full rounded-b-lg border-0"
                    style={{ height: "680px" }}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div className="flex items-center justify-center h-96 text-white/40">
                    <Eye className="w-6 h-6 mr-2 opacity-40" />
                    <span className="text-sm">No preview available.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
