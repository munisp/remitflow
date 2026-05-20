#!/usr/bin/env python3
"""Inject Rate Alerts tab into CbnComplianceDashboard.tsx"""

path = "/home/ubuntu/remitflow/client/src/pages/CbnComplianceDashboard.tsx"

with open(path, "r") as f:
    content = f.read()

# 1. Add Bell icon import
old_icons = "  ShieldCheck, TrendingUp, Building2, FileText, AlertTriangle,\n  Plus, RefreshCw, Download, CheckCircle2, Clock, XCircle,\n  BarChart3, Globe, Zap, Lock"
new_icons = "  ShieldCheck, TrendingUp, Building2, FileText, AlertTriangle,\n  Plus, RefreshCw, Download, CheckCircle2, Clock, XCircle,\n  BarChart3, Globe, Zap, Lock, Bell, BellOff, Trash2"
content = content.replace(old_icons, new_icons)

# 2. Add rate alert queries after the activeTab state
old_state = "  const [activeTab, setActiveTab] = useState(\"overview\");"
new_state = """  const [activeTab, setActiveTab] = useState("overview");

  // ── Rate Alerts state ──────────────────────────────────────────────────────
  const [alertFromCurrency, setAlertFromCurrency] = useState("USD");
  const [alertToCurrency, setAlertToCurrency] = useState("NGN");
  const [alertTargetRate, setAlertTargetRate] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");

  const { data: rateAlertsData, refetch: refetchAlerts } = trpc.cbnCompliance.listRateAlerts.useQuery({ activeOnly: false });
  const rateAlerts = (rateAlertsData as any[]) ?? [];

  const createAlert = trpc.cbnCompliance.createRateAlert.useMutation({
    onSuccess: () => {
      toast({ title: "Rate Alert Created", description: "You will be notified when the threshold is breached." });
      setAlertTargetRate("");
      refetchAlerts();
    },
    onError: (e) => toast({ title: "Failed to Create Alert", description: e.message, variant: "destructive" }),
  });

  const deleteAlert = trpc.cbnCompliance.deleteRateAlert.useMutation({
    onSuccess: () => {
      toast({ title: "Alert Deactivated" });
      refetchAlerts();
    },
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const checkAlerts = trpc.cbnCompliance.checkRateAlerts.useMutation({
    onSuccess: (data: any) => {
      toast({
        title: `Alert Check Complete`,
        description: `Checked ${data.checked} alerts. ${data.triggered} triggered. Live rate: ${data.liveRate?.toFixed(4) ?? "N/A"}`,
      });
      refetchAlerts();
    },
    onError: (e) => toast({ title: "Check Failed", description: e.message, variant: "destructive" }),
  });"""
content = content.replace(old_state, new_state)

# 3. Add Rate Alerts TabsTrigger
old_last_trigger = """          <TabsTrigger value="funding" className="data-[state=active]:bg-white/10">"""
new_last_trigger = """          <TabsTrigger value="alerts" className="data-[state=active]:bg-white/10">
            <Bell className="w-4 h-4 mr-2" />Rate Alerts
          </TabsTrigger>
          <TabsTrigger value="funding" className="data-[state=active]:bg-white/10">"""
content = content.replace(old_last_trigger, new_last_trigger)

