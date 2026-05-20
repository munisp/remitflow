#!/usr/bin/env python3
"""Fix approvedCount variable name conflict in BDCPartnerPortal.tsx"""

path = "/home/ubuntu/remitflow/client/src/pages/BDCPartnerPortal.tsx"

with open(path, "r") as f:
    content = f.read()

# Rename the liquidity-specific approvedCount to liquidityApprovedCount
content = content.replace(
    "  const approvedCount = liquidityHistory.filter((r: any) => r.status === \"approved\").length;",
    "  const liquidityApprovedCount = liquidityHistory.filter((r: any) => r.status === \"approved\").length;"
)

# Update all references to the liquidity-specific approvedCount in the bulk disburse section
content = content.replace(
    "    onSuccess: (data: any) => {\n      toast({\n        title: \"Bulk Disburse Complete\",",
    "    onSuccess: (data: any) => {\n      toast({\n        title: \"Bulk Disburse Complete\","
)

# Fix the approvedCount usage in the button
content = content.replace(
    "{approvedCount > 0 && (\n                      <Button\n                        variant=\"outline\"\n                        size=\"sm\"\n                        className=\"border-blue-300 text-blue-700 hover:bg-blue-50\"\n                        onClick={() => bulkDisburse.mutate({})}\n                        disabled={bulkDisburse.isPending}\n                      >\n                        <DollarSign className=\"w-3 h-3 mr-1\" />\n                        {bulkDisburse.isPending ? \"Disbursing...\" : `Disburse All Approved (${approvedCount})`}\n                      </Button>\n                    )}",
    "{liquidityApprovedCount > 0 && (\n                      <Button\n                        variant=\"outline\"\n                        size=\"sm\"\n                        className=\"border-blue-300 text-blue-700 hover:bg-blue-50\"\n                        onClick={() => bulkDisburse.mutate({})}\n                        disabled={bulkDisburse.isPending}\n                      >\n                        <DollarSign className=\"w-3 h-3 mr-1\" />\n                        {bulkDisburse.isPending ? \"Disbursing...\" : `Disburse All Approved (${liquidityApprovedCount})`}\n                      </Button>\n                    )}"
)

with open(path, "w") as f:
    f.write(content)

print("approvedCount conflict fixed")
