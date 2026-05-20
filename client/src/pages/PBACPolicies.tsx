import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, CheckCircle, XCircle, AlertTriangle, Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const RESOURCE_ACTIONS = [
  { resource: "transfer", action: "send", label: "Transfer: Send" },
  { resource: "transfer", action: "bulkSend", label: "Transfer: Bulk Send" },
  { resource: "wallet", action: "withdraw", label: "Wallet: Withdraw" },
  { resource: "wallet", action: "topup", label: "Wallet: Top-Up" },
  { resource: "beneficiary", action: "create", label: "Beneficiary: Create" },
  { resource: "beneficiary", action: "update", label: "Beneficiary: Update" },
  { resource: "beneficiary", action: "delete", label: "Beneficiary: Delete" },
  { resource: "kyc", action: "approve", label: "KYC: Approve" },
  { resource: "kyc", action: "reject", label: "KYC: Reject" },
  { resource: "report", action: "export", label: "Report: Export" },
  { resource: "admin", action: "*", label: "Admin: All Actions" },
  { resource: "dispute", action: "resolve", label: "Dispute: Resolve" },
  { resource: "compliance", action: "exportSAR", label: "Compliance: Export SAR" },
  { resource: "virtualAccount", action: "create", label: "Virtual Account: Create" },
];

const KYC_TIERS = ["0", "1", "2", "3"];
const ROLES = ["user", "admin", "partner"];

export default function PBACPolicies() {
  const [selectedResource, setSelectedResource] = useState("transfer");
  const [selectedAction, setSelectedAction] = useState("send");
  const [testRole, setTestRole] = useState("user");
  const [testKycTier, setTestKycTier] = useState("1");
  const [testAmount, setTestAmount] = useState("500");
  const [test2FA, setTest2FA] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [checkEnabled, setCheckEnabled] = useState(false);

  const myPolicies = trpc.pbac.myPolicies.useQuery();
  const checkPolicy = trpc.pbac.check.useQuery(
    { action: selectedAction, resource: { type: selectedResource, amount: parseFloat(testAmount) || 0 } },
    { enabled: checkEnabled }
  );

  const handleTestPolicy = () => {
    setCheckEnabled(true);
    // Refetch to get fresh result
    checkPolicy.refetch().then((result) => {
      setCheckEnabled(false);
      if (!result.data) return;
      if (result.data.allowed) {
        toast.success(`Policy ALLOWED: ${selectedResource}.${selectedAction}`, {
          description: `Reason: ${result.data.reason || "Policy conditions met"}`,
        });
      } else {
        toast.error(`Policy DENIED: ${selectedResource}.${selectedAction}`, {
          description: `Reason: ${result.data.reason}${result.data.requiresMFA ? " (2FA required)" : ""}`,
        });
      }
    }).catch((e: Error) => {
      setCheckEnabled(false);
      toast.error("Policy check failed", { description: e.message });
    });
  };

  const filteredActions = RESOURCE_ACTIONS.filter(
    (ra) =>
      ra.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ra.resource.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const myPoliciesData = myPolicies.data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-500" />
            PBAC Policy Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Policy-Based Access Control — inspect and test all 14 resource policies
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => myPolicies.refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* My Entitlements */}
      {myPoliciesData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Entitlements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {RESOURCE_ACTIONS.map((ra) => {
                const allowed = ra.resource === "transfer" ? myPoliciesData.canSendMoney :
                  ra.resource === "wallet" && ra.action === "withdraw" ? myPoliciesData.canWithdraw :
                  ra.resource === "wallet" && ra.action === "topup" ? true :
                  ra.resource === "beneficiary" ? myPoliciesData.canSendMoney :
                  myPoliciesData.role === "admin";
                return (
                  <div
                    key={`${ra.resource}.${ra.action}`}
                    className={`flex items-center gap-2 p-2 rounded-md border text-xs ${
                      allowed
                        ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                        : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                    }`}
                  >
                    {allowed ? (
                      <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                    )}
                    <span className="font-mono truncate">
                      {ra.resource}.{ra.action}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">
                KYC Tier {myPoliciesData.kycTier ?? "—"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Role: {myPoliciesData.role ?? "—"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Daily Limit: ${myPoliciesData.dailyTransferLimit?.toLocaleString() ?? "—"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Remaining: ${myPoliciesData.dailyRemaining?.toLocaleString() ?? "—"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Policy Tester */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Policy Simulator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search policies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Resource & Action</label>
              <Select
                value={`${selectedResource}.${selectedAction}`}
                onValueChange={(v) => {
                  const [r, a] = v.split(".");
                  setSelectedResource(r);
                  setSelectedAction(a);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {filteredActions.map((ra) => (
                    <SelectItem key={`${ra.resource}.${ra.action}`} value={`${ra.resource}.${ra.action}`}>
                      {ra.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Test Role</label>
              <Select value={testRole} onValueChange={setTestRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">KYC Tier</label>
              <Select value={testKycTier} onValueChange={setTestKycTier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KYC_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      Tier {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Amount (USD)</label>
              <Input
                type="number"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
                placeholder="500"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={test2FA}
                onChange={(e) => setTest2FA(e.target.checked)}
                className="rounded"
              />
              2FA Verified
            </label>
          </div>

          <Button
            onClick={handleTestPolicy}
            disabled={checkPolicy.isFetching}
            className="w-full"
          >
            {checkPolicy.isFetching ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Shield className="h-4 w-4 mr-2" />
            )}
            Simulate Policy Check
          </Button>
        </CardContent>
      </Card>

      {/* Policy Reference Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policy Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium">Resource.Action</th>
                  <th className="text-left py-2 pr-4 font-medium">Min KYC Tier</th>
                  <th className="text-left py-2 pr-4 font-medium">Role Required</th>
                  <th className="text-left py-2 pr-4 font-medium">2FA Threshold</th>
                  <th className="text-left py-2 font-medium">Daily Limit</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr><td className="py-2 pr-4 font-mono text-xs">transfer.send</td><td>Tier 1</td><td>user</td><td>$1,000</td><td>By KYC tier</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">transfer.bulkSend</td><td>Tier 2</td><td>admin/partner</td><td>Always</td><td>$50,000</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">wallet.withdraw</td><td>Tier 1</td><td>user</td><td>$500</td><td>By KYC tier</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">wallet.topup</td><td>Tier 0</td><td>user</td><td>—</td><td>$10,000</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">beneficiary.create</td><td>Tier 1</td><td>user</td><td>—</td><td>10/day</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">beneficiary.update</td><td>Tier 1</td><td>user</td><td>—</td><td>BEC hold 24h</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">beneficiary.delete</td><td>Tier 1</td><td>user</td><td>—</td><td>—</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">kyc.approve</td><td>—</td><td>admin</td><td>Always</td><td>—</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">kyc.reject</td><td>—</td><td>admin</td><td>Always</td><td>—</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">report.export</td><td>Tier 2</td><td>admin</td><td>Always</td><td>—</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">admin.*</td><td>—</td><td>admin</td><td>Always</td><td>—</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">dispute.resolve</td><td>—</td><td>admin</td><td>Always</td><td>—</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">compliance.exportSAR</td><td>—</td><td>admin</td><td>Always</td><td>—</td></tr>
                <tr><td className="py-2 pr-4 font-mono text-xs">virtualAccount.create</td><td>Tier 2</td><td>user</td><td>—</td><td>5/day</td></tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
