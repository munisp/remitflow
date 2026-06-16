import { toast } from 'sonner';
import { useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Vault, Upload, FileText, Share2, Archive, Trash2, Calendar, Shield,
  Search, Filter, Bell, Clock, AlertTriangle, AlertCircle,
  CheckCircle, History,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useTranslation } from 'react-i18next';

const categoryColor: Record<string, string> = {
  identity:   "bg-blue-100 text-blue-700",
  address:    "bg-green-100 text-green-700",
  financial:  "bg-purple-100 text-purple-700",
  compliance: "bg-red-100 text-red-700",
  contract:   "bg-orange-100 text-orange-700",
  other:      "bg-gray-100 text-gray-700",
};
const statusColor: Record<string, string> = {
  active:   "bg-green-100 text-green-700",
  expired:  "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-700",
  shared:   "bg-blue-100 text-blue-700",
};

function getExpiryUrgency(expiresAt: Date | string | null | undefined) {
  if (!expiresAt) return { label: "", color: "", bgColor: "", borderColor: "", icon: null as React.ReactNode, daysLeft: null as number | null };
  const daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0)  return { label: "Expired",              color: "text-red-700",    bgColor: "bg-red-50",    borderColor: "border-red-200",    icon: <AlertCircle className="w-4 h-4 text-red-600" />,    daysLeft };
  if (daysLeft <= 3)  return { label: `${daysLeft}d left`,    color: "text-red-600",    bgColor: "bg-red-50",    borderColor: "border-red-200",    icon: <AlertCircle className="w-4 h-4 text-red-500" />,    daysLeft };
  if (daysLeft <= 7)  return { label: `${daysLeft}d left`,    color: "text-orange-600", bgColor: "bg-orange-50", borderColor: "border-orange-200", icon: <AlertTriangle className="w-4 h-4 text-orange-500" />, daysLeft };
  if (daysLeft <= 14) return { label: `${daysLeft}d left`,    color: "text-yellow-600", bgColor: "bg-yellow-50", borderColor: "border-yellow-200", icon: <Clock className="w-4 h-4 text-yellow-500" />,       daysLeft };
  if (daysLeft <= 30) return { label: `${daysLeft}d left`,    color: "text-blue-600",   bgColor: "bg-blue-50",   borderColor: "border-blue-200",   icon: <Clock className="w-4 h-4 text-blue-500" />,           daysLeft };
  return { label: format(new Date(expiresAt), "MMM d, yyyy"), color: "text-muted-foreground", bgColor: "", borderColor: "", icon: <Calendar className="w-3 h-3" />, daysLeft };
}

