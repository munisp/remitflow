import { toast } from 'sonner';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Search,
  Filter,
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  History,
  FileText,
  ChevronRight,
  Users,
  Timer,
  CheckSquare,
} from 'lucide-react';
import { format } from 'date-fns';

type KYCStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'expired';

export default function KYCLifecycleTracker() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [isActionDialogOpen, setIsActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'requestInfo' | null>(null);
  const [actionData, setActionData] = useState({
    rejectionReason: '',
    notes: '',
    level: '1',
    requiredDocuments: '',
    message: '',
  });

  // Queries
  const { data: stats, isLoading: isStatsLoading } = trpc.kycLifecycle.adminList.useQuery({ limit: 5, offset: 0 });
  const { data: kycList, isLoading: isListLoading, refetch } = trpc.kycLifecycle.adminList.useQuery({ limit: 50 });
  const { data: timeline, isLoading: isTimelineLoading } = trpc.kycLifecycle.getHistory.useQuery(
    { userId: Number(selectedUser) || 0 },
    { enabled: !!selectedUser && isTimelineOpen }
  );

  // Mutations
  const approveMutation = trpc.kycLifecycle.approve.useMutation({
    onSuccess: () => {
      toast.success("Success: KYC approved successfully");
      setIsActionDialogOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const rejectMutation = trpc.kycLifecycle.reject.useMutation({
    onSuccess: () => {
      toast.success("Success: KYC rejected successfully");
      setIsActionDialogOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const requestInfoMutation = trpc.kycLifecycle.requestAdditionalInfo.useMutation({
    onSuccess: () => {
      toast.success("Success: Information request sent");
      setIsActionDialogOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleAction = () => {
    if (!selectedUser) return;

    if (actionType === 'approve') {
      approveMutation.mutate({
        userId: Number(selectedUser),
        tier: parseInt(actionData.level) || undefined,
        notes: actionData.notes,
      });
    } else if (actionType === 'reject') {
      rejectMutation.mutate({
        userId: Number(selectedUser),
        rejectionReason: actionData.rejectionReason ?? actionData.rejectionReason ?? "",
      });
    } else if (actionType === 'requestInfo') {
      requestInfoMutation.mutate({
        userId: Number(selectedUser),
        additionalInfoRequired: actionData.message,
      });
    }
  };

  const getStatusBadge = (status: KYCStatus) => {
    const variants: Record<KYCStatus, string> = {
      submitted: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      under_review: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      approved: 'bg-green-500/10 text-green-500 border-green-500/20',
      rejected: 'bg-red-500/10 text-red-500 border-red-500/20',
      expired: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    };
    return (
      <Badge variant="outline" className={variants[status]}>
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6 bg-[#1a1625] min-h-screen text-white">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-[#241e33] border-[#3d3452] text-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Total Pending</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{0}</div>
              <p className="text-xs text-gray-500 mt-1">Awaiting review</p>
            </CardContent>
          </Card>
          <Card className="bg-[#241e33] border-[#3d3452] text-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Avg. Approval Time</CardTitle>
              <Timer className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total ?? 0}h</div>
              <p className="text-xs text-gray-500 mt-1">Last 30 days</p>
            </CardContent>
          </Card>
          <Card className="bg-[#241e33] border-[#3d3452] text-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Approved Today</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
              <p className="text-xs text-gray-500 mt-1">Successfully verified</p>
            </CardContent>
          </Card>
          <Card className="bg-[#241e33] border-[#3d3452] text-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-400">Rejected Today</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
              <p className="text-xs text-gray-500 mt-1">Flagged for issues</p>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline View / Filters */}
        <Card className="bg-[#241e33] border-[#3d3452] text-white">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle>KYC Pipeline</CardTitle>
                <CardDescription className="text-gray-400">Manage and track user verification lifecycles</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="border-[#3d3452] hover:bg-[#2d2640]">
                  <CheckSquare className="mr-2 h-4 w-4" />
                  Bulk Approve
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  placeholder="Search by user name or email..."
                  className="pl-10 bg-[#1a1625] border-[#3d3452] focus:ring-purple-500"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px] bg-[#1a1625] border-[#3d3452]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#241e33] border-[#3d3452] text-white">
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={levelFilter} onValueChange={setLevelFilter}>
                  <SelectTrigger className="w-[120px] bg-[#1a1625] border-[#3d3452]">
                    <SelectValue placeholder="Level" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#241e33] border-[#3d3452] text-white">
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="1">Level 1</SelectItem>
                    <SelectItem value="2">Level 2</SelectItem>
                    <SelectItem value="3">Level 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border border-[#3d3452] overflow-hidden">
              <Table>
                <TableHeader className="bg-[#1a1625]">
                  <TableRow className="border-[#3d3452] hover:bg-transparent">
                    <TableHead className="text-gray-400">User</TableHead>
                    <TableHead className="text-gray-400">Level</TableHead>
                    <TableHead className="text-gray-400">Submitted</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400">Documents</TableHead>
                    <TableHead className="text-right text-gray-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isListLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-gray-500">
                        Loading KYC records...
                      </TableCell>
                    </TableRow>
                  ) : kycList?.lifecycles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-gray-500">
                        No KYC records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    kycList?.lifecycles.map((kyc: any) => (
                      <TableRow key={kyc.userId} className="border-[#3d3452] hover:bg-[#2d2640]">
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{kyc.userName}</span>
                            <span className="text-xs text-gray-500">{kyc.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
                            Lvl {kyc.level}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-gray-400">
                          {format(new Date(kyc.submittedAt), 'MMM dd, yyyy HH:mm')}
                        </TableCell>
                        <TableCell>{getStatusBadge(kyc.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {kyc.documents.map((doc: any, i: any) => (
                              <FileText key={i} className="h-4 w-4 text-gray-500 hover:text-purple-400 cursor-pointer" />
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#3d3452]"
                              onClick={() => {
                                setSelectedUser(kyc.userId);
                                setIsTimelineOpen(true);
                              }}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                            <Dialog open={isActionDialogOpen && selectedUser === kyc.userId} onOpenChange={(open) => {
                              setIsActionDialogOpen(open);
                              if (!open) setSelectedUser(null);
                            }}>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#3d3452]"
                                  onClick={() => setSelectedUser(kyc.userId)}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="bg-[#241e33] border-[#3d3452] text-white">
                                <DialogHeader>
                                  <DialogTitle>Review KYC - {kyc.userName}</DialogTitle>
                                  <DialogDescription className="text-gray-400">
                                    Select an action to perform on this KYC submission.
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                  <div className="flex gap-2">
                                    <Button
                                      variant={actionType === 'approve' ? 'default' : 'outline'}
                                      className={actionType === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'border-[#3d3452]'}
                                      onClick={() => setActionType('approve')}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      variant={actionType === 'reject' ? 'default' : 'outline'}
                                      className={actionType === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'border-[#3d3452]'}
                                      onClick={() => setActionType('reject')}
                                    >
                                      Reject
                                    </Button>
                                    <Button
                                      variant={actionType === 'requestInfo' ? 'default' : 'outline'}
                                      className={actionType === 'requestInfo' ? 'bg-blue-600 hover:bg-blue-700' : 'border-[#3d3452]'}
                                      onClick={() => setActionType('requestInfo')}
                                    >
                                      Request Info
                                    </Button>
                                  </div>

                                  {actionType === 'approve' && (
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium">Verification Level</label>
                                        <Select value={actionData.level} onValueChange={(v) => setActionData({ ...actionData, level: v })}>
                                          <SelectTrigger className="bg-[#1a1625] border-[#3d3452]">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent className="bg-[#241e33] border-[#3d3452] text-white">
                                            <SelectItem value="1">Level 1</SelectItem>
                                            <SelectItem value="2">Level 2</SelectItem>
                                            <SelectItem value="3">Level 3</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium">Internal Notes</label>
                                        <Textarea
                                          className="bg-[#1a1625] border-[#3d3452]"
                                          placeholder="Add any internal notes here..."
                                          value={actionData.notes}
                                          onChange={(e) => setActionData({ ...actionData, notes: e.target.value })}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {actionType === 'reject' && (
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium">Rejection Reason</label>
                                        <Input
                                          className="bg-[#1a1625] border-[#3d3452]"
                                          placeholder="e.g., Blurred ID document"
                                          value={actionData.rejectionReason ?? actionData.rejectionReason ?? ""}
                                          onChange={(e) => setActionData({ ...actionData, rejectionReason: e.target.value })}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium">Required Documents (comma separated)</label>
                                        <Input
                                          className="bg-[#1a1625] border-[#3d3452]"
                                          placeholder="e.g., Passport, Utility Bill"
                                          value={actionData.requiredDocuments}
                                          onChange={(e) => setActionData({ ...actionData, requiredDocuments: e.target.value })}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {actionType === 'requestInfo' && (
                                    <div className="space-y-2">
                                      <label className="text-sm font-medium">Message to User</label>
                                      <Textarea
                                        className="bg-[#1a1625] border-[#3d3452]"
                                        placeholder="Explain what additional information is needed..."
                                        value={actionData.message}
                                        onChange={(e) => setActionData({ ...actionData, message: e.target.value })}
                                      />
                                    </div>
                                  )}
                                </div>
                                <DialogFooter>
                                  <Button variant="ghost" onClick={() => setIsActionDialogOpen(false)}>Cancel</Button>
                                  <Button
                                    className="bg-purple-600 hover:bg-purple-700"
                                    onClick={handleAction}
                                    disabled={!actionType || approveMutation.isPending || rejectMutation.isPending || requestInfoMutation.isPending}
                                  >
                                    Confirm Action
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Timeline Drawer */}
        <Sheet open={isTimelineOpen} onOpenChange={setIsTimelineOpen}>
          <SheetContent className="bg-[#241e33] border-[#3d3452] text-white w-[400px] sm:w-[540px]">
            <SheetHeader>
              <SheetTitle className="text-white">KYC Timeline</SheetTitle>
              <SheetDescription className="text-gray-400">
                Historical progression of verification stages.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-8 space-y-6">
              {isTimelineLoading ? (
                <div className="flex justify-center py-10">
                  <Clock className="h-8 w-8 animate-spin text-purple-500" />
                </div>
              ) : timeline?.length === 0 ? (
                <div className="text-center py-10 text-gray-500">No history available.</div>
              ) : (
                timeline?.map((event: any, index: any) => (
                  <div key={index} className="relative pl-8 pb-6 border-l border-[#3d3452] last:border-0 last:pb-0">
                    <div className="absolute left-[-9px] top-0 h-4 w-4 rounded-full bg-[#241e33] border-2 border-purple-500 flex items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{event.stage.replace('_', ' ').toUpperCase()}</span>
                        <span className="text-xs text-gray-500">{format(new Date(event.timestamp), 'MMM dd, HH:mm')}</span>
                      </div>
                      <p className="text-sm text-gray-400">{event.description}</p>
                      {event.notes && (
                        <div className="mt-2 p-2 rounded bg-[#1a1625] text-xs text-gray-400 italic">
                          "{event.notes}"
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </DashboardLayout>
  );
}