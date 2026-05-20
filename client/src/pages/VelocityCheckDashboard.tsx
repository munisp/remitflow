import { toast } from 'sonner';
import React, { useState, useEffect } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  AlertTriangle, 
  CheckCircle, 
  ShieldAlert, 
  Activity, 
  Search, 
  RefreshCw,
  MoreHorizontal,
  History
} from 'lucide-react';
import { format } from 'date-fns';

const VelocityCheckDashboard: React.FC = () => {
  const [userIdFilter, setUserIdFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [overrideReason, setOverrideReason] = useState('');
  const [selectedCheck, setSelectedCheck] = useState<any>(null);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);

  // Stats Query
  const { data: stats, isLoading: statsLoading } = trpc.velocityCheckAdmin.listRules.useQuery(undefined, {
    refetchInterval: 10000,
  });

  // List Query
  const { data: listData, isLoading: listLoading, refetch: refetchList } = trpc.velocityCheckAdmin.listRules.useQuery(undefined, {
    refetchInterval: 30000,
  });

  // Alerts Query
  const { data: alerts, isLoading: alertsLoading } = trpc.velocityCheckAdmin.listOverrides.useQuery(undefined, {
    refetchInterval: 10000,
  });

  // Override Mutation
  const overrideMutation = trpc.velocityCheckAdmin.grantOverride.useMutation({
    onSuccess: () => {
      toast.success("Success: Velocity check override applied successfully.");
      setIsOverrideOpen(false);
      setOverrideReason('');
      refetchList();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to apply override.');
    },
  });

  const handleOverride = () => {
    if (!selectedCheck || !overrideReason) return;
    overrideMutation.mutate({
      ruleId: Number(selectedCheck.id),
      userId: 0,
      reason: overrideReason,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'passed':
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Passed</Badge>;
      case 'flagged':
        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">Flagged</Badge>;
      case 'blocked':
        return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20">Blocked</Badge>;
      case 'overridden':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Overridden</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Total Checks</CardTitle>
              <Activity className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalChecks?.toLocaleString() || 0}</div>
              <p className="text-xs text-slate-500 mt-1">Last 24 hours</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Blocked</CardTitle>
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-500">{stats?.blockedCount?.toLocaleString() || 0}</div>
              <p className="text-xs text-slate-500 mt-1">Security interventions</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Flagged</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">{stats?.flaggedCount?.toLocaleString() || 0}</div>
              <p className="text-xs text-slate-500 mt-1">Requiring review</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Avg Risk Score</CardTitle>
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.avgScore?.toFixed(1) || '0.0'}</div>
              <p className="text-xs text-slate-500 mt-1">System-wide average</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section */}
          <Card className="lg:col-span-2 bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle>Velocity Trends</CardTitle>
              <CardDescription>Checks processed per hour</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.ruleBreakdown || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis 
                    dataKey="hour" 
                    stroke="#64748b" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#64748b" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                    itemStyle={{ color: '#f8fafc' }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {(stats?.ruleBreakdown || []).map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.count > 50 ? '#6366f1' : '#818cf8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Recent Alerts */}
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-indigo-500" />
                Critical Alerts
              </CardTitle>
              <CardDescription>Latest high-risk detections</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alertsLoading ? (
                  <div className="flex justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-slate-600" /></div>
                ) : alerts?.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">No critical alerts</div>
                ) : (
                  alerts?.map((alert: any) => (
                    <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/50">
                      <div className="mt-1">
                        <ShieldAlert className="h-4 w-4 text-rose-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">User: {alert.userId}</p>
                        <p className="text-xs text-slate-400">{alert.ruleName}</p>
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-xs font-mono text-indigo-400">Score: {alert.score}</span>
                          <span className="text-[10px] text-slate-500">{format(new Date(alert.createdAt), 'HH:mm:ss')}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters & Table */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle>Recent Checks</CardTitle>
                <CardDescription>Monitor and manage velocity check results</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                  <Input
                    placeholder="Search User ID..."
                    className="pl-9 w-[200px] bg-slate-950 border-slate-800"
                    value={userIdFilter}
                    onChange={(e) => setUserIdFilter(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[130px] bg-slate-950 border-slate-800">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="passed">Passed</SelectItem>
                    <SelectItem value="flagged">Flagged</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => refetchList()} className="border-slate-800">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-slate-800">
              <Table>
                <TableHeader className="bg-slate-800/50">
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Rule Triggered</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        <RefreshCw className="h-6 w-6 animate-spin mx-auto text-slate-600" />
                      </TableCell>
                    </TableRow>
                  ) : listData?.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                        No velocity checks found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    listData?.items.map((check: any) => (
                      <TableRow key={check.id} className="hover:bg-slate-800/30 border-slate-800">
                        <TableCell className="font-medium">{check.userId}</TableCell>
                        <TableCell>${check.amount.toLocaleString()}</TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-400">{check.ruleName || 'N/A'}</span>
                        </TableCell>
                        <TableCell>
                          <span className={`font-mono ${check.score > 70 ? 'text-rose-500' : check.score > 40 ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {check.score}
                          </span>
                        </TableCell>
                        <TableCell>{getStatusBadge(check.status)}</TableCell>
                        <TableCell className="text-slate-500 text-xs">
                          {format(new Date(check.createdAt), 'MMM d, HH:mm')}
                        </TableCell>
                        <TableCell className="text-right">
                          {check.status === 'flagged' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => {
                                setSelectedCheck(check);
                                setIsOverrideOpen(true);
                              }}
                              className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                            >
                              Override
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="text-slate-500">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between space-x-2 py-4">
              <div className="text-sm text-slate-500">
                Showing {listData?.items.length || 0} of {listData?.total || 0} results
              </div>
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || listLoading}
                  className="border-slate-800"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!listData?.hasMore || listLoading}
                  className="border-slate-800"
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Override Dialog */}
      <Dialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Override Velocity Check</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to override this flagged check for user {selectedCheck?.userId}? 
              This will allow the transaction to proceed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason for Override</label>
              <Input
                placeholder="e.g., Verified via phone call, trusted merchant..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="bg-slate-950 border-slate-800"
              />
            </div>
            <div className="p-3 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
              Warning: Overriding a velocity check bypasses automated security controls. Ensure you have verified the transaction details.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOverrideOpen(false)} className="border-slate-800">
              Cancel
            </Button>
            <Button 
              onClick={handleOverride} 
              disabled={!overrideReason || overrideMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {overrideMutation.isPending ? 'Processing...' : 'Confirm Override'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default VelocityCheckDashboard;