import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { 
  Plus, 
  Search, 
  MoreHorizontal, 
  ShieldAlert, 
  ShieldCheck, 
  BarChart3, 
  Edit2,
  Loader2,
  Users,
  ArrowUpRight,
  DollarSign,
  Activity
} from 'lucide-react';

type TenantPlan = 'starter' | 'growth' | 'enterprise';
type TenantStatus = 'active' | 'suspended';

interface Tenant {
  id: string;
  name: string;
  plan: TenantPlan;
  status: TenantStatus;
  contactEmail: string;
  maxUsers: number;
  maxTransactionsPerDay: number;
  userCount: number;
  monthlyVolume: number;
  createdAt: string;
}

export default function TenantAdmin() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isSuspendOpen, setIsSuspendOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  // Queries
  const { data: tenantsData, isLoading, refetch } = trpc.tenants.list.useQuery({
    limit: 10,
    offset: (page - 1) * 10,
    search,
    status: statusFilter !== 'all' ? statusFilter as any : undefined,
    plan: planFilter !== 'all' ? planFilter as any : undefined,
  });

  const { data: stats, isLoading: isLoadingStats } = trpc.tenants.stats.useQuery(undefined, { enabled: isStatsOpen });

  // Mutations
  const createTenant = trpc.tenants.create.useMutation({
    onSuccess: () => {
      toast.success('Success: Tenant created successfully');
      setIsCreateOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error('Error: ' + error.message);
    },
  });

  const updateTenant = trpc.tenants.update.useMutation({
    onSuccess: () => {
      toast.success('Success: Tenant updated successfully');
      setIsEditOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error('Error: ' + error.message);
    },
  });

  const suspendTenant = trpc.tenants.suspend.useMutation({
    onSuccess: () => {
      toast.success('Success: Tenant suspended');
      setIsSuspendOpen(false);
      setSuspendReason('');
      refetch();
    },
    onError: (error) => {
      toast.error('Error: ' + error.message);
    },
  });

  const activateTenant = trpc.tenants.activate.useMutation({
    onSuccess: () => {
      toast.success('Success: Tenant activated');
      refetch();
    },
    onError: (error) => {
      toast.error('Error: ' + error.message);
    },
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createTenant.mutate({
      slug: (formData.get('name') as string).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      name: formData.get('name') as string,
      plan: (formData.get('plan') as any) ?? 'starter',
      supportEmail: formData.get('contactEmail') as string || undefined,
      maxUsers: parseInt(formData.get("maxUsers") as string) || 100,
    });
  };

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTenant) return;
    const formData = new FormData(e.currentTarget);
    updateTenant.mutate({
      id: Number(selectedTenant.id),
      name: formData.get('name') as string || undefined,
      plan: (formData.get('plan') as any) ?? undefined,
      supportEmail: formData.get('contactEmail') as string || undefined,
      maxUsers: parseInt(formData.get("maxUsers") as string) || undefined,
    });
  };

  const getPlanBadge = (plan: TenantPlan) => {
    const styles = {
      starter: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      growth: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      enterprise: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    };
    return <Badge variant="outline" className={styles[plan]}>{plan.toUpperCase()}</Badge>;
  };

  const getStatusBadge = (status: TenantStatus) => {
    return status === 'active' ? (
      <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
    ) : (
      <Badge variant="destructive" className="bg-red-500/10 text-red-500 border-red-500/20">Suspended</Badge>
    );
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Tenants</h1>
            <p className="text-muted-foreground">Manage platform tenants and their subscription limits.</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-purple-600 hover:bg-purple-700 text-white">
                <Plus className="mr-2 h-4 w-4" /> Add Tenant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[525px] bg-slate-900 border-slate-800 text-white">
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Create New Tenant</DialogTitle>
                  <DialogDescription className="text-slate-400">
                    Onboard a new organization to the RemitFlow platform.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">Name</Label>
                    <Input id="name" name="name" className="col-span-3 bg-slate-800 border-slate-700" required />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="domain" className="text-right">Domain</Label>
                    <Input id="domain" name="domain" placeholder="acme.remitflow.com" className="col-span-3 bg-slate-800 border-slate-700" required />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="contactEmail" className="text-right">Contact</Label>
                    <Input id="contactEmail" name="contactEmail" type="email" className="col-span-3 bg-slate-800 border-slate-700" required />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="plan" className="text-right">Plan</Label>
                    <Select name="plan" defaultValue="starter">
                      <SelectTrigger className="col-span-3 bg-slate-800 border-slate-700">
                        <SelectValue placeholder="Select plan" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700 text-white">
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="growth">Growth</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="maxUsers" className="text-right">Max Users</Label>
                    <Input id="maxUsers" name="maxUsers" type="number" defaultValue="10" className="col-span-3 bg-slate-800 border-slate-700" required />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="maxTransactionsPerDay" className="text-right">Daily Tx Limit</Label>
                    <Input id="maxTransactionsPerDay" name="maxTransactionsPerDay" type="number" defaultValue="100" className="col-span-3 bg-slate-800 border-slate-700" required />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createTenant.isPending} className="bg-purple-600 hover:bg-purple-700">
                    {createTenant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Tenant
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search tenants..."
                  className="pl-10 bg-slate-800 border-slate-700 text-white"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700 text-white">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 text-white">
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={planFilter} onValueChange={setPlanFilter}>
                  <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700 text-white">
                    <SelectValue placeholder="Plan" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 text-white">
                    <SelectItem value="all">All Plans</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-slate-800">
              <Table>
                <TableHeader className="bg-slate-800/50">
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="text-slate-300">Name</TableHead>
                    <TableHead className="text-slate-300">Domain</TableHead>
                    <TableHead className="text-slate-300">Plan</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                    <TableHead className="text-slate-300">Users</TableHead>
                    <TableHead className="text-slate-300">Monthly Vol</TableHead>
                    <TableHead className="text-right text-slate-300">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-purple-500" />
                      </TableCell>
                    </TableRow>
                  ) : tenantsData?.tenants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-slate-400">
                        No tenants found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    tenantsData?.tenants.map((tenant: Tenant) => (
                      <TableRow key={tenant.id} className="border-slate-800 hover:bg-slate-800/30 text-slate-300">
                        <TableCell className="font-medium text-white">{tenant.name}</TableCell>
                        <TableCell>{(tenant as any).name}</TableCell>
                        <TableCell>{getPlanBadge(tenant.plan)}</TableCell>
                        <TableCell>{getStatusBadge(tenant.status)}</TableCell>
                        <TableCell>{tenant.maxUsers}</TableCell>
                        <TableCell>{(tenant as any).defaultCurrency}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 hover:bg-slate-700">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-white">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => { setSelectedTenant(tenant); setIsStatsOpen(true); }}>
                                <BarChart3 className="mr-2 h-4 w-4" /> View Stats
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setSelectedTenant(tenant); setIsEditOpen(true); }}>
                                <Edit2 className="mr-2 h-4 w-4" /> Edit Limits
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-slate-700" />
                              {tenant.status === 'active' ? (
                                <DropdownMenuItem 
                                  className="text-red-400 focus:text-red-400"
                                  onClick={() => { setSelectedTenant(tenant); setIsSuspendOpen(true); }}
                                >
                                  <ShieldAlert className="mr-2 h-4 w-4" /> Suspend
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem 
                                  className="text-emerald-400 focus:text-emerald-400"
                                  onClick={() => activateTenant.mutate({ id: Number(tenant.id) })}
                                >
                                  <ShieldCheck className="mr-2 h-4 w-4" /> Activate
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              >
                Previous
              </Button>
              <div className="text-sm text-slate-400">Page {page}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={tenantsData?.tenants.length === 0}
                className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats Modal */}
        <Dialog open={isStatsOpen} onOpenChange={setIsStatsOpen}>
          <DialogContent className="sm:max-w-[600px] bg-slate-900 border-slate-800 text-white">
            <DialogHeader>
              <DialogTitle>Tenant Statistics: {selectedTenant?.name}</DialogTitle>
              <DialogDescription className="text-slate-400">
                Real-time performance metrics for this organization.
              </DialogDescription>
            </DialogHeader>
            {isLoadingStats ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              </div>
            ) : (
              <div className="grid gap-4 py-4 md:grid-cols-3">
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-400">Total Users</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">{stats?.total}</div>
                    <div className="flex items-center text-xs text-emerald-500 mt-1">
                      <Users className="mr-1 h-3 w-3" /> Active Now
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-400">Tx Volume</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">${stats?.active.toLocaleString()}</div>
                    <div className="flex items-center text-xs text-emerald-500 mt-1">
                      <ArrowUpRight className="mr-1 h-3 w-3" /> +12.5%
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-400">Revenue</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">${stats?.enterprise.toLocaleString()}</div>
                    <div className="flex items-center text-xs text-purple-500 mt-1">
                      <DollarSign className="mr-1 h-3 w-3" /> Platform Fee
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            <div className="mt-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">System Health</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div className="bg-purple-500 h-2 rounded-full w-[85%]"></div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2 text-right">85% of daily transaction limit used</p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Modal */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="sm:max-w-[525px] bg-slate-900 border-slate-800 text-white">
            <form onSubmit={handleUpdate}>
              <DialogHeader>
                <DialogTitle>Edit Tenant: {selectedTenant?.name}</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Update tenant configuration and subscription limits.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-name" className="text-right">Name</Label>
                  <Input id="edit-name" name="name" defaultValue={selectedTenant?.name} className="col-span-3 bg-slate-800 border-slate-700" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-domain" className="text-right">Domain</Label>
                  <Input id="edit-domain" name="domain" defaultValue={selectedTenant?.name} className="col-span-3 bg-slate-800 border-slate-700" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-email" className="text-right">Contact</Label>
                  <Input id="edit-email" name="contactEmail" defaultValue={selectedTenant?.contactEmail} className="col-span-3 bg-slate-800 border-slate-700" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-plan" className="text-right">Plan</Label>
                  <Select name="plan" defaultValue={selectedTenant?.plan}>
                    <SelectTrigger className="col-span-3 bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-white">
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="growth">Growth</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-users" className="text-right">Max Users</Label>
                  <Input id="edit-users" name="maxUsers" type="number" defaultValue={selectedTenant?.maxUsers} className="col-span-3 bg-slate-800 border-slate-700" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-tx" className="text-right">Daily Tx</Label>
                  <Input id="edit-tx" name="maxTransactionsPerDay" type="number" defaultValue={selectedTenant?.maxTransactionsPerDay} className="col-span-3 bg-slate-800 border-slate-700" required />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateTenant.isPending} className="bg-purple-600 hover:bg-purple-700">
                  {updateTenant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Suspend Modal */}
        <Dialog open={isSuspendOpen} onOpenChange={setIsSuspendOpen}>
          <DialogContent className="sm:max-w-[425px] bg-slate-900 border-slate-800 text-white">
            <DialogHeader>
              <DialogTitle className="text-red-500">Suspend Tenant</DialogTitle>
              <DialogDescription className="text-slate-400">
                Are you sure you want to suspend {selectedTenant?.name}? They will lose access to the platform immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="reason">Reason for suspension</Label>
                <Input 
                  id="reason" 
                  value={suspendReason} 
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="e.g. Overdue payment, Terms violation" 
                  className="bg-slate-800 border-slate-700"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setIsSuspendOpen(false)} className="text-slate-400 hover:text-white hover:bg-slate-800">Cancel</Button>
              <Button 
                variant="destructive" 
                disabled={!suspendReason || suspendTenant.isPending}
                onClick={() => suspendTenant.mutate({ id: Number(selectedTenant?.id ?? 0), reason: suspendReason })}
              >
                {suspendTenant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Suspension
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}