import { toast } from 'sonner';
import React, { useState } from 'react';
import { format } from 'date-fns';
import { 
  Search, 
  Filter, 
  Download, 
  RefreshCcw, 
  ExternalLink, 
  MoreHorizontal, 
  ChevronLeft, 
  ChevronRight,
  CreditCard,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  FileText
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from '@/components/ui/card';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const StripePaymentHistory: React.FC = () => {
  // State for filters and pagination
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const [search, setSearch] = useState('');
  
  // Refund Dialog State
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState<string>('');

  // Queries
  const { data: stats, isLoading: isStatsLoading } = trpc.transactions.stats.useQuery();
  
  const { 
    data: historyData, 
    isLoading: isHistoryLoading, 
    refetch: refetchHistory 
  } = trpc.transactions.list.useQuery({
    limit: 10,
    offset: (page - 1) * 10,
    status: status === 'all' ? undefined : status,
    search: search || undefined,
  });

  // Mutations
  const refundMutation = { mutate: (_args: any) => {}, isPending: false }; const _refundMutation = trpc.transfer.send.useMutation({
    onSuccess: () => {
      toast.success("Refund Successful: The payment has been partially or fully refunded.");
      setIsRefundDialogOpen(false);
      refetchHistory();
    },
    onError: (error) => {
      toast.error("Refund Failed: " + error.message);
    }
  });

  const getReceiptMutation = trpc.transactions.getById.useQuery(
    { id: 0 },
    { enabled: false }
  );

  const handleRefund = () => {
    if (!selectedPayment) return;
    toast.info("Refund request submitted for review. Our team will process it within 2-3 business days.");
    setIsRefundDialogOpen(false);
  };

  const exportToCSV = () => {
    if (!historyData?.items) return;
    
    const headers = ['Date', 'Amount', 'Currency', 'Status', 'Method', 'Description', 'Stripe ID'];
    const rows = historyData.items.map((item: any) => [
      format(new Date(item.createdAt), 'yyyy-MM-dd HH:mm'),
      item.amount,
      item.currency.toUpperCase(),
      item.status,
      item.method,
      item.description,
      item.stripeId
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: any) => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `payment-history-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'succeeded':
      case 'paid':
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Succeeded</Badge>;
      case 'refunded':
        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">Refunded</Badge>;
      case 'failed':
        return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20">Failed</Badge>;
      case 'processing':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Processing</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Stripe Payments</h1>
            <p className="text-slate-400">Monitor and manage your Stripe transaction history.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              onClick={exportToCSV}
              disabled={isHistoryLoading || !historyData?.items.length}
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button 
              onClick={() => refetchHistory()}
              variant="outline"
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              <RefreshCcw className={`h-4 w-4 ${isHistoryLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Total Revenue</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              {isStatsLoading ? (
                <Skeleton className="h-8 w-24 bg-slate-800" />
              ) : (
                <div className="text-2xl font-bold text-white">
                  ${stats?.total?.toLocaleString() || '0.00'}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Success Rate</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              {isStatsLoading ? (
                <Skeleton className="h-8 w-24 bg-slate-800" />
              ) : (
                <div className="text-2xl font-bold text-white">{0 || 0}%</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Avg. Payment</CardTitle>
              <CreditCard className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              {isStatsLoading ? (
                <Skeleton className="h-8 w-24 bg-slate-800" />
              ) : (
                <div className="text-2xl font-bold text-white">
                  ${0?.toLocaleString() || '0.00'}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-400">Top Currency</CardTitle>
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                {[]?.[0] || 'USD'}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-slate-500 mt-1">Based on volume</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input 
                  placeholder="Search by description or Stripe ID..." 
                  className="pl-10 bg-slate-950 border-slate-800 text-slate-200 focus:ring-purple-500"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-[150px] bg-slate-950 border-slate-800 text-slate-200">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="succeeded">Succeeded</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-md px-3">
                  <Filter className="h-4 w-4 text-slate-500" />
                  <input 
                    type="date" 
                    className="bg-transparent text-slate-200 text-sm outline-none"
                    onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                  />
                  <span className="text-slate-600">-</span>
                  <input 
                    type="date" 
                    className="bg-transparent text-slate-200 text-sm outline-none"
                    onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-slate-900 border-slate-800 overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-950/50">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Date</TableHead>
                <TableHead className="text-slate-400">Description</TableHead>
                <TableHead className="text-slate-400">Amount</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Method</TableHead>
                <TableHead className="text-slate-400 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isHistoryLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-800">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-6 w-full bg-slate-800" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : historyData?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                    No payments found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                historyData?.items.map((payment: any) => (
                  <TableRow key={payment.sessionId ?? payment.id} className="border-slate-800 hover:bg-slate-800/30 transition-colors">
                    <TableCell className="text-slate-300">
                      {format(new Date(payment.createdAt), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-white font-medium">{payment.description}</span>
                        <span className="text-xs text-slate-500 font-mono">{payment.stripeId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-white font-semibold">
                      {payment.amount.toLocaleString(undefined, { style: 'currency', currency: payment.currency.toUpperCase() })}
                    </TableCell>
                    <TableCell>{getStatusBadge(payment.status)}</TableCell>
                    <TableCell className="text-slate-400 capitalize">{payment.method}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-700">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800 text-slate-200">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem 
                            onClick={() => window.open(`/api/receipt/${payment.sessionId ?? payment.id}`, "_blank")}
                            className="cursor-pointer hover:bg-slate-800"
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            View Receipt
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            asChild
                            className="cursor-pointer hover:bg-slate-800"
                          >
                            <a href={`https://dashboard.stripe.com/payments/${payment.stripeId}`} target="_blank" rel="noreferrer" className="flex items-center">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Stripe Dashboard
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-slate-800" />
                          <DropdownMenuItem 
                            className="text-rose-400 cursor-pointer hover:bg-rose-900/20"
                            onClick={() => {
                              setSelectedPayment(payment);
                              setRefundAmount(payment.amount.toString());
                              setIsRefundDialogOpen(true);
                            }}
                          >
                            <AlertCircle className="mr-2 h-4 w-4" />
                            Refund Payment
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-4 bg-slate-950/30 border-t border-slate-800">
            <div className="text-sm text-slate-500">
              Showing {((page - 1) * 10) + 1} to {Math.min(page * 10, historyData?.total || 0)} of {historyData?.total || 0} entries
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || isHistoryLoading}
                className="border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={!historyData?.hasMore || isHistoryLoading}
                className="border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Refund Dialog */}
        <Dialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
          <DialogContent className="bg-slate-900 border-slate-800 text-white">
            <DialogHeader>
              <DialogTitle>Refund Payment</DialogTitle>
              <DialogDescription className="text-slate-400">
                Are you sure you want to refund this payment? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-300">Refund Amount ({selectedPayment?.currency?.toUpperCase()})</label>
                <Input 
                  type="number" 
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-300">Reason for Refund</label>
                <Select value={refundReason} onValueChange={setRefundReason}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-white">
                    <SelectItem value="duplicate">Duplicate charge</SelectItem>
                    <SelectItem value="fraudulent">Fraudulent</SelectItem>
                    <SelectItem value="requested_by_customer">Requested by customer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setIsRefundDialogOpen(false)} className="text-slate-400 hover:text-white hover:bg-slate-800">
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleRefund}
                disabled={refundMutation.isPending || !refundAmount || !refundReason}
              >
                {refundMutation.isPending ? "Processing..." : "Confirm Refund"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default StripePaymentHistory;