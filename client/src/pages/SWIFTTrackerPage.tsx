import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, CheckCircle, AlertCircle, Globe, Search, Zap } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const STATUS_COLORS: Record<string, string> = {
  processing: "text-blue-500",
  settled: "text-green-500",
  failed: "text-red-500",
  pending: "text-orange-500",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  processing: <Clock className="w-4 h-4 text-blue-500" />,
  settled: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <AlertCircle className="w-4 h-4 text-red-500" />,
  pending: <Clock className="w-4 h-4 text-orange-500" />,
};

export default function SWIFTTrackerPage() {
  const [rail, setRail] = useState<"SWIFT"|"SEPA"|"CHAPS"|"ACH"|"all">("all");
  const [search, setSearch] = useState("");

  const { data: payments } = trpc.v100.swiftSepaRails.getPayments.useQuery({ rail, limit: 50 });
  const { data: railStatus } = trpc.v100.swiftSepaRails.getRailStatus.useQuery();

  const filtered = (payments ?? []).filter(p =>
    !search ||
    p.reference.toLowerCase().includes(search.toLowerCase()) ||
    p.beneficiaryName.toLowerCase().includes(search.toLowerCase())
  );

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Globe className="w-6 h-6" />SWIFT / SEPA Tracker</h1>
        <p className="text-muted-foreground">Track international payments via SWIFT GPI and SEPA rails</p>
      </div>

      {/* Rail Status */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(railStatus ?? []).map(r => (
          <Card key={r.rail} className={r.status === "operational" ? "border-green-200 dark:border-green-800" : "border-red-200 dark:border-red-800"}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm">{r.rail}</span>
                <div className={`w-2 h-2 rounded-full ${r.status === "operational" ? "bg-green-500" : "bg-red-500"}`} />
              </div>
              <p className="text-xs text-muted-foreground">Avg: {r.avgSettlementHours}h</p>
              <p className="text-xs text-muted-foreground">Cut-off: {r.cutoffTime}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by reference or beneficiary..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={rail} onValueChange={(v) => setRail(v as any)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Rails</SelectItem>
            <SelectItem value="SWIFT">SWIFT</SelectItem>
            <SelectItem value="SEPA">SEPA</SelectItem>
            <SelectItem value="CHAPS">CHAPS</SelectItem>
            <SelectItem value="ACH">ACH</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Payments Table */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="w-4 h-4" />Payments ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left p-2">Reference</th>
                  <th className="text-left p-2">Rail</th>
                  <th className="text-left p-2">Beneficiary</th>
                  <th className="text-right p-2">Amount</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Est. Settlement</th>
                  <th className="text-left p-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{p.reference}</td>
                    <td className="p-2"><Badge variant="outline">{p.rail}</Badge></td>
                    <td className="p-2">
                      <p className="font-medium">{p.beneficiaryName}</p>
                      <p className="text-xs text-muted-foreground">{p.beneficiaryBIC}</p>
                    </td>
                    <td className="p-2 text-right font-semibold">{p.currency} {p.amount.toLocaleString()}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        {STATUS_ICONS[p.status] ?? <Clock className="w-4 h-4" />}
                        <span className={`capitalize ${STATUS_COLORS[p.status] ?? ""}`}>{p.status}</span>
                      </div>
                    </td>
                    <td className="p-2 text-xs">{new Date(p.estimatedSettlement).toLocaleDateString()}</td>
                    <td className="p-2 text-xs">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
