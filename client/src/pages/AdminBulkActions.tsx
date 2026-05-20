import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Users, Download, Ban, CheckCircle, AlertTriangle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function AdminBulkActions() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");

  const { data: usersData, isLoading } = trpc.admin.listUsers.useQuery({ limit: 100 });
  const exportMut = trpc.adminBulk.exportUsers.useQuery({ format: exportFormat }, { enabled: false });
  const suspendMut = trpc.adminBulk.bulkSuspendUsers.useMutation({
    onSuccess: (data) => { toast.success(`${data.affected} user(s) suspended`); setSelected(new Set()); },
    onError: (e) => toast.error(e.message),
  });

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!usersData?.users) return;
    if (selected.size === usersData.users.length) setSelected(new Set());
    else setSelected(new Set(usersData.users.map((u: any) => u.id)));
  }

  async function handleExport() {
    const result = await exportMut.refetch();
    if (!result.data) return;
    const { data: content, format, count } = result.data;
    const mime = format === "csv" ? "text/csv" : "application/json";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `users-export-${Date.now()}.${format}`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${count} users as ${format.toUpperCase()}`);
  }

  const userList = usersData?.users ?? [];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6 text-purple-500" /> Admin Bulk Actions</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage multiple users at once — suspend, verify, or export</p>
        </div>
        <div className="flex gap-2">
          <Select value={exportFormat} onValueChange={v => setExportFormat(v as any)}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport} className="gap-2"><Download className="w-4 h-4" /> Export All</Button>
          {selected.size > 0 && (
            <Button variant="destructive" onClick={() => suspendMut.mutate({ userIds: Array.from(selected) })} disabled={suspendMut.isPending} className="gap-2">
              <Ban className="w-4 h-4" /> Suspend {selected.size}
            </Button>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          <span className="text-sm text-yellow-800">{selected.size} user(s) selected. Use bulk actions above.</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto text-yellow-700">Clear</Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <Checkbox checked={selected.size === userList.length && userList.length > 0} onCheckedChange={toggleAll} />
                    </th>
                    {["User", "Email", "Role", "KYC Tier", "Joined", "Actions"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {userList.map((u: any) => (
                    <tr key={u.id} className={`hover:bg-muted/30 ${selected.has(u.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3">
                        <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggleSelect(u.id)} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">{u.name?.[0]?.toUpperCase() ?? "?"}</div>
                          <span className="font-medium">{u.name ?? "Unknown"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge className={u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}>{u.role}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">{u.kycTier}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-green-600"><CheckCircle className="w-3 h-3" /> Verify</Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-red-600" onClick={() => suspendMut.mutate({ userIds: [u.id] })}><Ban className="w-3 h-3" /> Suspend</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
