#!/usr/bin/env python3
"""Inject Disburse All Approved bulk action into BDCPartnerPortal Transfer History tab"""

path = "/home/ubuntu/remitflow/client/src/pages/BDCPartnerPortal.tsx"

with open(path, "r") as f:
    content = f.read()

# 1. Add bulkDisburse mutation after approveLiquidity mutation
old_mutation_end = """  const refresh = () => {
    refetchPartners();"""
new_mutation_end = """  const bulkDisburse = trpc.cbnCompliance.bulkDisburseLiquidityRequests.useMutation({
    onSuccess: (data: any) => {
      toast({
        title: "Bulk Disburse Complete",
        description: `${data.disbursed} requests disbursed. Total: $${(data.totalUsd ?? 0).toLocaleString()} USD. Batch: ${data.batchRef}`,
      });
      refetchHistory();
    },
    onError: (e) => toast({ title: "Bulk Disburse Failed", description: e.message, variant: "destructive" }),
  });

  const approvedCount = liquidityHistory.filter((r: any) => r.status === "approved").length;

  const refresh = () => {
    refetchPartners();"""
content = content.replace(old_mutation_end, new_mutation_end)

# 2. Add Disburse All Approved button in the Transfer History CardHeader next to Refresh
old_refresh_btn = """                    <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
                      <RefreshCw className="w-3 h-3 mr-1" />Refresh
                    </Button>"""
new_refresh_btn = """                    {approvedCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => bulkDisburse.mutate({})}
                        disabled={bulkDisburse.isPending}
                      >
                        <DollarSign className="w-3 h-3 mr-1" />
                        {bulkDisburse.isPending ? "Disbursing..." : `Disburse All Approved (${approvedCount})`}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
                      <RefreshCw className="w-3 h-3 mr-1" />Refresh
                    </Button>"""
content = content.replace(old_refresh_btn, new_refresh_btn)

with open(path, "w") as f:
    f.write(content)

print("BDCPartnerPortal.tsx bulk disburse injected successfully")
