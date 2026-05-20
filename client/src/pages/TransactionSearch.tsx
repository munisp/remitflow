import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, Download, Filter, X, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "NGN", "GHS", "KES", "ZAR", "XOF", "EGP"];

export default function TransactionSearch() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [fromCurrency, setFromCurrency] = useState("");
  const [toCurrency, setToCurrency] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"createdAt" | "fromAmount" | "status">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [applied, setApplied] = useState(false);

  const searchInput = {
    query: query || undefined,
    status: status as any,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    minAmount: minAmount ? parseFloat(minAmount) : undefined,
    maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
    fromCurrency: fromCurrency || undefined,
    toCurrency: toCurrency || undefined,
    page,
    limit: 20,
    sortBy,
    sortDir,
  };

  const { data, isLoading, refetch } = trpc.txSearch.search.useQuery(searchInput, {
    enabled: applied,
  });

  const exportMutation = trpc.txSearch.exportCsv.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${result.count} transactions`);
    },
  });

  const handleSearch = useCallback(() => {
    setPage(1);
    setApplied(true);
    refetch();
  }, [refetch]);

  const handleClear = () => {
    setQuery(""); setStatus("all"); setFromDate(""); setToDate("");
    setMinAmount(""); setMaxAmount(""); setFromCurrency(""); setToCurrency("");
    setPage(1); setApplied(false);
  };

  const toggleSort = (field: "createdAt" | "fromAmount" | "status") => {
    if (sortBy === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("desc"); }
  };

  const transfers = data?.transfers ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const hasFilters = query || status !== "all" || fromDate || toDate || minAmount || maxAmount || fromCurrency || toCurrency;

  return (
    <DashboardLayout>
      <div className="space-y-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Transaction Search</h1>
            <p className="text-muted-foreground text-sm mt-1">Search and filter all your transfers</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMutation.mutate({ fromDate: fromDate || undefined, toDate: toDate || undefined, status })}
            disabled={exportMutation.isPending}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Search Bar */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by reference, beneficiary name, account number..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="w-4 h-4 mr-2" />
                Filters
                {hasFilters && <span className="ml-1 w-2 h-2 rounded-full bg-purple-500 inline-block" />}
              </Button>
              <Button onClick={handleSearch}>
                <Search className="w-4 h-4 mr-2" />
                Search
              </Button>
              {hasFilters && (
                <Button variant="ghost" onClick={handleClear}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs mb-1.5 block">From Date</Label>
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">To Date</Label>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Min Amount (USD)</Label>
                  <Input type="number" placeholder="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Max Amount (USD)</Label>
                  <Input type="number" placeholder="10000" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">From Currency</Label>
                  <Select value={fromCurrency || "all"} onValueChange={(v) => setFromCurrency(v === "all" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any</SelectItem>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">To Currency</Label>
                  <Select value={toCurrency || "all"} onValueChange={(v) => setToCurrency(v === "all" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any</SelectItem>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>
                {applied ? (
                  isLoading ? "Searching..." : `${total.toLocaleString()} result${total !== 1 ? "s" : ""}`
                ) : "Enter search criteria above"}
              </span>
              {applied && total > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!applied ? (
              <div className="py-16 text-center text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Use the search bar above to find transactions</p>
                <p className="text-xs mt-1">Search by reference, beneficiary, or use filters for advanced queries</p>
              </div>
            ) : isLoading ? (
              <div className="py-16 text-center text-muted-foreground">
                <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm">Searching transactions...</p>
              </div>
            ) : transfers.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No transactions found</p>
                <p className="text-xs mt-1">Try adjusting your search criteria</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Reference</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Beneficiary</th>
                      <th
                        className="text-right px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("fromAmount")}
                      >
                        <span className="flex items-center justify-end gap-1">
                          Amount <ArrowUpDown className="w-3 h-3" />
                        </span>
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Received</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        <span
                          className="flex items-center gap-1 cursor-pointer hover:text-foreground"
                          onClick={() => toggleSort("status")}
                        >
                          Status <ArrowUpDown className="w-3 h-3" />
                        </span>
                      </th>
                      <th
                        className="text-left px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("createdAt")}
                      >
                        <span className="flex items-center gap-1">
                          Date <ArrowUpDown className="w-3 h-3" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map((t: any) => (
                      <tr key={t.id} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{t.reference}</code>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{t.beneficiary_name ?? "—"}</p>
                          {t.bank_name && <p className="text-xs text-muted-foreground">{t.bank_name}</p>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-semibold">{t.from_currency} {Number(t.amount).toLocaleString()}</p>
                          {t.fee && <p className="text-xs text-muted-foreground">Fee: {t.from_currency} {Number(t.fee).toFixed(2)}</p>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-medium text-green-600">{t.to_currency} {Number(t.to_amount ?? 0).toLocaleString()}</p>
                          {t.exchange_rate && <p className="text-xs text-muted-foreground">@ {Number(t.exchange_rate).toFixed(4)}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? STATUS_COLORS.pending}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {t.created_at ? new Date(t.created_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {applied && totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, total)} of {total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-xs">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
