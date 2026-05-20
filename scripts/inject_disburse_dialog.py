#!/usr/bin/env python3
"""Inject AlertDialog confirmation before bulk disburse mutation in BDCPartnerPortal.tsx"""

path = "/home/ubuntu/remitflow/client/src/pages/BDCPartnerPortal.tsx"

with open(path, "r") as f:
    content = f.read()

# 1. Add AlertDialog import if not already present
if "AlertDialog" not in content:
    content = content.replace(
        'import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";',
        'import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";\nimport {\n  AlertDialog,\n  AlertDialogAction,\n  AlertDialogCancel,\n  AlertDialogContent,\n  AlertDialogDescription,\n  AlertDialogFooter,\n  AlertDialogHeader,\n  AlertDialogTitle,\n  AlertDialogTrigger,\n} from "@/components/ui/alert-dialog";'
    )
    print("Added AlertDialog import")
else:
    print("AlertDialog already imported")

# 2. Add showDisburseDialog state variable after bulkDisburse mutation definition
old_approved_count = "  const liquidityApprovedCount = liquidityHistory.filter((r: any) => r.status === \"approved\").length;"
new_approved_count = '  const liquidityApprovedCount = liquidityHistory.filter((r: any) => r.status === "approved").length;\n  const [showDisburseDialog, setShowDisburseDialog] = React.useState(false);'
content = content.replace(old_approved_count, new_approved_count)

# 3. Replace the Disburse All Approved button with AlertDialog-wrapped version
old_button = '''{liquidityApprovedCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => bulkDisburse.mutate({})}
                        disabled={bulkDisburse.isPending}
                      >
                        <DollarSign className="w-3 h-3 mr-1" />
                        {bulkDisburse.isPending ? "Disbursing..." : `Disburse All Approved (${liquidityApprovedCount})`}
                      </Button>
                    )}'''

new_button = '''{liquidityApprovedCount > 0 && (
                      <AlertDialog open={showDisburseDialog} onOpenChange={setShowDisburseDialog}>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            disabled={bulkDisburse.isPending}
                          >
                            <DollarSign className="w-3 h-3 mr-1" />
                            {bulkDisburse.isPending ? "Disbursing..." : `Disburse All Approved (${liquidityApprovedCount})`}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Bulk Disburse</AlertDialogTitle>
                            <AlertDialogDescription>
                              You are about to disburse <strong>{liquidityApprovedCount} approved</strong> liquidity request{liquidityApprovedCount !== 1 ? "s" : ""}.
                              Each request will be assigned an ADB transfer reference and marked as disbursed.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                setShowDisburseDialog(false);
                                bulkDisburse.mutate({});
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                              Confirm Disburse
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}'''

if old_button in content:
    content = content.replace(old_button, new_button)
    print("Disburse button replaced with AlertDialog")
else:
    print("WARNING: Disburse button not found — checking for variant")
    # Try to find the button in a slightly different form
    import re
    pattern = r'\{liquidityApprovedCount > 0 && \('
    match = re.search(pattern, content)
    if match:
        print(f"Found at position {match.start()}, context:")
        print(repr(content[match.start():match.start()+400]))
    else:
        print("Pattern not found")

# 4. Ensure React is imported (for useState)
if "import React" not in content and "import * as React" not in content:
    content = content.replace(
        'import { useState,',
        'import React, { useState,'
    )
    if "import React" not in content:
        content = content.replace(
            'import { useState ',
            'import React, { useState '
        )
        if "import React" not in content:
            # Add React import at the top
            content = 'import React from "react";\n' + content
            print("Added React import")

with open(path, "w") as f:
    f.write(content)

print("BDCPartnerPortal.tsx AlertDialog injection complete")
