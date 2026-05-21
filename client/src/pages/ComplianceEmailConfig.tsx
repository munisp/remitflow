import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Mail, Send, Settings, CheckCircle2, AlertCircle, Plus, Trash2, TestTube } from "lucide-react";
import { useTranslation } from 'react-i18next';

const REPORT_TYPES = [
  { key: "CTR", label: "Currency Transaction Report (CTR)", threshold: "$10,000+", agency: "FinCEN" },
  { key: "SAR", label: "Suspicious Activity Report (SAR)", threshold: "Triggered by risk", agency: "FinCEN" },
  { key: "FBAR", label: "Foreign Bank Account Report (FBAR)", threshold: "$10,000+ aggregate", agency: "FinCEN" },
  { key: "OFAC", label: "OFAC Sanctions Hit Report", threshold: "Any hit", agency: "OFAC" },
];

export default function ComplianceEmailConfig() {
  const { t } = useTranslation();
  const [showAddConfig, setShowAddConfig] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testReportType, setTestReportType] = useState("CTR");
  const [form, setForm] = useState({
    recipientEmail: "",
    recipientName: "",
    reportTypes: [] as string[],
    frequency: "immediate" as "immediate" | "daily_digest" | "weekly_digest",
    includeAttachment: true,
    encryptAttachment: false,
  });

  const utils = trpc.useUtils();

  const { data: configs = [], isLoading } = trpc.complianceEmail.listConfigs.useQuery();
  const { data: emailLog = [] } = trpc.complianceEmail.getDeliveryLog.useQuery({ limit: 20 });

  const createConfig = trpc.complianceEmail.createConfig.useMutation({
    onSuccess: () => {
      toast.success("Email configuration saved");
      setShowAddConfig(false);
      setForm({ recipientEmail: "", recipientName: "", reportTypes: [], frequency: "immediate", includeAttachment: true, encryptAttachment: false });
      utils.complianceEmail.listConfigs.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteConfig = trpc.complianceEmail.deleteConfig.useMutation({
    onSuccess: () => { toast.success("Configuration deleted"); utils.complianceEmail.listConfigs.invalidate(); },
  });

  const sendTest = trpc.complianceEmail.sendTestEmail.useMutation({
    onSuccess: (data) => {
      toast.success(`Test email sent to ${data.sentTo}`);
      setShowTestDialog(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleReportType = (type: string) => {
    setForm(prev => ({
      ...prev,
      reportTypes: prev.reportTypes.includes(type)
        ? prev.reportTypes.filter(t => t !== type)
        : [...prev.reportTypes, type],
    }));
  };

  const STATUS_COLOR: Record<string, string> = {
    sent: "bg-green-500/20 text-green-300",
    failed: "bg-red-500/20 text-red-300",
    pending: "bg-amber-500/20 text-amber-300",
    bounced: "bg-red-500/20 text-red-300",
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Compliance Email Delivery</h1>
            <p className="text-muted-foreground">Configure automated delivery of regulatory reports to compliance officers</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowTestDialog(true)}>
              <TestTube className="w-4 h-4 mr-2" /> Send Test
            </Button>
            <Button onClick={() => setShowAddConfig(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Recipient
            </Button>
          </div>
        </div>

        {/* Report Types Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {REPORT_TYPES.map(({ key, label, threshold, agency }) => (
            <Card key={key} className="bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className="font-mono">{key}</Badge>
                  <Badge className="bg-blue-500/20 text-blue-300 text-xs">{agency}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-xs font-medium text-amber-400">{threshold}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Email Configurations */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings className="w-4 h-4 text-violet-400" />
              Email Recipients ({(configs as any[]).length})
            </h3>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : (configs as any[]).length === 0 ? (
              <Card className="text-center py-12">
                <Mail className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground text-sm">No email recipients configured</p>
                <p className="text-xs text-muted-foreground mt-1">Add a compliance officer to receive automated reports</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {(configs as any[]).map((config: any) => (
                  <Card key={config.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Mail className="w-3 h-3 text-muted-foreground" />
                            <p className="font-medium text-sm">{config.recipient_name}</p>
                            <Badge className={config.is_active ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-300"}>
                              {config.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{config.recipient_email}</p>
                          <div className="flex flex-wrap gap-1 mb-1">
                            {(config.report_types as string[]).map((t: string) => (
                              <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Frequency: {config.frequency?.replace("_", " ")} ·
                            {config.include_attachment ? " With PDF attachment" : " No attachment"}
                          </p>
                        </div>
                        <Button size="sm" variant="destructive" onClick={() => deleteConfig.mutate({ configId: config.id })}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Delivery Log */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Send className="w-4 h-4 text-blue-400" />
              Recent Deliveries
            </h3>

            {(emailLog as any[]).length === 0 ? (
              <Card className="text-center py-12">
                <Send className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground text-sm">No emails sent yet</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {(emailLog as any[]).map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card/30">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${log.status === "sent" ? "bg-green-400" : log.status === "failed" ? "bg-red-400" : "bg-amber-400"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{log.report_type} Report</p>
                        <Badge className={`text-xs ${STATUS_COLOR[log.status] ?? "bg-gray-500/20 text-gray-300"}`}>
                          {log.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{log.recipient_email}</p>
                      <p className="text-xs text-muted-foreground">{new Date(log.sent_at).toLocaleString()}</p>
                      {log.error_message && <p className="text-xs text-red-400 mt-0.5">{log.error_message}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Integration Info */}
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-blue-400" />
              Email Integration
            </CardTitle>
            <CardDescription>How compliance report emails are delivered</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="font-medium mb-1">Trigger Events</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  <li>• CTR: Transaction ≥ $10,000</li>
                  <li>• SAR: Risk score ≥ 80</li>
                  <li>• FBAR: Annual aggregate ≥ $10,000</li>
                  <li>• OFAC: Sanctions match detected</li>
                </ul>
              </div>
              <div>
                <p className="font-medium mb-1">Email Contents</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  <li>• Report summary and key fields</li>
                  <li>• PDF attachment (optional)</li>
                  <li>• Direct link to platform</li>
                  <li>• Filing deadline reminder</li>
                </ul>
              </div>
              <div>
                <p className="font-medium mb-1">Delivery SLA</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  <li>• Immediate: Within 5 minutes</li>
                  <li>• Daily digest: 8:00 AM UTC</li>
                  <li>• Weekly digest: Monday 8:00 AM</li>
                  <li>• Retry on failure: 3 attempts</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Config Dialog */}
      <Dialog open={showAddConfig} onOpenChange={setShowAddConfig}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Email Recipient</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Recipient Name *</Label>
                <Input className="mt-1" placeholder="Jane Smith" value={form.recipientName} onChange={e => setForm(f => ({ ...f, recipientName: e.target.value }))} />
              </div>
              <div>
                <Label>Email Address *</Label>
                <Input type="email" className="mt-1" placeholder="compliance@company.com" value={form.recipientEmail} onChange={e => setForm(f => ({ ...f, recipientEmail: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Report Types *</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {REPORT_TYPES.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:border-primary/50" onClick={() => toggleReportType(key)}>
                    <Checkbox checked={form.reportTypes.includes(key)} onCheckedChange={() => toggleReportType(key)} />
                    <span className="text-sm">{key}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Delivery Frequency</Label>
              <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v as any }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="immediate">Immediate (as reports are generated)</SelectItem>
                  <SelectItem value="daily_digest">Daily Digest (8 AM UTC)</SelectItem>
                  <SelectItem value="weekly_digest">Weekly Digest (Monday 8 AM)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox checked={form.includeAttachment} onCheckedChange={v => setForm(f => ({ ...f, includeAttachment: !!v }))} />
                <Label>Include PDF attachment</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.encryptAttachment} onCheckedChange={v => setForm(f => ({ ...f, encryptAttachment: !!v }))} />
                <Label>Encrypt attachment (password protected)</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddConfig(false)}>Cancel</Button>
            <Button
              onClick={() => createConfig.mutate(form)}
              disabled={!form.recipientEmail || !form.recipientName || form.reportTypes.length === 0 || createConfig.isPending}
            >
              {createConfig.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Email Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Test Email</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Send a test email to verify your configuration is working correctly.</p>
            <div>
              <Label>Report Type</Label>
              <Select value={testReportType} onValueChange={setTestReportType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(({ key, label }) => (
                    <SelectItem key={key} value={key}>{key} — {label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3">
              <p className="text-amber-300 text-sm">This will send a test email to all active recipients configured for this report type.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestDialog(false)}>Cancel</Button>
            <Button onClick={() => sendTest.mutate({ reportType: testReportType })} disabled={sendTest.isPending}>
              <Send className="w-4 h-4 mr-2" />
              {sendTest.isPending ? "Sending..." : "Send Test Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
