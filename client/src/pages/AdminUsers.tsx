import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Shield, ShieldOff, Trash2, ChevronLeft, ChevronRight, Users, FileCheck, AlertTriangle, Clock, UserCog, Copy, ExternalLink, Download, Lock, LockOpen, RotateCcw } from "lucide-react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

export default function AdminUsers() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState<"admin" | "user" | "">("" );
  const [kycTierFilter, setKycTierFilter] = useState<"tier0" | "tier1" | "tier2" | "tier3" | "">("" );
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const { data: summaryData } = trpc.admin.summary.useQuery(undefined, { enabled: user?.role === "admin" });

  const { data, isLoading, refetch } = trpc.admin.listUsers.useQuery(
    { page, limit: 20, search: search || undefined, role: roleFilter || undefined, kycTier: kycTierFilter || undefined },
    { enabled: user?.role === "admin" }
  );

  const promote = trpc.admin.promoteUser.useMutation({
    onSuccess: (res) => {
      toast.success(`User role updated to ${res.newRole}`);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      toast.success("User deleted");
      setDeleteTarget(null);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [impersonateTarget, setImpersonateTarget] = useState<{ id: number; name: string; email: string } | null>(null);
  const [impersonateToken, setImpersonateToken] = useState<string | null>(null);
  const [impersonateDialogOpen, setImpersonateDialogOpen] = useState(false);

  const createImpersonationToken = trpc.admin.createImpersonationToken.useMutation({
    onSuccess: (data) => {
      setImpersonateToken(data.token);
    },
    onError: (err) => {
      toast.error(err.message);
      setImpersonateDialogOpen(false);
    },
  });

  const handleImpersonate = (u: { id: number; name: string; email: string }) => {
    setImpersonateTarget(u);
    setImpersonateToken(null);
    setImpersonateDialogOpen(true);
    createImpersonationToken.mutate({ targetUserId: u.id });
  };
  const utils = trpc.useUtils();
  const [lockoutHistoryUserId, setLockoutHistoryUserId] = useState<number | null>(null);
  const [lockoutHistoryUserName, setLockoutHistoryUserName] = useState<string>("");
  const { data: lockoutHistoryData, isLoading: lockoutHistoryLoading } = trpc.securityAudit.lockoutHistory.useQuery(
    { userId: lockoutHistoryUserId! },
    { enabled: lockoutHistoryUserId !== null }
  );
  const { data: lockoutData } = trpc.securityAudit.userLockoutStatus.useQuery(undefined, { enabled: user?.role === "admin", refetchInterval: 30000 });
  const lockoutMap = (lockoutData?.lockouts ?? []).reduce((acc: Record<number, any>, l: any) => { acc[l.userId] = l; return acc; }, {} as Record<number, any>);
  const unlockUser = trpc.securityAudit.unlockUser.useMutation({
    onSuccess: () => { toast.success("User unlocked successfully"); utils.securityAudit.userLockoutStatus.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const resetAttempts = trpc.securityAudit.resetLoginAttempts.useMutation({
    onSuccess: () => { toast.success("Login attempts reset"); utils.securityAudit.userLockoutStatus.invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const handleSearch = () => {
    setPage(1);
    setSearch(searchInput);
  };
  const handleClearFilters = () => {
    setSearch(""); setSearchInput(""); setRoleFilter(""); setKycTierFilter(""); setPage(1);
  };

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Shield className="w-12 h-12 text-muted-foreground" />
        <p className="text-muted-foreground text-lg">Admin access required</p>
      </div>
    );
  }

  return (

    <DashboardLayout>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage user roles, KYC tiers, and account status
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          const params = new URLSearchParams();
          if (search) params.set("search", search);
          if (roleFilter) params.set("role", roleFilter);
          if (kycTierFilter) params.set("kycTier", kycTierFilter);
          window.open(`/api/admin/users/export?${params.toString()}`, "_blank");
        }}>
          <Download className="h-4 w-4 mr-2" />Export CSV
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryData?.totalUsers ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Clock className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryData?.pendingKyc ?? 0}</p>
                <p className="text-xs text-muted-foreground">Pending KYC</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryData?.openComplianceCases ?? 0}</p>
                <p className="text-xs text-muted-foreground">Open Cases</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <FileCheck className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryData?.flaggedTransfers ?? 0}</p>
                <p className="text-xs text-muted-foreground">Pending Txns</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                className="pl-9"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <select
              className="border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground h-10"
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value as any); setPage(1); }}
            >
              <option value="">All Roles</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
            <select
              className="border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground h-10"
              value={kycTierFilter}
              onChange={(e) => { setKycTierFilter(e.target.value as any); setPage(1); }}
            >
              <option value="">All KYC Tiers</option>
              <option value="tier0">Tier 0</option>
              <option value="tier1">Tier 1</option>
              <option value="tier2">Tier 2</option>
              <option value="tier3">Tier 3</option>
            </select>
            <Button onClick={handleSearch}>Search</Button>
            {(search || roleFilter || kycTierFilter) && (
              <Button variant="outline" onClick={handleClearFilters}>
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {(search || roleFilter || kycTierFilter)
              ? `Filtered results (${data?.total ?? 0} users)`
              : `All Users (${data?.total ?? 0})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              Loading users…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>KYC Tier</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-center">Login Attempts</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.users.map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">#{u.id}</TableCell>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{u.email || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {u.kycTier ?? "tier0"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {lockoutMap[u.id] ? (
                          <div className="flex flex-col items-center gap-0.5">
                            {lockoutMap[u.id].isLocked ? (
                              <Badge variant="destructive" className="text-xs gap-1">
                                <Lock className="w-2.5 h-2.5" />Locked
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                {lockoutMap[u.id].failedAttempts}/5
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {u.role === "user" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => promote.mutate({ userId: u.id, role: "admin" })}
                              disabled={promote.isPending}
                            >
                              <Shield className="w-3 h-3" />
                              Promote
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => promote.mutate({ userId: u.id, role: "user" })}
                              disabled={promote.isPending || u.id === user?.id}
                            >
                              <ShieldOff className="w-3 h-3" />
                              Demote
                            </Button>
                          )}
                          {u.id !== user?.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                              onClick={() => handleImpersonate({ id: u.id, name: u.name, email: u.email ?? "" })}
                              disabled={createImpersonationToken.isPending}
                              title="Impersonate user (15-min token)"
                            >
                              <UserCog className="w-3 h-3" />
                            </Button>
                          )}
                          {lockoutMap[u.id]?.isLocked && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50"
                              onClick={() => unlockUser.mutate({ userId: u.id })}
                              disabled={unlockUser.isPending}
                              title="Unlock account"
                            >
                              <LockOpen className="w-3 h-3" />
                            </Button>
                          )}
                          {lockoutMap[u.id] && !lockoutMap[u.id].isLocked && lockoutMap[u.id].failedAttempts > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-amber-600 border-amber-200 hover:bg-amber-50"
                              onClick={() => resetAttempts.mutate({ userId: u.id })}
                              disabled={resetAttempts.isPending}
                              title="Reset login attempts"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                          )}
                          {lockoutMap[u.id] && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-slate-500 hover:text-slate-800"
                              onClick={() => { setLockoutHistoryUserId(u.id); setLockoutHistoryUserName(u.name ?? `User #${u.id}`); }}
                              title="View lockout history"
                            >
                              <Clock className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({ id: u.id, name: u.name })}
                            disabled={u.id === user?.id}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {data.page} of {data.pages} ({data.total} users)</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.min(data.pages, p + 1))}
              disabled={page === data.pages}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Impersonation Dialog */}
      <Dialog open={impersonateDialogOpen} onOpenChange={(open) => { if (!open) { setImpersonateDialogOpen(false); setImpersonateToken(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-indigo-500" />
              Impersonate User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <strong>Security Notice:</strong> You are about to generate a one-time impersonation token for <strong>{impersonateTarget?.name}</strong> ({impersonateTarget?.email}). This action is logged in the audit trail.
            </div>
            {createImpersonationToken.isPending ? (
              <div className="flex items-center justify-center h-16 text-muted-foreground text-sm">
                Generating secure token…
              </div>
            ) : impersonateToken ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Token generated (valid for 15 minutes, single use):</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
                    {impersonateToken.slice(0, 20)}…
                  </code>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => {
                    navigator.clipboard.writeText(impersonateToken);
                    toast.success("Token copied to clipboard");
                  }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Use this token with the <code>/impersonate?token=...</code> endpoint to log in as this user.</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImpersonateDialogOpen(false); setImpersonateToken(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lockout History Modal */}
      <Dialog open={lockoutHistoryUserId !== null} onOpenChange={(open) => { if (!open) setLockoutHistoryUserId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-red-500" />
              Lockout History — {lockoutHistoryUserName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-96 overflow-y-auto">
            {lockoutHistoryLoading ? (
              <div className="text-center text-muted-foreground text-sm py-8">Loading history…</div>
            ) : !lockoutHistoryData || lockoutHistoryData.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                <Shield className="h-8 w-8 mx-auto mb-2 text-green-500" />
                No lockout history for this user.
              </div>
            ) : (
              lockoutHistoryData.map((entry: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Failed Attempts: {entry.failedAttempts}/5</span>
                    {entry.lockedAt ? (
                      <Badge variant="destructive" className="text-xs">Locked</Badge>
                    ) : entry.unlockedAt ? (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300">Unlocked</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Active</Badge>
                    )}
                  </div>
                  {entry.lockedAt && (
                    <div className="text-muted-foreground">
                      Locked: {new Date(entry.lockedAt).toLocaleString()}
                    </div>
                  )}
                  {entry.lockExpiresAt && (
                    <div className="text-muted-foreground">
                      Expires: {new Date(entry.lockExpiresAt).toLocaleString()}
                    </div>
                  )}
                  {entry.unlockedAt && (
                    <div className="text-green-700">
                      Unlocked: {new Date(entry.unlockedAt).toLocaleString()}
                      {entry.unlockedByAdminId && ` by Admin #${entry.unlockedByAdminId}`}
                    </div>
                  )}
                  {entry.notificationSentAt ? (
                    <div className="flex items-center gap-1 text-xs text-blue-600">
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                      Email sent: {new Date(entry.notificationSentAt).toLocaleString()}
                    </div>
                  ) : entry.lockedAt ? (
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                      No notification sent
                    </div>
                  ) : null}
                  {entry.updatedAt && (
                    <div className="text-xs text-muted-foreground">
                      Last updated: {new Date(entry.updatedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockoutHistoryUserId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{deleteTarget?.name}</strong>?
              This action cannot be undone and will remove all their data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteUser.mutate({ userId: deleteTarget.id })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  

    </DashboardLayout>

  );
}
