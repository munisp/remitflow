"""
Inject rate alert history table and re-arm button into CbnComplianceDashboard.tsx
"""
import re

DASHBOARD = "/home/ubuntu/remitflow/client/src/pages/CbnComplianceDashboard.tsx"

with open(DASHBOARD, "r") as f:
    content = f.read()

# 1. Add useCallback to imports
old_import = "import { useState, useEffect } from \"react\";"
new_import = "import { useState, useEffect, useCallback } from \"react\";"
content = content.replace(old_import, new_import)

# 2. Add resetRateAlert mutation and listRateAlertHistory query after checkAlerts mutation
old_hooks = """  const checkAlerts = trpc.cbnCompliance.checkRateAlerts.useMutation({"""
new_hooks = """  const resetAlert = trpc.cbnCompliance.resetRateAlert.useMutation({
    onSuccess: (data) => {
      toast({ title: "Alert Re-armed", description: `Alert for ${data.pair} is now active again.` });
      refetchAlerts();
      refetchAlertHistory();
    },
    onError: (e) => toast({ title: "Re-arm Failed", description: e.message, variant: "destructive" }),
  });

  const { data: alertHistoryData, refetch: refetchAlertHistory } = trpc.cbnCompliance.listRateAlertHistory.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const alertHistory = alertHistoryData?.items ?? [];
  const alertHistoryTotal = alertHistoryData?.total ?? 0;

  const checkAlerts = trpc.cbnCompliance.checkRateAlerts.useMutation({"""
content = content.replace(old_hooks, new_hooks, 1)

# 3. Add Alert History card before the closing </TabsContent> of the alerts tab
# The closing pattern is: </Card>\n          </div>\n        </TabsContent>
old_close = """              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>"""

new_close = """              </CardContent>
            </Card>

            {/* Rate Alert History */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-orange-400" />
                  Triggered Alert History
                  <Badge className="bg-orange-500/20 text-orange-300 ml-2">{alertHistoryTotal} triggered</Badge>
                </CardTitle>
                <CardDescription className="text-white/50">
                  All alerts that have fired. Use Re-arm to allow them to trigger again.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {alertHistory.length === 0 ? (
                  <div className="text-center py-10 text-white/40">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No alerts have triggered yet.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10 hover:bg-white/5">
                        <TableHead className="text-white/60">Pair</TableHead>
                        <TableHead className="text-white/60">Direction</TableHead>
                        <TableHead className="text-white/60">Threshold</TableHead>
                        <TableHead className="text-white/60">Triggered At</TableHead>
                        <TableHead className="text-white/60">Status</TableHead>
                        <TableHead className="text-white/60">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {alertHistory.map((h: any) => (
                        <TableRow key={h.id} className="border-white/10 hover:bg-white/5">
                          <TableCell className="text-white font-mono font-semibold">{h.pair}</TableCell>
                          <TableCell>
                            <Badge className={h.direction === "above" ? "bg-red-500/20 text-red-300" : "bg-blue-500/20 text-blue-300"}>
                              {h.direction === "above" ? "↑ Above" : "↓ Below"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-white/80 font-mono">{parseFloat(h.targetRate).toLocaleString()}</TableCell>
                          <TableCell className="text-white/60 text-xs">
                            {h.triggeredAt ? new Date(h.triggeredAt).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge className={h.isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/50"}>
                              {h.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10 text-xs"
                              onClick={() => resetAlert.mutate({ id: h.id })}
                              disabled={resetAlert.isPending}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Re-arm
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>"""

content = content.replace(old_close, new_close, 1)

# 4. Add History and RotateCcw to lucide-react imports
old_lucide = "import {"
# Find the lucide-react import block
lucide_start = content.find("} from \"lucide-react\";")
lucide_block_start = content.rfind("import {", 0, lucide_start)
lucide_block = content[lucide_block_start:lucide_start + len("} from \"lucide-react\";")]

if "History" not in lucide_block:
    # Add History and RotateCcw to the lucide import
    new_lucide_block = lucide_block.replace("} from \"lucide-react\";", ", History, RotateCcw } from \"lucide-react\";")
    content = content.replace(lucide_block, new_lucide_block, 1)
    print("Added History and RotateCcw to lucide imports")
else:
    print("History already in lucide imports")

with open(DASHBOARD, "w") as f:
    f.write(content)

print("Injection complete")
