import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderLock, Upload, AlertTriangle, CheckCircle, Trash2, FileText, Shield } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

const DOC_TYPES = [
  "passport", "national_id", "drivers_license", "utility_bill",
  "bank_statement", "proof_of_address", "tax_certificate", "company_registration", "other"
] as const;

type DocType = typeof DOC_TYPES[number];

export default function DocumentVault() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    docType: "passport" as DocType,
    filename: "",
    fileUrl: "",
    fileSize: 0,
    mimeType: "application/pdf",
    expiryDate: "",
  });

  const { data: docs, isLoading } = trpc.documentVault.list.useQuery();
  const { data: alerts } = trpc.documentVault.expiryAlerts.useQuery();

  const uploadMutation = trpc.documentVault.upload.useMutation({
    onSuccess: () => {
      utils.documentVault.list.invalidate();
      setOpen(false);
      toast.success("Document uploaded successfully");
      setForm({ docType: "passport", filename: "", fileUrl: "", fileSize: 0, mimeType: "application/pdf", expiryDate: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.documentVault.delete.useMutation({
    onSuccess: () => {
      utils.documentVault.list.invalidate();
      toast.success("Document removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const docIcon = (type: string) => {
    const icons: Record<string, string> = {
      passport: "🛂", national_id: "🪪", drivers_license: "🚗", utility_bill: "🏠",
      bank_statement: "🏦", proof_of_address: "📮", tax_certificate: "📋",
      company_registration: "🏢", other: "📄",
    };
    return icons[type] ?? "📄";
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderLock className="w-6 h-6 text-indigo-400" /> Document Vault
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Securely store and manage your identity and compliance documents</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Upload className="w-4 h-4 mr-2" /> Upload Document</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Document Type</Label>
                <Select value={form.docType} onValueChange={(v) => setForm(f => ({ ...f, docType: v as DocType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(t => (
                      <SelectItem key={t} value={t}>
                        {t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>File Name</Label>
                <Input
                  value={form.filename}
                  onChange={e => setForm(f => ({ ...f, filename: e.target.value }))}
                  placeholder="passport_2024.pdf"
                />
              </div>
              <div>
                <Label>File URL (S3)</Label>
                <Input
                  value={form.fileUrl}
                  onChange={e => setForm(f => ({ ...f, fileUrl: e.target.value }))}
                  placeholder="https://storage.remitflow.io/..."
                />
              </div>
              <div>
                <Label>Expiry Date (optional)</Label>
                <Input
                  type="date"
                  value={form.expiryDate}
                  onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => uploadMutation.mutate({ ...form, fileSize: 102400 })}
                disabled={!form.filename || !form.fileUrl || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {(alerts ?? []).length > 0 && (
        <Card className="bg-yellow-500/10 border-yellow-500/30">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-300">Documents expiring soon</p>
                <ul className="mt-1 space-y-1">
                  {(alerts ?? []).map((a: any) => (
                    <li key={a.id} className="text-xs text-yellow-400/80">
                      {String(a.doc_type ?? "").replace(/_/g, " ")} — expires {new Date(a.expiry_date).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 flex items-center gap-3">
            <FileText className="w-8 h-8 text-indigo-400" />
            <div>
              <p className="text-xs text-muted-foreground">Total Documents</p>
              <p className="text-2xl font-bold text-foreground">{(docs ?? []).length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-400" />
            <div>
              <p className="text-xs text-muted-foreground">Verified</p>
              <p className="text-2xl font-bold text-foreground">{(docs ?? []).filter((d: any) => d.is_verified).length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-yellow-400" />
            <div>
              <p className="text-xs text-muted-foreground">Expiring Soon</p>
              <p className="text-2xl font-bold text-foreground">{(alerts ?? []).length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" /> Your Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (docs ?? []).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FolderLock className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No documents uploaded yet</p>
              <p className="text-sm mt-1">Upload your identity and compliance documents to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(docs ?? []).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between p-4 rounded-lg border border-border bg-muted/10">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{docIcon(d.doc_type ?? d.docType)}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{d.filename}</p>
                        {d.is_verified && <Badge className="text-xs bg-green-500/20 text-green-400">Verified</Badge>}
                        {d.expiry_date && new Date(d.expiry_date) < new Date(Date.now() + 86400000 * 90) && (
                          <Badge className="text-xs bg-yellow-500/20 text-yellow-400">Expiring</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {String(d.doc_type ?? "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        {d.expiry_date && ` · Expires ${new Date(d.expiry_date).toLocaleDateString()}`}
                        {d.uploaded_at && ` · Uploaded ${new Date(d.uploaded_at).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => deleteMutation.mutate({ docId: d.id })}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
