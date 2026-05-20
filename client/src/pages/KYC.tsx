import { useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Shield, CheckCircle2, Upload, FileText, Camera, User,
  Loader2, AlertTriangle, Eye, Info, Copy, Check,
} from "lucide-react";
import { useTranslation } from 'react-i18next';
import LivenessCapture, { type LivenessCaptureResult } from "@/components/LivenessCapture";

const TIER_LIMITS: Record<number, { daily: string; monthly: string }> = {
  0: { daily: "₦50,000", monthly: "₦200,000" },
  1: { daily: "₦500,000", monthly: "₦2,000,000" },
  2: { daily: "₦5,000,000", monthly: "₦20,000,000" },
  3: { daily: "Unlimited", monthly: "Unlimited" },
};

type OcrResult = {
  source: "kyc-fastapi" | "mock";
  extractedFields: {
    fullName: string | null;
    dateOfBirth: string | null;
    documentNumber: string | null;
    expiryDate: string | null;
    nationality: string | null;
    address: string | null;
    confidence: number;
  };
  livenessScore: number | null;
  livenessConfidence?: number | null;
  deepfakeScore?: number | null;
  deepfakeMethod?: string | null;
  deepfakeIndicators?: string[];
  sanctionsHit: boolean;
  riskLevel: string;
};

