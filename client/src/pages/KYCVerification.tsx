import { useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Upload, CheckCircle, Clock, XCircle, AlertTriangle, FileText, Camera } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const DOC_TYPES = [
  { value: "national_id", label: "National ID Card" },
  { value: "passport", label: "International Passport" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "proof_of_address", label: "Proof of Address" },
  { value: "bank_statement", label: "Bank Statement" },
  { value: "source_of_funds", label: "Source of Funds Declaration" },
];

const TIER_COLORS: Record<string, string> = {
  tier0: "text-muted-foreground",
  tier1: "text-blue-400",
  tier2: "text-yellow-400",
  tier3: "text-green-400",
};

export default function KYCVerification() {
  const { t } = useTranslation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [docType, setDocType] = useState("national_id");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: kycStatus, refetch } = trpc.kyc.status.useQuery();
  const uploadDoc = trpc.kyc.uploadDocument.useMutation({
    onSuccess: () => { toast.success("Document submitted for review"); setUploadOpen(false); setFile(null); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const status = kycStatus as any;
  const currentTier = status?.currentTier ?? "tier0";
  const tierNum = parseInt(currentTier.replace("tier", "")) || 0;
  const progress = (tierNum / 3) * 100;

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      try {
        await uploadDoc.mutateAsync({ type: docType, fileBase64: base64, fileName: file.name, mimeType: file.type });
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">KYC Verification</h1>
              <p className="text-muted-foreground text-sm">Verify your identity to unlock higher transfer limits</p>
            </div>
          </div>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />Upload Document
          </Button>
        </div>

        {/* Current Tier Banner */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm text-muted-foreground">Current Tier</div>
                <div className={`text-xl font-bold ${TIER_COLORS[currentTier]}`}>
                  {status?.tiers?.find((t: any) => t.id === currentTier)?.name ?? "Unverified"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Transfer Limit</div>
                <div className="text-xl font-bold">
                  ₦{(status?.tiers?.find((t: any) => t.id === currentTier)?.limit ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Tier 0</span><span>Tier 1</span><span>Tier 2</span><span>Tier 3</span>
            </div>
          </CardContent>
        </Card>

        {/* Tier Progression */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(status?.tiers ?? []).filter((t: any) => t.id !== "tier0").map((tier: any) => {
            const tNum = parseInt(tier.id.replace("tier", ""));
            const isComplete = tierNum >= tNum;
            const isCurrent = tierNum === tNum - 1;
            return (
              <Card key={tier.id} className={isComplete ? "border-green-500/30 bg-green-500/5" : isCurrent ? "border-primary/30" : "opacity-60"}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-sm">{tier.name}</div>
                    {isComplete
                      ? <CheckCircle className="h-4 w-4 text-green-400" />
                      : isCurrent
                        ? <AlertTriangle className="h-4 w-4 text-yellow-400" />
                        : <Clock className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">Limit: ₦{tier.limit?.toLocaleString()}</div>
                  <div className="space-y-1">
                    {(tier.requirements ?? []).map((req: string) => (
                      <div key={req} className="flex items-center gap-1.5 text-xs">
                        {isComplete
                          ? <CheckCircle className="h-3 w-3 text-green-400" />
                          : <div className="h-3 w-3 rounded-full border border-muted-foreground" />}
                        <span>{req}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Submitted Documents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />Submitted Documents
              <Badge variant="outline" className="ml-auto text-xs">{status?.documents?.length ?? 0} total</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(status?.documents ?? []).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Camera className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No documents submitted yet</p>
                <p className="text-xs mt-1">Upload a government ID to start verification</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(status?.documents ?? []).map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between p-3 border rounded-xl">
                    <div className="flex items-center gap-3">
                      {doc.status === "approved"
                        ? <CheckCircle className="h-4 w-4 text-green-400" />
                        : doc.status === "rejected"
                          ? <XCircle className="h-4 w-4 text-red-400" />
                          : <Clock className="h-4 w-4 text-yellow-400" />}
                      <div>
                        <div className="font-medium text-sm capitalize">{doc.docType?.replace(/_/g, " ")}</div>
                        <div className="text-xs text-muted-foreground">
                          {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : ""}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant={doc.status === "approved" ? "default" : doc.status === "rejected" ? "destructive" : "secondary"}
                      className="text-xs capitalize"
                    >
                      {doc.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-card/60"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-green-400">{status?.approvedCount ?? 0}</div><div className="text-xs text-muted-foreground">Approved</div></CardContent></Card>
          <Card className="bg-card/60"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-yellow-400">{status?.pendingCount ?? 0}</div><div className="text-xs text-muted-foreground">Pending</div></CardContent></Card>
          <Card className="bg-card/60"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{tierNum}</div><div className="text-xs text-muted-foreground">KYC Tier</div></CardContent></Card>
        </div>

        {/* Upload Dialog */}
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Upload KYC Document</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Document Type</Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>File</Label>
                <div
                  className="mt-1 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  {file ? (
                    <div className="text-sm font-medium">{file.name}</div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Click to upload or drag & drop</p>
                      <p className="text-xs text-muted-foreground mt-1">JPG, PNG, PDF up to 10MB</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setUploadOpen(false); setFile(null); }}>Cancel</Button>
              <Button onClick={handleUpload} disabled={!file || uploading || uploadDoc.isPending}>
                {uploading || uploadDoc.isPending ? "Uploading..." : "Submit Document"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
