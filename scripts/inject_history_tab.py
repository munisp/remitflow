#!/usr/bin/env python3
"""Inject Transfer History tab into BDCPartnerPortal.tsx"""

path = "/home/ubuntu/remitflow/client/src/pages/BDCPartnerPortal.tsx"

with open(path, "r") as f:
    content = f.read()

# 1. Add History icon import
old_icons = "  Building2, Plus, CheckCircle, Clock, XCircle, AlertTriangle,\n  DollarSign, TrendingUp, ArrowRightLeft, RefreshCw, Shield,\n  FileText, Banknote, Globe, Activity"
new_icons = "  Building2, Plus, CheckCircle, Clock, XCircle, AlertTriangle,\n  DollarSign, TrendingUp, ArrowRightLeft, RefreshCw, Shield,\n  FileText, Banknote, Globe, Activity, History, Filter"
content = content.replace(old_icons, new_icons)

# 2. Add listBdcLiquidityRequests query in BDCPartnerPortal component
old_query = "  const refresh = () => {"
new_query = """  // Transfer History state
  const [historyStatus, setHistoryStatus] = useState<string>("all");
  const [historyPartnerId, setHistoryPartnerId] = useState<number | undefined>(undefined);
  const { data: liquidityHistoryData, isLoading: loadingHistory, refetch: refetchHistory } =
    trpc.cbnCompliance.listBdcLiquidityRequests.useQuery({
      status: historyStatus === "all" ? undefined : historyStatus as any,
      bdcPartnerId: historyPartnerId,
      limit: 100,
    });
  const liquidityHistory = (liquidityHistoryData as any)?.rows ?? [];
  const liquidityTotal = (liquidityHistoryData as any)?.total ?? 0;

  const approveLiquidity = trpc.cbnCompliance.approveLiquidityRequest.useMutation({
    onSuccess: () => {
      toast({ title: "Request Updated", description: "Liquidity request status updated." });
      refetchHistory();
    },
    onError: (e) => toast({ title: "Update Failed", description: e.message, variant: "destructive" }),
  });

  const refresh = () => {"""
content = content.replace(old_query, new_query)

# 3. Add Transfer History TabsTrigger
old_triggers = "          {isAdmin && <TabsTrigger value=\"admin\">Admin Actions</TabsTrigger>}"
new_triggers = """          {isAdmin && <TabsTrigger value="history">Transfer History</TabsTrigger>}
          {isAdmin && <TabsTrigger value="admin">Admin Actions</TabsTrigger>}"""
content = content.replace(old_triggers, new_triggers)

# 4. Add Transfer History TabsContent before Admin tab
old_admin_tab = "        {/* Admin Tab */}\n        {isAdmin && ("
new_admin_tab = """        {/* Transfer History Tab */}
        {isAdmin && (
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="w-4 h-4" />
                    BDC Liquidity Transfer History
                    <Badge variant="secondary" className="ml-2">{liquidityTotal} total</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Select value={historyStatus} onValueChange={setHistoryStatus}>
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="disbursed">Disbursed</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
                      <RefreshCw className="w-3 h-3 mr-1" />Refresh
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading history...
                  </div>
                ) : liquidityHistory.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No liquidity requests found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left py-2 px-3">Date</th>
                          <th className="text-left py-2 px-3">Partner</th>
                          <th className="text-right py-2 px-3">Requested (USD)</th>
                          <th className="text-right py-2 px-3">Approved (USD)</th>
                          <th className="text-left py-2 px-3">Corridor</th>
                          <th className="text-right py-2 px-3">BMATCH Rate</th>
                          <th className="text-left py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Settlement Ref</th>
                          {isAdmin && <th className="text-left py-2 px-3">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {liquidityHistory.map((req: any) => (
                          <tr key={req.id} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {new Date(req.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3 font-medium">{req.partnerName ?? `BDC #${req.bdcPartnerId}`}</td>
                            <td className="py-2 px-3 text-right font-mono">
                              ${(req.requestedAmountUsd ?? 0).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-green-700">
                              {req.approvedAmountUsd != null ? `$${req.approvedAmountUsd.toLocaleString()}` : "—"}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant="outline" className="text-xs">{req.corridorCode ?? "—"}</Badge>
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-xs">
                              {req.bmatchRateAtRequest ?? "—"}
                            </td>
                            <td className="py-2 px-3">
                              <LiquidityStatusBadge status={req.status} />
                            </td>
                            <td className="py-2 px-3 text-xs font-mono text-muted-foreground">
                              {req.adbTransferReference ?? "—"}
                            </td>
                            {isAdmin && (
                              <td className="py-2 px-3">
                                {req.status === "pending" && (
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-xs px-2 text-green-700 border-green-300"
                                      disabled={approveLiquidity.isPending}
                                      onClick={() => approveLiquidity.mutate({
                                        requestId: req.id,
                                        approvedAmountUsd: req.requestedAmountUsd,
                                        action: "approve",
                                      })}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-xs px-2 text-red-700 border-red-300"
                                      disabled={approveLiquidity.isPending}
                                      onClick={() => approveLiquidity.mutate({
                                        requestId: req.id,
                                        approvedAmountUsd: 0,
                                        action: "reject",
                                      })}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                )}
                                {req.status === "approved" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs px-2 text-blue-700 border-blue-300"
                                    disabled={approveLiquidity.isPending}
                                    onClick={() => approveLiquidity.mutate({
                                      requestId: req.id,
                                      approvedAmountUsd: req.approvedAmountUsd ?? req.requestedAmountUsd,
                                      adbTransferReference: `ADB-${Date.now()}`,
                                      action: "disburse",
                                    })}
                                  >
                                    Mark Disbursed
                                  </Button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Admin Tab */}
        {isAdmin && ("""
content = content.replace(old_admin_tab, new_admin_tab)

with open(path, "w") as f:
    f.write(content)

print("BDCPartnerPortal.tsx updated successfully")