export default function KYC() {
  const { t } = useTranslation();
  
  const { data: kycStatus, refetch } = trpc.kyc.status.useQuery();
  const uploadMutation = trpc.kyc.uploadDocument.useMutation({
    onSuccess: () => { toast.success("Document submitted for review!"); refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const extractMutation = trpc.kyc.extractDocument.useMutation({
    onSuccess: (data) => {
      setOcrResult(data as OcrResult);
      setUploadPhase("confirm");
    },
    onError: (err) => {
      toast.error(`OCR extraction failed: ${err.message}`);
      setUploadPhase("select");
    },
  });

  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<"select" | "liveness" | "extracting" | "confirm" | "done">("select");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [confirmedFields, setConfirmedFields] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [livenessVideoBlob, setLivenessVideoBlob] = useState<Blob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tierStr = kycStatus?.currentTier ?? "tier0";
  const tier = Number(tierStr.replace("tier", "")) || 0;

  const steps = [
    { id: "bvn", label: "BVN Verification", icon: User, done: tier >= 1, docType: "bvn" },
    { id: "id", label: "Government ID", icon: FileText, done: tier >= 2, docType: "national_id" },
    { id: "selfie", label: "Selfie / Liveness", icon: Camera, done: tier >= 2, docType: "selfie" },
    { id: "address", label: "Proof of Address", icon: Shield, done: tier >= 3, docType: "proof_of_address" },
  ];

  const openUpload = (stepId: string) => {
    setActiveStep(stepId);
    // For the selfie step, go straight to live video capture
    setUploadPhase(stepId === "selfie" ? "liveness" : "select");
    setSelectedFile(null);
    setFilePreview(null);
    setOcrResult(null);
    setConfirmedFields({});
    setLivenessVideoBlob(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("File too large (max 16 MB)"); return; }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setFilePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleUploadAndExtract = async () => {
    if (!selectedFile || !activeStep) return;
    setUploadPhase("extracting");
    const step = steps.find(s => s.id === activeStep)!;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      try {
        const uploadResult = await uploadMutation.mutateAsync({
          type: step.docType,
          fileBase64: base64,
          fileName: selectedFile.name,
          mimeType: selectedFile.type,
        });
        extractMutation.mutate({
          fileUrl: uploadResult.url,
          docType: step.docType,
          mimeType: selectedFile.type,
        });
      } catch {
        setUploadPhase("select");
      }
    };
    reader.readAsDataURL(selectedFile);
  };

  /** Called by LivenessCapture after a successful webcam recording */
  const handleLivenessCapture = async (result: LivenessCaptureResult) => {
    setLivenessVideoBlob(result.videoBlob);
    setUploadPhase("extracting");
    try {
      // Upload still frame for passive liveness + OCR
      const stillBase64 = result.stillFrameDataUrl.split(",")[1];
      const uploadResult = await uploadMutation.mutateAsync({
        type: "selfie",
        fileBase64: stillBase64,
        fileName: `selfie-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      });

      // Upload video for active liveness analysis
      const videoArrayBuffer = await result.videoBlob.arrayBuffer();
      const videoBase64 = btoa(
        new Uint8Array(videoArrayBuffer).reduce((d, b) => d + String.fromCharCode(b), "")
      );
      await uploadMutation.mutateAsync({
        type: "selfie_video",
        fileBase64: videoBase64,
        fileName: `selfie-video-${Date.now()}.webm`,
        mimeType: result.videoBlob.type || "video/webm",
      }).catch(() => { /* video upload is best-effort */ });

      extractMutation.mutate({
        fileUrl: uploadResult.url,
        docType: "selfie",
        mimeType: "image/jpeg",
      });
    } catch {
      toast.error("Liveness capture upload failed. Please try again.");
      setUploadPhase("liveness");
    }
  };

  const handleConfirmFields = () => {
    toast.success("Document verified and fields confirmed!");
    setUploadPhase("done");
    refetch();
    setTimeout(() => { setActiveStep(null); setUploadPhase("select"); }, 1500);
  };

  const copyField = (value: string, key: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };

  const activeStepInfo = steps.find(s => s.id === activeStep);
  const confidencePct = ocrResult ? Math.round(ocrResult.extractedFields.confidence * 100) : 0;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">KYC Verification</h1>
          <p className="text-muted-foreground text-sm">Complete verification to unlock higher limits</p>
        </div>

        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm text-muted-foreground">Current Tier</div>
                <div className="text-3xl font-bold">Tier {tier}</div>
              </div>
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                <Shield className="h-8 w-8 text-primary" />
              </div>
            </div>
            <Progress value={(tier / 3) * 100} className="h-3 mb-3" />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-muted-foreground">Daily Limit</div><div className="font-semibold">{TIER_LIMITS[tier]?.daily}</div></div>
              <div><div className="text-muted-foreground">Monthly Limit</div><div className="font-semibold">{TIER_LIMITS[tier]?.monthly}</div></div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <Card key={step.id} className={step.done ? "border-emerald-200 bg-emerald-50/50" : ""}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step.done ? "bg-emerald-100" : "bg-muted"}`}>
                    {step.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Icon className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{step.label}</div>
                    <div className="text-xs text-muted-foreground">Step {i + 1} of {steps.length}</div>
                  </div>
                  {step.done
                    ? <Badge className="bg-emerald-100 text-emerald-700 border-0">Verified</Badge>
                    : <Button size="sm" variant="outline" onClick={() => openUpload(step.id)}>
                        <Upload className="h-4 w-4 mr-1" />Upload
                      </Button>
                  }
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* KYC Provider Selection */}
        <Card className="border-blue-100 bg-blue-50/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-500" />
              Verification Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">Choose your preferred identity verification provider. All providers are GDPR-compliant and support 190+ countries.</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "onfido", name: "Onfido", desc: "AI-powered ID & biometric", badge: "Recommended", color: "blue" },
                { id: "sumsub", name: "Sumsub", desc: "All-in-one KYC/AML platform", badge: "Popular", color: "purple" },
                { id: "veriff", name: "Veriff", desc: "End-to-end identity verification", badge: "Enterprise", color: "green" },
              ].map(p => (
                <div key={p.id} className={`p-3 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md border-${p.color}-200 bg-${p.color}-50/30`}>
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
                  <Badge variant="secondary" className="mt-1.5 text-[10px] px-1.5 py-0">{p.badge}</Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Webhook endpoints active: <code className="bg-muted px-1 rounded text-[10px]">/api/kyc/webhook/onfido</code> · <code className="bg-muted px-1 rounded text-[10px]">/api/kyc/webhook/sumsub</code> · <code className="bg-muted px-1 rounded text-[10px]">/api/kyc/webhook/veriff</code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Submitted Documents</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(kycStatus?.documents ?? []).map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium capitalize">{(doc.docType ?? doc.type ?? "Document").replace(/_/g, " ")}</div>
                    <div className="text-xs text-muted-foreground">{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}</div>
                  </div>
                </div>
                <Badge variant={doc.status === "approved" ? "default" : doc.status === "pending" ? "secondary" : "destructive"} className="text-xs capitalize">{doc.status}</Badge>
              </div>
            ))}
            {(!kycStatus?.documents || kycStatus.documents.length === 0) && (
              <div className="text-center py-4 text-muted-foreground text-sm">No documents submitted yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!activeStep} onOpenChange={(open) => { if (!open) setActiveStep(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeStepInfo && <activeStepInfo.icon className="h-5 w-5 text-primary" />}
              {activeStepInfo?.label ?? "Upload Document"}
            </DialogTitle>
            <DialogDescription>
              {uploadPhase === "liveness" && "Complete the active liveness check to verify you are present."}
              {uploadPhase === "select" && "Select a file to upload. Our AI will extract key fields automatically."}
              {uploadPhase === "extracting" && "Uploading and running OCR extraction…"}
              {uploadPhase === "confirm" && "Review the extracted fields below and confirm they are correct."}
              {uploadPhase === "done" && "Document verified successfully!"}
            </DialogDescription>
          </DialogHeader>

          {uploadPhase === "liveness" && (
            <LivenessCapture
              onCapture={handleLivenessCapture}
              onCancel={() => setUploadPhase("select")}
              recordingDurationSec={4}
            />
          )}

          {uploadPhase === "select" && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-muted-foreground/30 rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {filePreview && selectedFile?.type.startsWith("image/") ? (
                  <img src={filePreview} alt="Preview" className="max-h-40 mx-auto rounded-lg object-contain mb-2" />
                ) : (
                  <Upload className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">{selectedFile ? selectedFile.name : "Click to select file"}</p>
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG, PDF — max 16 MB</p>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
              </div>
              <Button className="w-full" disabled={!selectedFile || uploadMutation.isPending} onClick={handleUploadAndExtract}>
                <Upload className="h-4 w-4 mr-2" /> Upload &amp; Extract Fields
              </Button>
            </div>
          )}

          {uploadPhase === "extracting" && (
            <div className="py-10 text-center space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <p className="font-medium">Running AI OCR extraction…</p>
              <p className="text-sm text-muted-foreground">PaddleOCR + VLM pipeline processing your document</p>
            </div>
          )}

          {uploadPhase === "confirm" && ocrResult && (
            <div className="space-y-4">
              <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
                ocrResult.source === "mock" ? "bg-amber-50 border border-amber-200" : "bg-emerald-50 border border-emerald-200"
              }`}>
                <Info className={`h-4 w-4 flex-shrink-0 ${ocrResult.source === "mock" ? "text-amber-600" : "text-emerald-600"}`} />
                <div>
                  <span className="font-medium">{ocrResult.source === "mock" ? "Demo extraction" : "AI extraction"}</span>
                  {" — "}{confidencePct}% confidence
                  {ocrResult.source === "mock" && <span className="text-amber-600"> (KYC service offline)</span>}
                </div>
              </div>

              {ocrResult.sanctionsHit && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>Sanctions screening returned a potential match. Manual review required.</span>
                </div>
              )}

              <div className="space-y-3">
                {(Object.entries(ocrResult.extractedFields) as [string, string | number | null][])
                  .filter(([k]) => k !== "confidence")
                  .map(([key, value]) => {
                    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                    const displayVal = value != null ? String(value) : "—";
                    const fieldVal = confirmedFields[key] ?? displayVal;
                    return (
                      <div key={key}>
                        <Label className="text-xs text-muted-foreground">{label}</Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            value={fieldVal === "—" ? "" : fieldVal}
                            placeholder={fieldVal === "—" ? "Not detected" : ""}
                            onChange={e => setConfirmedFields(prev => ({ ...prev, [key]: e.target.value }))}
                            className="text-sm h-8"
                          />
                          {fieldVal !== "—" && (
                            <button
                              onClick={() => copyField(fieldVal, key)}
                              className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
                              title="Copy"
                            >
                              {copied === key ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Liveness score */}
              {ocrResult.livenessScore != null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4" />
                  <span>Liveness score: <strong>{Math.round(ocrResult.livenessScore * 100)}%</strong></span>
                  {ocrResult.livenessConfidence != null && (
                    <span className="text-xs text-muted-foreground">(confidence: {Math.round(ocrResult.livenessConfidence * 100)}%)</span>
                  )}
                </div>
              )}

              {/* Deepfake analysis result */}
              {ocrResult.deepfakeScore != null && (
                <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                  ocrResult.deepfakeScore >= 0.55
                    ? "bg-red-50 border border-red-200 text-red-700"
                    : ocrResult.deepfakeScore >= 0.35
                    ? "bg-amber-50 border border-amber-200 text-amber-700"
                    : "bg-emerald-50 border border-emerald-200 text-emerald-700"
                }`}>
                  <Shield className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-medium">
                      {ocrResult.deepfakeScore >= 0.55
                        ? "Deepfake risk: HIGH"
                        : ocrResult.deepfakeScore >= 0.35
                        ? "Deepfake risk: MEDIUM"
                        : "Deepfake risk: LOW"}
                      {" "}
                      <span className="font-normal text-xs opacity-75">
                        ({Math.round(ocrResult.deepfakeScore * 100)}% confidence
                        {ocrResult.deepfakeMethod ? ` · ${ocrResult.deepfakeMethod}` : ""})
                      </span>
                    </div>
                    {ocrResult.deepfakeIndicators && ocrResult.deepfakeIndicators.length > 0 && (
                      <div className="text-xs opacity-80">
                        Indicators: {ocrResult.deepfakeIndicators.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setUploadPhase("select")}>Re-upload</Button>
                <Button className="flex-1" onClick={handleConfirmFields} disabled={ocrResult.sanctionsHit}>
                  <CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirm &amp; Submit
                </Button>
              </div>
            </div>
          )}

          {uploadPhase === "done" && (
            <div className="py-8 text-center space-y-3">
              <CheckCircle2 className="h-14 w-14 text-emerald-600 mx-auto" />
              <p className="font-semibold text-emerald-700">Verification submitted!</p>
              <p className="text-sm text-muted-foreground">Your document is under review. You'll be notified once approved.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
