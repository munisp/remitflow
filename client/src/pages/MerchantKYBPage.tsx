import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, Search, CheckCircle, Clock, XCircle, FileText } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function MerchantKYBPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  // getApplications returns { applications: kycDocuments[], total }
  const { data, isLoading, refetch } = trpc.v101.merchantKYB.getApplications.useQuery({
    limit: 20,
    offset: page * 20,
    status: statusFilter,
  });

  const approve = trpc.v101.merchantKYB.approve.useMutation({
    onSuccess: () => { toast.success("Application approved"); void refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const reject = trpc.v101.merchantKYB.reject.useMutation({
    onSuccess: () => { toast.success("Application rejected"); void refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-4 h-4 text-yellow-500" />,
    under_review: <FileText className="w-4 h-4 text-blue-500" />,
    approved: <CheckCircle className="w-4 h-4 text-green-500" />,
    rejected: <XCircle className="w-4 h-4 text-red-500" />,
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    under_review: "bg-blue-100 text-blue-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  const filteredApps = (data?.applications ?? []).filter((a: any) =>
    !search ||
    a.documentType?.toLowerCase().includes(search.toLowerCase()) ||
    String(a.userId).includes(search)
  );

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Merchant KYB</h1>
        <p className="text-muted-foreground">
          Know Your Business — review and approve merchant KYC/KYB applications
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["pending", "approved", "rejected", "under_review"].map((s) => (
          <Card
            key={s}
            className={`cursor-pointer transition-all ${statusFilter === s ? "ring-2 ring-primary" : ""}`}
            onClick={() => setStatusFilter(statusFilter === s ? undefined : s)}
          >
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                {statusIcons[s]}
                <div>
                  <div className="text-xs text-muted-foreground capitalize">{s.replace("_", " ")}</div>
                  <div className="text-xl font-bold">
                    {(data?.applications ?? []).filter((a: any) => a.status === s).length}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            KYB Applications
          </CardTitle>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by user ID or doc type..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-9 max-w-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading applications...</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Document Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredApps.map((app: any) => (
                    <TableRow key={app.id}>
                      <TableCell className="font-mono text-xs">{app.id}</TableCell>
                      <TableCell>{app.userId}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{app.documentType ?? "—"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[app.status ?? "pending"] ?? ""}>
                          {app.status ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        {(app.status === "pending" || app.status === "under_review") && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600"
                              onClick={() => approve.mutate({ kycId: app.id, notes: "Approved via admin" })}
                              disabled={approve.isPending}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600"
                              onClick={() => reject.mutate({ kycId: app.id, reason: "Does not meet requirements" })}
                              disabled={reject.isPending}
                            >
                              <XCircle className="w-3 h-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredApps.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No applications found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Total: {data?.total ?? 0} applications
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!data || (page + 1) * 20 >= data.total}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