# 4. Add Rate Alerts TabsContent before closing </Tabs>
old_closing = """      </Tabs>
    </div>
  );
}"""
new_closing = """        {/* Rate Alerts Tab */}
        <TabsContent value="alerts">
          <div className="space-y-6">
            {/* Create Alert Form */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Bell className="w-5 h-5 text-yellow-400" />
                  Create CBN Corridor Rate Alert
                </CardTitle>
                <CardDescription className="text-white/60">
                  Get notified via owner notification when a corridor rate crosses your threshold.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">From Currency</Label>
                    <Select value={alertFromCurrency} onValueChange={setAlertFromCurrency}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="NGN">NGN</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">To Currency</Label>
                    <Select value={alertToCurrency} onValueChange={setAlertToCurrency}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NGN">NGN</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">Direction</Label>
                    <Select value={alertDirection} onValueChange={(v) => setAlertDirection(v as "above" | "below")}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="above">Rate goes above</SelectItem>
                        <SelectItem value="below">Rate goes below</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-white/70 text-xs mb-1 block">Target Rate</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      placeholder="e.g. 1600.00"
                      value={alertTargetRate}
                      onChange={(e) => setAlertTargetRate(e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                  <Button
                    onClick={() => createAlert.mutate({
                      fromCurrency: alertFromCurrency,
                      toCurrency: alertToCurrency,
                      targetRate: parseFloat(alertTargetRate),
                      direction: alertDirection,
                    })}
                    disabled={createAlert.isPending || !alertTargetRate || isNaN(parseFloat(alertTargetRate))}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                  >
                    <Bell className="w-4 h-4 mr-2" />
                    {createAlert.isPending ? "Creating..." : "Create Alert"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Active Alerts Table */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Bell className="w-5 h-5 text-emerald-400" />
                    Active Rate Alerts
                    <Badge className="bg-yellow-500/20 text-yellow-300 ml-2">{rateAlerts.filter((a: any) => a.isActive).length} active</Badge>
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/20 text-white hover:bg-white/10"
                    onClick={() => checkAlerts.mutate()}
                    disabled={checkAlerts.isPending}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    {checkAlerts.isPending ? "Checking..." : "Check Now"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {rateAlerts.length === 0 ? (
                  <div className="text-center py-12 text-white/40">
                    <BellOff className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No rate alerts configured yet.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead className="text-white/60">Pair</TableHead>
                        <TableHead className="text-white/60">Direction</TableHead>
                        <TableHead className="text-white/60 text-right">Target Rate</TableHead>
                        <TableHead className="text-white/60">Status</TableHead>
                        <TableHead className="text-white/60">Triggered At</TableHead>
                        <TableHead className="text-white/60">Created</TableHead>
                        <TableHead className="text-white/60">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateAlerts.map((alert: any) => (
                        <TableRow key={alert.id} className="border-white/5 hover:bg-white/5">
                          <TableCell className="font-mono font-semibold text-white">
                            {alert.fromCurrency}/{alert.toCurrency}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={alert.direction === "above"
                                ? "bg-green-500/20 text-green-300"
                                : "bg-red-500/20 text-red-300"}
                            >
                              {alert.direction === "above" ? "↑ Above" : "↓ Below"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-emerald-300">
                            {parseFloat(String(alert.targetRate)).toLocaleString("en-US", { minimumFractionDigits: 4 })}
                          </TableCell>
                          <TableCell>
                            {alert.isActive ? (
                              <Badge className="bg-emerald-500/20 text-emerald-300">
                                <Bell className="w-3 h-3 mr-1" />Active
                              </Badge>
                            ) : (
                              <Badge className="bg-white/10 text-white/40">
                                <BellOff className="w-3 h-3 mr-1" />Inactive
                              </Badge>
                            )}
                            {alert.notificationSent && (
                              <Badge className="bg-yellow-500/20 text-yellow-300 ml-1">
                                <Zap className="w-3 h-3 mr-1" />Triggered
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-white/60 text-xs">
                            {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-white/40 text-xs">
                            {new Date(alert.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {alert.isActive && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => deleteAlert.mutate({ alertId: alert.id })}
                                disabled={deleteAlert.isPending}
                              >
                                <Trash2 className="w-3 h-3 mr-1" />Deactivate
                              </Button>
                            )}
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
      </Tabs>
    </div>
  );
}"""
content = content.replace(old_closing, new_closing)

with open(path, "w") as f:
    f.write(content)

print("CbnComplianceDashboard.tsx updated successfully")
