import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  FileText, Send, CheckCircle, Clock, AlertCircle, Eye, Upload,
  PenTool, Shield, Download, RefreshCw, Plus, Search, Filter,
  ChevronRight, Hash, Calendar, User, Building2, Mail
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-yellow-100 text-yellow-700",
  digitally_signed: "bg-purple-100 text-purple-700",
  physically_signed: "bg-orange-100 text-orange-700",
  fully_executed: "bg-green-100 text-green-700",
  expired: "bg-red-100 text-red-700",
  terminated: "bg-red-100 text-red-700",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  draft: <FileText className="w-3 h-3" />,
  sent: <Send className="w-3 h-3" />,
  viewed: <Eye className="w-3 h-3" />,
  digitally_signed: <PenTool className="w-3 h-3" />,
  physically_signed: <Upload className="w-3 h-3" />,
  fully_executed: <CheckCircle className="w-3 h-3" />,
  expired: <AlertCircle className="w-3 h-3" />,
};

export default function AdminDigitalAgreements() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSign, setShowSign] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [createForm, setCreateForm] = useState({
    revenueShareAgreementId: "",
    partnerName: "",
    partnerEmail: "",
    partnerTitle: "",
    partnerCompany: "",
    expiresInDays: "30",
  });
  const [signForm, setSignForm] = useState({ signerName: "RemitFlow CEO" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const { data: stats } = trpc.digitalAgreements.stats.useQuery();
  const { data: list, refetch } = trpc.digitalAgreements.listAll.useQuery({
    page,
    limit: 20,
    status: (statusFilter && statusFilter !== "all") ? statusFilter : undefined,
  });
  const { data: detail } = trpc.digitalAgreements.getById.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );
  const { data: auditTrail } = trpc.digitalAgreements.getAuditTrail.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );

  const createMutation = trpc.digitalAgreements.create.useMutation({
    onSuccess: () => { toast.success("Agreement created"); setShowCreate(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const sendMutation = trpc.digitalAgreements.send.useMutation({
    onSuccess: () => { toast.success("Agreement sent to partner"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const platformSignMutation = trpc.digitalAgreements.platformSign.useMutation({
    onSuccess: () => { toast.success("Agreement countersigned by platform"); setShowSign(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const uploadMutation = trpc.digitalAgreements.uploadPhysicalDocument.useMutation({
    onSuccess: () => { toast.success("Physical document uploaded"); setShowUpload(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = list?.items.filter(a =>
    !search || a.partnerName.toLowerCase().includes(search.toLowerCase()) ||
    a.partnerEmail.toLowerCase().includes(search.toLowerCase()) ||
    a.partnerCompany?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleUpload = async () => {
    if (!uploadFile || !selectedId) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      uploadMutation.mutate({
        id: selectedId,
        fileBase64: base64,
        fileName: uploadFile.name,
        mimeType: uploadFile.type as any,
      });
    };
    reader.readAsDataURL(uploadFile);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Digital Agreements</h1>
            <p className="text-muted-foreground text-sm mt-1">Revenue share partnership agreements with e-signature and document management</p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> New Agreement
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { label: "Total", value: stats.total, color: "text-foreground" },
              { label: "Draft", value: stats.draft, color: "text-gray-600" },
              { label: "Sent", value: stats.sent, color: "text-blue-600" },
              { label: "Signed", value: stats.signed, color: "text-purple-600" },
              { label: "Executed", value: stats.executed, color: "text-green-600" },
              { label: "Expired", value: stats.expired, color: "text-red-600" },
            ].map(s => (
              <Card key={s.label} className="p-3">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agreement List */}
          <div className="lg:col-span-1 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search partners..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {Object.keys(STATUS_COLORS).map(s => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filtered.map(agreement => (
                <Card
                  key={agreement.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${selectedId === agreement.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedId(agreement.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{agreement.partnerName}</div>
                        <div className="text-xs text-muted-foreground truncate">{agreement.partnerCompany || agreement.partnerEmail}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(agreement.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Badge className={`text-xs shrink-0 gap-1 ${STATUS_COLORS[agreement.status]}`}>
                        {STATUS_ICONS[agreement.status]}
                        {agreement.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filtered.length === 0 && (
                <div className="text-center text-muted-foreground py-8 text-sm">No agreements found</div>
              )}
            </div>

            {list && list.total > 20 && (
              <div className="flex justify-between items-center text-sm">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
                <span className="text-muted-foreground">{page} / {Math.ceil(list.total / 20)}</span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(list.total / 20)}>Next</Button>
              </div>
            )}
          </div>

          {/* Agreement Detail */}
          <div className="lg:col-span-2">
            {selectedId && detail ? (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{detail.partnerName}</CardTitle>
                      <CardDescription>{detail.partnerCompany} · {detail.partnerEmail}</CardDescription>
                    </div>
                    <Badge className={`gap-1 ${STATUS_COLORS[detail.status]}`}>
                      {STATUS_ICONS[detail.status]}
                      {detail.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="overview">
                    <TabsList className="w-full">
                      <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
                      <TabsTrigger value="agreement" className="flex-1">Agreement Text</TabsTrigger>
                      <TabsTrigger value="signatures" className="flex-1">Signatures</TabsTrigger>
                      <TabsTrigger value="audit" className="flex-1">Audit Trail</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4 mt-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          <div className="text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" /> Partner</div>
                          <div className="font-medium">{detail.partnerName}</div>
                          {detail.partnerTitle && <div className="text-muted-foreground">{detail.partnerTitle}</div>}
                        </div>
                        <div className="space-y-1">
                          <div className="text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" /> Company</div>
                          <div className="font-medium">{detail.partnerCompany || "—"}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" /> Email</div>
                          <div className="font-medium">{detail.partnerEmail}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Expires</div>
                          <div className="font-medium">{detail.expiresAt ? new Date(detail.expiresAt).toLocaleDateString() : "No expiry"}</div>
                        </div>
                        {detail.partnerIpAddress && (
                          <div className="space-y-1">
                            <div className="text-muted-foreground flex items-center gap-1"><Shield className="w-3 h-3" /> Signed from IP</div>
                            <div className="font-medium font-mono text-xs">{detail.partnerIpAddress}</div>
                          </div>
                        )}
                        {detail.digitallySignedAt && (
                          <div className="space-y-1">
                            <div className="text-muted-foreground flex items-center gap-1"><PenTool className="w-3 h-3" /> Digitally Signed</div>
                            <div className="font-medium">{new Date(detail.digitallySignedAt).toLocaleString()}</div>
                          </div>
                        )}
                      </div>

                      {/* Documents */}
                      {(detail.signedDocumentUrl || detail.physicalDocumentUrl) && (
                        <div className="border rounded-lg p-3 space-y-2">
                          <div className="text-sm font-medium">Documents</div>
                          {detail.physicalDocumentUrl && (
                            <a href={detail.physicalDocumentUrl} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-primary hover:underline">
                              <Download className="w-4 h-4" /> Physical Signed Document
                            </a>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2 pt-2">
                        {detail.status === "draft" && (
                          <Button size="sm" onClick={() => sendMutation.mutate({ id: detail.id })} disabled={sendMutation.isPending} className="gap-1">
                            <Send className="w-3 h-3" /> Send to Partner
                          </Button>
                        )}
                        {["digitally_signed", "physically_signed"].includes(detail.status) && !detail.platformSignedAt && (
                          <Button size="sm" onClick={() => setShowSign(true)} className="gap-1 bg-green-600 hover:bg-green-700">
                            <CheckCircle className="w-3 h-3" /> Platform Countersign
                          </Button>
                        )}
                        {["sent", "viewed", "digitally_signed"].includes(detail.status) && (
                          <Button size="sm" variant="outline" onClick={() => setShowUpload(true)} className="gap-1">
                            <Upload className="w-3 h-3" /> Upload Physical Doc
                          </Button>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="agreement" className="mt-4">
                      <div className="bg-muted/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">{detail.agreementText}</pre>
                      </div>
                    </TabsContent>

                    <TabsContent value="signatures" className="mt-4 space-y-3">
                      {detail.signatures?.length === 0 ? (
                        <div className="text-center text-muted-foreground py-6 text-sm">No signatures yet</div>
                      ) : (
                        detail.signatures?.map(sig => (
                          <div key={sig.id} className="border rounded-lg p-3 space-y-1 text-sm">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{sig.signerName}</div>
                              <Badge variant="outline" className="text-xs">{sig.signerType}</Badge>
                            </div>
                            <div className="text-muted-foreground">{sig.signerEmail} · {sig.signerTitle}</div>
                            <div className="text-muted-foreground">{new Date(sig.signedAt).toLocaleString()}</div>
                            {sig.verificationHash && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                                <Hash className="w-3 h-3" /> {sig.verificationHash.slice(0, 32)}...
                              </div>
                            )}
                            {sig.ipAddress && (
                              <div className="text-xs text-muted-foreground">IP: {sig.ipAddress}</div>
                            )}
                          </div>
                        ))
                      )}
                    </TabsContent>

                    <TabsContent value="audit" className="mt-4">
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {auditTrail?.auditTrail?.map((entry, i) => (
                          <div key={i} className="flex gap-3 text-sm">
                            <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                            <div>
                              <div className="font-medium capitalize">{entry.event.replace(/_/g, " ")}</div>
                              <div className="text-muted-foreground text-xs">{new Date(entry.timestamp).toLocaleString()}</div>
                              {entry.details && <div className="text-xs text-muted-foreground">{entry.details}</div>}
                              {entry.ipAddress && <div className="text-xs font-mono text-muted-foreground">IP: {entry.ipAddress}</div>}
                            </div>
                          </div>
                        ))}
                        {(!auditTrail?.auditTrail || auditTrail.auditTrail.length === 0) && (
                          <div className="text-center text-muted-foreground py-4 text-sm">No audit events</div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm border rounded-lg border-dashed">
                Select an agreement to view details
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Agreement Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Revenue Share Agreement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Revenue Share Agreement ID</Label>
                <Input
                  type="number"
                  placeholder="e.g. 1"
                  value={createForm.revenueShareAgreementId}
                  onChange={e => setCreateForm(f => ({ ...f, revenueShareAgreementId: e.target.value }))}
                />
              </div>
              <div>
                <Label>Partner Full Name *</Label>
                <Input value={createForm.partnerName} onChange={e => setCreateForm(f => ({ ...f, partnerName: e.target.value }))} placeholder="John Smith" />
              </div>
              <div>
                <Label>Partner Email *</Label>
                <Input type="email" value={createForm.partnerEmail} onChange={e => setCreateForm(f => ({ ...f, partnerEmail: e.target.value }))} placeholder="john@company.com" />
              </div>
              <div>
                <Label>Title / Role</Label>
                <Input value={createForm.partnerTitle} onChange={e => setCreateForm(f => ({ ...f, partnerTitle: e.target.value }))} placeholder="CEO" />
              </div>
              <div>
                <Label>Company Name</Label>
                <Input value={createForm.partnerCompany} onChange={e => setCreateForm(f => ({ ...f, partnerCompany: e.target.value }))} placeholder="Acme Corp" />
              </div>
              <div>
                <Label>Expires In (days)</Label>
                <Input type="number" value={createForm.expiresInDays} onChange={e => setCreateForm(f => ({ ...f, expiresInDays: e.target.value }))} />
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              The default platform-favorable agreement template will be used (70/30 platform/partner split, English law, ICC arbitration). You can customize the template in Settings.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                revenueShareAgreementId: parseInt(createForm.revenueShareAgreementId),
                partnerName: createForm.partnerName,
                partnerEmail: createForm.partnerEmail,
                partnerTitle: createForm.partnerTitle || undefined,
                partnerCompany: createForm.partnerCompany || undefined,
                expiresInDays: parseInt(createForm.expiresInDays) || 30,
              })}
              disabled={createMutation.isPending || !createForm.partnerName || !createForm.partnerEmail || !createForm.revenueShareAgreementId}
            >
              {createMutation.isPending ? "Creating..." : "Create Agreement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Platform Sign Dialog */}
      <Dialog open={showSign} onOpenChange={setShowSign}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Platform Countersignature</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              By countersigning, RemitFlow Technologies Ltd formally accepts this revenue share agreement. This action is irreversible and creates a legally binding contract.
            </div>
            <div>
              <Label>Platform Signatory Name</Label>
              <Input value={signForm.signerName} onChange={e => setSignForm({ signerName: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSign(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => selectedId && platformSignMutation.mutate({ id: selectedId, signerName: signForm.signerName })}
              disabled={platformSignMutation.isPending}
            >
              {platformSignMutation.isPending ? "Signing..." : "Countersign Agreement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Physical Document Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Physical Signed Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Upload the physically signed agreement document (PDF, JPG, or PNG, max 10MB).</p>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                id="physical-doc-upload"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
              />
              <label htmlFor="physical-doc-upload" className="cursor-pointer text-sm text-primary hover:underline">
                {uploadFile ? uploadFile.name : "Click to select file"}
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploadMutation.isPending}>
              {uploadMutation.isPending ? "Uploading..." : "Upload Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
