import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Users, Download, Ban, CheckCircle, History } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function BulkUserActions() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [idsInput, setIdsInput] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [exportKycTier, setExportKycTier] = useState("");

  const { data: log, refetch: refetchLog } = trpc.v98.bulkUsers.getLog.useQuery({ limit: 20 });
  const { data: exportData, refetch: doExport } = trpc.v98.bulkUsers.exportCsv.useQuery(
    { kycTier: exportKycTier || undefined },
    { enabled: false }
  );

  const suspend = trpc.v98.bulkUsers.suspend.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.affected} users suspended`);
      setSuspendReason(""); setIdsInput(""); setSelectedIds([]);
      refetchLog();
    },
    onError: (e) => toast.error(e.message),
  });

  const unsuspend = trpc.v98.bulkUsers.unsuspend.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.affected} users unsuspended`);
      setIdsInput(""); setSelectedIds([]);
      refetchLog();
    },
    onError: (e) => toast.error(e.message),
  });

  const parseIds = () => {
    return idsInput.split(/[\s,]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
  };

  const handleExport = async () => {
    const result = await doExport();
    if (result.data?.csv) {
      const blob = new Blob([result.data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${result.data.count} users exported`);
    }
  };

  const ids = parseIds();

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Bulk User Actions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Perform bulk operations on multiple users at once — Admin only
        </p>
      </div>

      <Tabs defaultValue="actions">
        <TabsList>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="log">Action Log ({log?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="space-y-4">
          {/* User ID Input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Target Users
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>User IDs (comma or newline separated)</Label>
                <Textarea
                  placeholder="1, 2, 3, 4, 5&#10;or one per line"
                  value={idsInput}
                  onChange={(e) => setIdsInput(e.target.value)}
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
              {ids.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {ids.length} user{ids.length !== 1 ? "s" : ""} selected: {ids.slice(0, 10).join(", ")}{ids.length > 10 ? "..." : ""}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Suspend */}
          <Card className="border-red-200 dark:border-red-900">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
                <Ban className="h-4 w-4" />
                Suspend Users
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Reason (required)</Label>
                <Textarea
                  placeholder="Reason for suspension (min 5 characters)..."
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  rows={2}
                />
              </div>
              <Button
                variant="destructive"
                disabled={ids.length === 0 || suspendReason.length < 5 || suspend.isPending}
                onClick={() => suspend.mutate({ userIds: ids, reason: suspendReason })}
              >
                <Ban className="h-4 w-4 mr-2" />
                {suspend.isPending ? "Suspending..." : `Suspend ${ids.length} User${ids.length !== 1 ? "s" : ""}`}
              </Button>
            </CardContent>
          </Card>

          {/* Unsuspend */}
          <Card className="border-green-200 dark:border-green-900">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                Unsuspend Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                disabled={ids.length === 0 || unsuspend.isPending}
                onClick={() => unsuspend.mutate({ userIds: ids })}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {unsuspend.isPending ? "Unsuspending..." : `Unsuspend ${ids.length} User${ids.length !== 1 ? "s" : ""}`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="h-4 w-4" />
                Export Users to CSV
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Filter by KYC Tier (optional)</Label>
                <select
                  className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={exportKycTier}
                  onChange={(e) => setExportKycTier(e.target.value)}
                >
                  <option value="">All tiers</option>
                  <option value="tier0">Tier 0 (Unverified)</option>
                  <option value="tier1">Tier 1 (Basic)</option>
                  <option value="tier2">Tier 2 (Enhanced)</option>
                  <option value="tier3">Tier 3 (Full)</option>
                </select>
              </div>
              <p className="text-sm text-muted-foreground">
                Exports up to 1,000 users. Includes: ID, Name, Email, Phone, Role, KYC Tier, Created, Last Login.
              </p>
              <Button onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export to CSV
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="log">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />
                Bulk Action History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!log?.length ? (
                <div className="text-center py-8 text-muted-foreground">No bulk actions performed yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-3">Action</th>
                        <th className="text-right pr-3">Affected</th>
                        <th className="text-left pr-3">Status</th>
                        <th className="text-left pr-3">Notes</th>
                        <th className="text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.map((entry: any) => (
                        <tr key={entry.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="py-2 pr-3">
                            <Badge variant={entry.action === "suspend" ? "destructive" : entry.action === "export_csv" ? "outline" : "default"} className="text-xs">
                              {entry.action}
                            </Badge>
                          </td>
                          <td className="text-right pr-3 font-medium">{entry.affectedCount}</td>
                          <td className="pr-3">
                            <span className={`text-xs ${entry.status === "completed" ? "text-green-500" : "text-yellow-500"}`}>
                              {entry.status}
                            </span>
                          </td>
                          <td className="pr-3 text-xs text-muted-foreground max-w-[200px] truncate">
                            {entry.notes ?? "—"}
                          </td>
                          <td className="text-xs text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