export default function DocumentVaultPage() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState<number | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [uploadForm, setUploadForm] = useState({
    name: "", description: "", category: "other" as const,
    expiresAt: "", tags: "",
    fileBase64: "", mimeType: "", fileName: "",
  });
  const [shareEmail, setShareEmail] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data, isLoading } = trpc.documentVaultV94.list.useQuery();
  const { data: expiringData } = trpc.documentVaultV94.expiringDocuments.useQuery({ daysAhead: 30 });
  const { data: prefsData, isLoading: prefsLoading } = trpc.documentVaultV94.getReminderPrefs.useQuery();
  const { data: reminderLogData } = trpc.documentVaultV94.reminderLog.useQuery({ limit: 30 });

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const uploadMutation = trpc.documentVaultV94.upload.useMutation({
    onSuccess: () => {
      toast.success("Document uploaded successfully");
      utils.documentVaultV94.list.invalidate();
      utils.documentVaultV94.expiringDocuments.invalidate();
      setUploadOpen(false);
      setUploadForm({ name: "", description: "", category: "other", expiresAt: "", tags: "", fileBase64: "", mimeType: "", fileName: "" });
    },
    onError: (e) => toast.error("Upload failed"),
  });
  const shareMutation = trpc.documentVaultV94.share.useMutation({
    onSuccess: () => {
      toast.success("Document shared");
      utils.documentVaultV94.list.invalidate();
      setShareOpen(null);
      setShareEmail("");
    },
  });
  const archiveMutation = trpc.documentVaultV94.archive.useMutation({
    onSuccess: () => { toast.success("Document archived"); utils.documentVaultV94.list.invalidate(); },
  });
  const deleteMutation = trpc.documentVaultV94.delete.useMutation({
    onSuccess: () => { toast.success("Document deleted"); utils.documentVaultV94.list.invalidate(); utils.documentVaultV94.expiringDocuments.invalidate(); },
  });
  const updatePrefsMutation = trpc.documentVaultV94.updateReminderPrefs.useMutation({
    onSuccess: () => {
      toast.success("Reminder preferences saved");
      utils.documentVaultV94.getReminderPrefs.invalidate();
    },
    onError: (e) => toast.error("Failed to save preferences"),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setUploadForm(f => ({ ...f, fileBase64: base64, mimeType: file.type, fileName: file.name, name: f.name || file.name }));
    };
    reader.readAsDataURL(file);
  };

  const docs = data?.documents ?? [];
  const expiringSoon = docs.filter((d: any) => {
    if (!d.expiresAt) return false;
    const daysLeft = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return daysLeft <= 30;
  });
  const filtered = docs.filter((d: any) => {
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === "all" || d.category === categoryFilter;
    return matchSearch && matchCategory;
  });
  const reminderLogs = reminderLogData?.logs ?? [];
  const criticalDocs = expiringSoon.filter((d: any) => {
    const daysLeft = Math.ceil((new Date(d.expiresAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return daysLeft <= 7;
  });
  const stats = {
    total: docs.length,
    active: docs.filter((d: any) => d.status === "active").length,
    expiringSoon: expiringSoon.length,
    expired: docs.filter((d: any) => d.expiresAt && new Date(d.expiresAt) < new Date()).length,
    shared: docs.filter((d: any) => d.status === "shared").length,
  };
  const prefs = (prefsData as any) ?? {
    remind30d: true, remind14d: true, remind7d: true, remind3d: true, remind1d: true,
    notifyEmail: true, notifyInApp: true, notifyPush: false,
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Vault className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Document Vault</h1>
              <p className="text-sm text-muted-foreground">Secure storage with automated expiry reminders</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPrefsOpen(true)} className="gap-2">
              <Bell className="w-4 h-4" /> Reminder Settings
            </Button>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Upload className="w-4 h-4" /> Upload Document</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>File</Label>
                    <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/50" onClick={() => fileRef.current?.click()}>
                      {uploadForm.fileName
                        ? <p className="text-sm font-medium">{uploadForm.fileName}</p>
                        : <><Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" /><p className="text-sm text-muted-foreground">Click to select a file</p></>
                      }
                      <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                    </div>
                  </div>
                  <div>
                    <Label>Document Name</Label>
                    <Input value={uploadForm.name} onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Passport - John Doe" />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select value={uploadForm.category} onValueChange={v => setUploadForm(f => ({ ...f, category: v as any }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["identity", "address", "financial", "compliance", "contract", "other"].map(c => (
                          <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Expiry Date <span className="text-muted-foreground text-xs">(optional — enables reminders)</span></Label>
                    <Input type="date" value={uploadForm.expiresAt} onChange={e => setUploadForm(f => ({ ...f, expiresAt: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={uploadForm.description} onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))} rows={2} />
                  </div>
                  <div>
                    <Label>Tags <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
                    <Input value={uploadForm.tags} onChange={e => setUploadForm(f => ({ ...f, tags: e.target.value }))} placeholder="kyc, passport, 2024" />
                  </div>
                  <Button className="w-full" disabled={!uploadForm.fileBase64 || !uploadForm.name || uploadMutation.isPending}
                    onClick={() => uploadMutation.mutate({
                      ...uploadForm,
                      tags: uploadForm.tags ? uploadForm.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
                      expiresAt: uploadForm.expiresAt || undefined,
                    })}>
                    {uploadMutation.isPending ? "Uploading..." : "Upload Document"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* ── Critical Expiry Banner ──────────────────────────────────────────── */}
        {criticalDocs.length > 0 && (
          <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800 text-sm">
                  {criticalDocs.length} document{criticalDocs.length !== 1 ? "s" : ""} expiring within 7 days
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {criticalDocs.slice(0, 3).map((d: any) => {
                    const u = getExpiryUrgency(d.expiresAt);
                    return (
                      <span key={d.id} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                        {d.name} — {u.daysLeft !== null && u.daysLeft <= 0 ? "EXPIRED" : `${u.daysLeft}d left`}
                      </span>
                    );
                  })}
                  {criticalDocs.length > 3 && <span className="text-xs text-red-600">+{criticalDocs.length - 3} more</span>}
                </div>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 text-red-700 border-red-300 hover:bg-red-100"
                onClick={() => setActiveTab("expiring")}>
                View All
              </Button>
            </div>
          </div>
        )}

        {/* ── Stats ──────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total",         value: stats.total,        icon: <Vault className="w-4 h-4" />,        color: "text-indigo-600" },
            { label: "Active",        value: stats.active,       icon: <CheckCircle className="w-4 h-4" />,  color: "text-green-600" },
            { label: "Expiring Soon", value: stats.expiringSoon, icon: <Clock className="w-4 h-4" />,        color: "text-yellow-600" },
            { label: "Expired",       value: stats.expired,      icon: <AlertCircle className="w-4 h-4" />,  color: "text-red-600" },
            { label: "Shared",        value: stats.shared,       icon: <Share2 className="w-4 h-4" />,       color: "text-blue-600" },
          ].map(s => (
            <Card key={s.label} className="hover:shadow-sm transition-shadow">
              <CardContent className="pt-4 pb-3">
                <div className={`flex items-center gap-2 ${s.color} mb-1`}>{s.icon}<span className="text-xs font-medium">{s.label}</span></div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <TabsList>
              <TabsTrigger value="all">All Documents</TabsTrigger>
              <TabsTrigger value="expiring" className="gap-1">
                Expiring Soon
                {stats.expiringSoon > 0 && (
                  <span className="ml-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                    {stats.expiringSoon > 9 ? "9+" : stats.expiringSoon}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="history">Reminder History</TabsTrigger>
            </TabsList>

            {activeTab === "all" && (
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <Input placeholder="Search documents..." className="pl-9 w-48" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-40"><Filter className="w-4 h-4 mr-2" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {["identity", "address", "financial", "compliance", "contract", "other"].map(c => (
                      <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* All Documents */}
          <TabsContent value="all" className="mt-4">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading documents...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Vault className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No documents found. Upload your first document to get started.</p>
              </div>
            ) : (
              <DocumentGrid docs={filtered} onShare={setShareOpen} onArchive={id => archiveMutation.mutate({ documentId: id })} onDelete={id => deleteMutation.mutate({ documentId: id })} shareOpen={shareOpen} shareEmail={shareEmail} setShareEmail={setShareEmail} shareMutation={shareMutation} />
            )}
          </TabsContent>

          {/* Expiring Soon */}
          <TabsContent value="expiring" className="mt-4">
            {expiringSoon.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30 text-green-500" />
                <p className="font-medium">All documents are up to date!</p>
                <p className="text-sm mt-1">No documents expiring within the next 30 days.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{expiringSoon.length} document{expiringSoon.length !== 1 ? "s" : ""} expiring within 30 days</p>
                <DocumentGrid docs={expiringSoon} onShare={setShareOpen} onArchive={id => archiveMutation.mutate({ documentId: id })} onDelete={id => deleteMutation.mutate({ documentId: id })} shareOpen={shareOpen} shareEmail={shareEmail} setShareEmail={setShareEmail} shareMutation={shareMutation} highlightExpiry />
              </div>
            )}
          </TabsContent>

          {/* Reminder History */}
          <TabsContent value="history" className="mt-4">
            {reminderLogs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No reminders sent yet.</p>
                <p className="text-sm mt-1">Reminders are sent automatically based on your preferences.</p>
              </div>
            ) : (
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4" /> Reminder History</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {reminderLogs.map((log: any) => (
                      <div key={log.id} className="flex items-center gap-4 px-4 py-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${log.channel === "email" ? "bg-blue-100" : "bg-purple-100"}`}>
                          <Bell className={`w-4 h-4 ${log.channel === "email" ? "text-blue-600" : "text-purple-600"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{(log as any).docName ?? `Document #${log.documentId}`}</p>
                          <p className="text-xs text-muted-foreground capitalize">{(log as any).docCategory} · {log.reminderType} reminder · via {(log.channel as string).replace("_", " ")}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge variant="outline" className="text-xs capitalize">{log.status}</Badge>
                          <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(log.sentAt as any), { addSuffix: true })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* ── Reminder Preferences Dialog ─────────────────────────────────────── */}
        <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Reminder Preferences</DialogTitle>
            </DialogHeader>
            {prefsLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading preferences...</div>
            ) : (
              <ReminderPrefsPanel
                prefs={prefs}
                onSave={(updates) => updatePrefsMutation.mutate(updates)}
                isSaving={updatePrefsMutation.isPending}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// ─── Document Grid ─────────────────────────────────────────────────────────────
function DocumentGrid({ docs, onShare, onArchive, onDelete, shareOpen, shareEmail, setShareEmail, shareMutation, highlightExpiry = false }: {
  docs: any[];
  onShare: (id: number | null) => void;
  onArchive: (id: number) => void;
  onDelete: (id: number) => void;
  shareOpen: number | null;
  shareEmail: string;
  setShareEmail: (v: string) => void;
  shareMutation: any;
  highlightExpiry?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {docs.map(doc => {
        const urgency = getExpiryUrgency(doc.expiresAt);
        const showBorder = highlightExpiry && doc.expiresAt && urgency.daysLeft !== null && urgency.daysLeft <= 30;
        return (
          <Card key={doc.id} className={`hover:shadow-md transition-shadow ${showBorder ? `border-2 ${urgency.borderColor}` : ""}`}>
            {/* Urgency strip */}
            {highlightExpiry && doc.expiresAt && urgency.daysLeft !== null && urgency.daysLeft <= 7 && (
              <div className={`px-4 py-1.5 flex items-center gap-2 ${urgency.bgColor} border-b text-xs font-semibold ${urgency.color}`}>
                {urgency.icon}
                {urgency.daysLeft <= 0 ? "This document has expired" : `Expires in ${urgency.daysLeft} day${urgency.daysLeft !== 1 ? "s" : ""} — action required`}
              </div>
            )}
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">{doc.mimeType?.split("/")[1]?.toUpperCase() ?? "FILE"}</p>
                  </div>
                </div>
                <Badge className={`text-xs shrink-0 ${statusColor[doc.status]}`}>{doc.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                <Badge className={`text-xs ${categoryColor[doc.category]}`}>{doc.category}</Badge>
                {(doc.tags as string[]).slice(0, 2).map((t: string) => (
                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                ))}
              </div>
              {doc.expiresAt && (
                <div className={`text-xs mb-2 flex items-center gap-1.5 px-2 py-1 rounded-md ${urgency.daysLeft !== null && urgency.daysLeft <= 30 ? urgency.bgColor : ""} ${urgency.color}`}>
                  {urgency.icon}
                  <span>
                    {urgency.daysLeft !== null && urgency.daysLeft <= 0
                      ? `Expired ${formatDistanceToNow(new Date(doc.expiresAt), { addSuffix: true })}`
                      : `Expires ${format(new Date(doc.expiresAt), "MMM d, yyyy")}`}
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground mb-3">Uploaded {format(new Date(doc.createdAt), "MMM d, yyyy")}</p>
              <div className="flex gap-2">
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="text-xs gap-1"><FileText className="w-3 h-3" /> View</Button>
                </a>
                <Dialog open={shareOpen === doc.id} onOpenChange={o => onShare(o ? doc.id : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="text-xs gap-1"><Share2 className="w-3 h-3" /> Share</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Share Document</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">Share "{doc.name}" with a partner or colleague</p>
                      <Input placeholder="Email address" value={shareEmail} onChange={e => setShareEmail(e.target.value)} type="email" />
                      <Button className="w-full" disabled={!shareEmail || shareMutation.isPending}
                        onClick={() => shareMutation.mutate({ documentId: doc.id, shareWithEmail: shareEmail })}>
                        {shareMutation.isPending ? "Sharing..." : "Share Document"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                {doc.status !== "archived" && (
                  <Button size="sm" variant="ghost" className="text-xs ml-auto" onClick={() => onArchive(doc.id)}>
                    <Archive className="w-3 h-3" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-xs text-red-500 hover:text-red-600" onClick={() => onDelete(doc.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Reminder Preferences Panel ───────────────────────────────────────────────
function ReminderPrefsPanel({ prefs, onSave, isSaving }: {
  prefs: {
    remind30d: boolean; remind14d: boolean; remind7d: boolean; remind3d: boolean; remind1d: boolean;
    notifyEmail: boolean; notifyInApp: boolean; notifyPush: boolean;
  };
  onSave: (updates: Partial<typeof prefs>) => void;
  isSaving: boolean;
}) {
  const [local, setLocal] = useState({ ...prefs });
  const toggle = (key: keyof typeof local) => setLocal(p => ({ ...p, [key]: !p[key] }));

  const thresholds = [
    { key: "remind30d" as const, label: "30 days before expiry", desc: "Early heads-up to start renewal process" },
    { key: "remind14d" as const, label: "14 days before expiry", desc: "Two weeks to gather documents" },
    { key: "remind7d"  as const, label: "7 days before expiry",  desc: "One week — urgent reminder" },
    { key: "remind3d"  as const, label: "3 days before expiry",  desc: "Critical — immediate action needed" },
    { key: "remind1d"  as const, label: "1 day before expiry",   desc: "Final warning before expiry" },
  ];
  const channels = [
    { key: "notifyEmail"  as const, label: "Email notifications",  desc: "Receive reminders via email" },
    { key: "notifyInApp"  as const, label: "In-app notifications", desc: "Show alerts in the notification bell" },
    { key: "notifyPush"   as const, label: "Push notifications",   desc: "Browser push notifications (requires permission)" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Reminder Thresholds</h3>
        <p className="text-xs text-muted-foreground mb-3">Choose when to receive reminders before a document expires</p>
        <div className="space-y-2">
          {thresholds.map(t => (
            <div key={t.key} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </div>
              <Switch checked={local[t.key]} onCheckedChange={() => toggle(t.key)} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Notification Channels</h3>
        <p className="text-xs text-muted-foreground mb-3">Choose how you want to be notified</p>
        <div className="space-y-2">
          {channels.map(c => (
            <div key={c.key} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.desc}</p>
              </div>
              <Switch checked={local[c.key]} onCheckedChange={() => toggle(c.key)} />
            </div>
          ))}
        </div>
      </div>
      <Button className="w-full" onClick={() => onSave(local)} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Preferences"}
      </Button>
    </div>
  );
}
