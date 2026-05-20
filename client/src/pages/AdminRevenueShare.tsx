import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import {  DollarSign, TrendingUp, Users, FileText, Plus, Check, X, Edit, Trash2,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle, Clock, Download
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-300",
  active: "bg-green-500/20 text-green-300",
  suspended: "bg-yellow-500/20 text-yellow-300",
  terminated: "bg-red-500/20 text-red-300",
};

const reportStatusColors: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-300",
  paid: "bg-green-500/20 text-green-300",
  disputed: "bg-red-500/20 text-red-300",
};

export default function AdminRevenueShare() {
  const [tab, setTab] = useState("agreements");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<number | null>(null);
  const [reportYear, setReportYear] = useState(new Date().getFullYear());

  // Queries
  const { data: agreements, refetch: refetchAgreements } = trpc.revenueShare.listAgreements.useQuery({ status: "all" });
  const { data: analytics } = trpc.revenueShare.adminAnalytics.useQuery({ periodYear: reportYear });
  const { data: reports, refetch: refetchReports } = trpc.revenueShare.listReports.useQuery({ status: "all" });
  const { data: tenantsList } = trpc.tenants.list.useQuery({ limit: 100, offset: 0 });

  // Mutations
  const createAgreement = trpc.revenueShare.createAgreement.useMutation({
    onSuccess: () => { toast.success("Agreement created"); refetchAgreements(); setShowCreate(false); },
    onError: (e) => toast.error(`Error: ${String(e.message)}`),
  });
  const approveAgreement = trpc.revenueShare.approveAgreement.useMutation({
    onSuccess: () => { toast.success("Agreement approved and activated"); refetchAgreements(); },
  });
  const terminateAgreement = trpc.revenueShare.terminateAgreement.useMutation({
    onSuccess: () => { toast.success("Agreement terminated"); refetchAgreements(); },
  });
  const markPaid = trpc.revenueShare.markReportPaid.useMutation({
    onSuccess: () => { toast.success("Report marked as paid"); refetchReports(); },
  });

  // Create form state
  const [form, setForm] = useState({
    tenantId: 0, name: "", model: "percentage" as const, baseRate: 0.3,
    payoutFrequency: "monthly", payoutMethod: "bank_transfer" as const,
    minPayoutThreshold: 50, payoutCurrency: "USD", notes: "",
    bankName: "", bankAccountNumber: "", bankSwiftCode: "", paypalEmail: "",
  });

  const handleCreate = () => {
    if (!form.tenantId || !form.name) {
      toast.error("Tenant and name are required"); return;
    }
    createAgreement.mutate(form);
  };

  const exportReports = () => {
    if (!reports?.reports) return;
    const csv = [
      ["Tenant", "Period", "Volume", "Fee Revenue", "Partner Earnings", "Platform Earnings", "Status"],
      ...reports.reports.map(r => [
        r.tenantName || r.tenantId,
        `${MONTH_NAMES[(r.periodMonth || 1) - 1]} ${r.periodYear}`,
        r.totalVolume, r.totalFeeRevenue, r.partnerEarnings, r.platformEarnings, r.status,
      ])
    ].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `rev-share-reports-${reportYear}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Revenue Share Administration</h1>
          <p className="text-gray-400 text-sm mt-1">Manage partner agreements, tiers, and payout reporting</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-violet-600 hover:bg-violet-700">
          <Plus className="w-4 h-4 mr-2" /> New Agreement
        </Button>
      </div>

      {/* Summary Cards */}
      {analytics?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-500/20 rounded-lg"><DollarSign className="w-5 h-5 text-violet-400" /></div>
                <div>
                  <p className="text-gray-400 text-xs">Total Partner Paid</p>
                  <p className="text-white font-bold text-lg">${analytics.summary.totalPartnerPaid.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/20 rounded-lg"><TrendingUp className="w-5 h-5 text-cyan-400" /></div>
                <div>
                  <p className="text-gray-400 text-xs">Platform Revenue</p>
                  <p className="text-white font-bold text-lg">${analytics.summary.totalPlatformKept.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg"><Users className="w-5 h-5 text-green-400" /></div>
                <div>
                  <p className="text-gray-400 text-xs">Active Partners</p>
                  <p className="text-white font-bold text-lg">{analytics.summary.activeAgreements}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg"><FileText className="w-5 h-5 text-amber-400" /></div>
                <div>
                  <p className="text-gray-400 text-xs">Avg Partner Rate</p>
                  <p className="text-white font-bold text-lg">{analytics.summary.avgPartnerRate}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-gray-900 border border-gray-800">
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
          <TabsTrigger value="reports">Payout Reports</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* ── Agreements Tab ── */}
        <TabsContent value="agreements" className="mt-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead className="text-gray-400">Partner / Tenant</TableHead>
                    <TableHead className="text-gray-400">Model</TableHead>
                    <TableHead className="text-gray-400">Base Rate</TableHead>
                    <TableHead className="text-gray-400">Payout</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400">Effective</TableHead>
                    <TableHead className="text-gray-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agreements?.agreements?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                        No agreements yet. Create one to get started.
                      </TableCell>
                    </TableRow>
                  )}
                  {agreements?.agreements?.map((a: any) => (
                    <TableRow key={a.id} className="border-gray-800 hover:bg-gray-800/50">
                      <TableCell>
                        <div>
                          <p className="text-white font-medium">{a.name}</p>
                          <p className="text-gray-400 text-xs">{a.tenantName || `Tenant #${a.tenantId}`}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-300 capitalize">{a.model?.replace("_", " ")}</TableCell>
                      <TableCell className="text-white font-mono">
                        {(parseFloat(a.baseRate || "0.3") * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-gray-300 capitalize">
                        {a.payoutFrequency} · {a.payoutMethod?.replace("_", " ")}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[a.status] || "bg-gray-500/20 text-gray-300"}>
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-400 text-xs">
                        {a.effectiveFrom ? new Date(a.effectiveFrom).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {a.status === "draft" && (
                            <Button size="sm" variant="ghost" className="text-green-400 hover:text-green-300 h-7 px-2"
                              onClick={() => approveAgreement.mutate({ id: a.id })}>
                              <Check className="w-3 h-3 mr-1" /> Approve
                            </Button>
                          )}
                          {a.status === "active" && (
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-7 px-2"
                              onClick={() => terminateAgreement.mutate({ id: a.id })}>
                              <X className="w-3 h-3 mr-1" /> Terminate
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reports Tab ── */}
        <TabsContent value="reports" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Select value={reportYear.toString()} onValueChange={(v) => setReportYear(parseInt(v))}>
                <SelectTrigger className="w-28 bg-gray-900 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  {[2024, 2025, 2026].map(y => (
                    <SelectItem key={y} value={y.toString()} className="text-white">{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={exportReports}
              className="border-gray-700 text-gray-300 hover:text-white bg-transparent">
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          </div>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead className="text-gray-400">Tenant</TableHead>
                    <TableHead className="text-gray-400">Period</TableHead>
                    <TableHead className="text-gray-400">Transactions</TableHead>
                    <TableHead className="text-gray-400">Fee Revenue</TableHead>
                    <TableHead className="text-gray-400">Partner Share</TableHead>
                    <TableHead className="text-gray-400">Platform Share</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports?.reports?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                        No reports generated yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {reports?.reports?.map((r: any) => (
                    <TableRow key={r.id} className="border-gray-800 hover:bg-gray-800/50">
                      <TableCell className="text-white">{r.tenantName || `Tenant #${r.tenantId}`}</TableCell>
                      <TableCell className="text-gray-300">
                        {MONTH_NAMES[(r.periodMonth || 1) - 1]} {r.periodYear}
                      </TableCell>
                      <TableCell className="text-gray-300">{r.totalTransactions}</TableCell>
                      <TableCell className="text-white font-mono">${parseFloat(r.totalFeeRevenue || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-green-400 font-mono">${parseFloat(r.partnerEarnings || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-cyan-400 font-mono">${parseFloat(r.platformEarnings || "0").toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge className={reportStatusColors[r.status] || "bg-gray-500/20 text-gray-300"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.status === "pending" && (
                          <Button size="sm" variant="ghost" className="text-green-400 hover:text-green-300 h-7 px-2"
                            onClick={() => markPaid.mutate({ reportId: r.id })}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Mark Paid
                          </Button>
                        )}
                        {r.status === "paid" && (
                          <span className="text-green-400 text-xs flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Paid {r.paidAt ? new Date(r.paidAt).toLocaleDateString() : ""}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Analytics Tab ── */}
        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Select value={reportYear.toString()} onValueChange={(v) => setReportYear(parseInt(v))}>
              <SelectTrigger className="w-28 bg-gray-900 border-gray-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                {[2024, 2025, 2026].map(y => (
                  <SelectItem key={y} value={y.toString()} className="text-white">{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Trend */}
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-sm">Monthly Revenue Split</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={(analytics?.monthlyTrend || []).map((m: any) => ({
                    month: MONTH_NAMES[(m.month || 1) - 1],
                    partner: m.partnerEarnings,
                    platform: m.platformEarnings,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }} />
                    <Legend />
                    <Bar dataKey="partner" name="Partner" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="platform" name="Platform" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            {/* By Tenant */}
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-sm">Earnings by Partner</CardTitle>
              </CardHeader>
              <CardContent>
                {analytics?.byTenant && analytics.byTenant.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={analytics.byTenant.map((t: any) => ({ name: t.tenantName, value: t.partnerEarnings }))}
                        cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {analytics.byTenant.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }} formatter={(v: any) => `$${parseFloat(v).toFixed(2)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-gray-500">No data for selected year</div>
                )}
              </CardContent>
            </Card>
          </div>
          {/* Partner Breakdown Table */}
          {analytics?.byTenant && analytics.byTenant.length > 0 && (
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-sm">Partner Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800">
                      <TableHead className="text-gray-400">Partner</TableHead>
                      <TableHead className="text-gray-400">Volume</TableHead>
                      <TableHead className="text-gray-400">Transactions</TableHead>
                      <TableHead className="text-gray-400">Partner Earnings</TableHead>
                      <TableHead className="text-gray-400">Platform Earnings</TableHead>
                      <TableHead className="text-gray-400">Split</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.byTenant.map((t: any, i: number) => {
                      const total = t.partnerEarnings + t.platformEarnings;
                      const pct = total > 0 ? (t.partnerEarnings / total * 100).toFixed(1) : "0";
                      return (
                        <DashboardLayout>
                        <TableRow key={i} className="border-gray-800">
                          <TableCell className="text-white">{t.tenantName}</TableCell>
                          <TableCell className="text-gray-300 font-mono">${t.volume.toFixed(2)}</TableCell>
                          <TableCell className="text-gray-300">{t.transactions}</TableCell>
                          <TableCell className="text-green-400 font-mono">${t.partnerEarnings.toFixed(2)}</TableCell>
                          <TableCell className="text-cyan-400 font-mono">${t.platformEarnings.toFixed(2)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-800 rounded-full h-2 w-24">
                                <div className="bg-violet-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-gray-400 text-xs">{pct}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      
                        </DashboardLayout>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Agreement Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Revenue Share Agreement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-gray-300">Partner / Tenant</Label>
              <Select value={form.tenantId.toString()} onValueChange={(v) => setForm(f => ({ ...f, tenantId: parseInt(v) }))}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                  <SelectValue placeholder="Select tenant..." />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  {tenantsList?.tenants?.map((t: any) => (
                    <SelectItem key={t.id} value={t.id.toString()} className="text-white">{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-300">Agreement Name</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Standard Partner Agreement Q2 2026"
                className="bg-gray-800 border-gray-700 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-300">Revenue Model</Label>
                <Select value={form.model} onValueChange={(v: any) => setForm(f => ({ ...f, model: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="percentage" className="text-white">Percentage</SelectItem>
                    <SelectItem value="flat_fee" className="text-white">Flat Fee</SelectItem>
                    <SelectItem value="tiered" className="text-white">Tiered</SelectItem>
                    <SelectItem value="hybrid" className="text-white">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Base Rate (%)</Label>
                <Input type="number" step="0.1" min="0" max="100"
                  value={(form.baseRate * 100).toFixed(1)}
                  onChange={(e) => setForm(f => ({ ...f, baseRate: parseFloat(e.target.value) / 100 }))}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-300">Payout Frequency</Label>
                <Select value={form.payoutFrequency} onValueChange={(v) => setForm(f => ({ ...f, payoutFrequency: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="weekly" className="text-white">Weekly</SelectItem>
                    <SelectItem value="biweekly" className="text-white">Bi-weekly</SelectItem>
                    <SelectItem value="monthly" className="text-white">Monthly</SelectItem>
                    <SelectItem value="quarterly" className="text-white">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Min Payout (USD)</Label>
                <Input type="number" value={form.minPayoutThreshold}
                  onChange={(e) => setForm(f => ({ ...f, minPayoutThreshold: parseFloat(e.target.value) }))}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-gray-300">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes about this agreement..."
                className="bg-gray-800 border-gray-700 text-white mt-1 h-20" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}
                className="flex-1 border-gray-700 text-gray-300 bg-transparent hover:bg-gray-800">
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createAgreement.isPending}
                className="flex-1 bg-violet-600 hover:bg-violet-700">
                {createAgreement.isPending ? "Creating..." : "Create Agreement"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
