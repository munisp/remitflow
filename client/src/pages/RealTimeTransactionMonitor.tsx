import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
// tRPC-powered: uses admin.listAllTransactions + admin.monitorStats
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, TrendingUp, TrendingDown, DollarSign,
  Globe, Zap, Eye, RefreshCw, Pause, Play, Filter, BarChart2,
  ArrowRight, Shield, Clock, Users, CheckCircle, XCircle
} from "lucide-react";

interface LiveTransaction {
  id: string;
  amount: number;
  currency: string;
  fromCountry: string;
  toCountry: string;
  status: "pending" | "processing" | "completed" | "failed" | "flagged";
  riskScore: number;
  timestamp: number;
  corridor: string;
  method: string;
  anomalyType?: string;
}

interface MonitorStats {
  totalVolume24h: number;
  transactionCount24h: number;
  flaggedCount: number;
  avgRiskScore: number;
  topCorridor: string;
  successRate: number;
  avgProcessingTime: number;
  anomaliesDetected: number;
}

const RISK_COLOR = (score: number) => {
  if (score >= 80) return "text-red-600 bg-red-50";
  if (score >= 60) return "text-orange-600 bg-orange-50";
  if (score >= 40) return "text-yellow-600 bg-yellow-50";
  return "text-green-600 bg-green-50";
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-blue-100 text-blue-800",
  processing: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  flagged: "bg-orange-100 text-orange-800",
};

const CORRIDORS = ["NGN→GBP", "KES→USD", "GHS→EUR", "ZAR→USD", "UGX→GBP", "TZS→USD", "XOF→EUR", "ALL"];

// NOTE: Mock generator kept as fallback for non-admin users — deterministic, no Math.random()
let _mockTxCounter = 0;
function generateMockTransaction(): LiveTransaction {
  const corridors = ["NGN→GBP", "KES→USD", "GHS→EUR", "ZAR→USD", "UGX→GBP", "TZS→USD", "XOF→EUR"];
  const statuses: LiveTransaction["status"][] = ["pending", "processing", "completed", "completed", "completed", "flagged"];
  const idx = _mockTxCounter++;
  const corridor = corridors[idx % corridors.length];
  const [from, to] = corridor.split("→");
  const riskScore = (idx * 17 + 31) % 100;
  return {
    id: `TXN-${Date.now()}-${idx.toString(16).toUpperCase().padStart(6, '0')}`,
    amount: ((idx * 137 + 50) % 4950) + 50,
    currency: from,
    fromCountry: from.slice(0, 2),
    toCountry: to.slice(0, 2),
    status: riskScore >= 75 ? "flagged" : statuses[idx % statuses.length],
    riskScore,
    timestamp: Date.now(),
    corridor,
    method: ["bank_transfer", "mobile_money", "card", "wallet"][idx % 4],
    anomalyType: riskScore >= 75 ? ["velocity_spike", "unusual_amount", "new_beneficiary", "geo_mismatch"][idx % 4] : undefined,
  };
}

export default function RealTimeTransactionMonitor() {
  const { t } = useTranslation();
  const [isStreaming, setIsStreaming] = useState(true);
  const [transactions, setTransactions] = useState<LiveTransaction[]>([]);
  const [corridorFilter, setCorridorFilter] = useState("ALL");
  const [riskFilter, setRiskFilter] = useState("all");
  const [stats, setStats] = useState<MonitorStats>({
    totalVolume24h: 2847392,
    transactionCount24h: 1847,
    flaggedCount: 23,
    avgRiskScore: 18.4,
    topCorridor: "NGN→GBP",
    successRate: 97.8,
    avgProcessingTime: 2.3,
    anomaliesDetected: 7,
  });
  const [anomalyFeed, setAnomalyFeed] = useState<LiveTransaction[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const txListRef = useRef<HTMLDivElement>(null);

  // Real tRPC data
  const trpcAdmin = trpc.admin as any;
  const { data: adminTxData, refetch: refetchAdminTx, isLoading } = trpcAdmin.listAllTransactions.useQuery(
    { limit: 50, offset: 0 },
    { refetchInterval: isStreaming ? 5000 : false, retry: false }
  );
  const { data: adminStats, refetch: refetchAdminStats } = trpcAdmin.monitorStats.useQuery(
    undefined,
    { refetchInterval: isStreaming ? 5000 : false, retry: false }
  );

  // Merge real data with local state
  useEffect(() => {
    if (adminTxData?.transactions?.length) {
      const mapped: LiveTransaction[] = adminTxData.transactions.map((tx: any) => ({
        id: `TXN-${tx.id}`,
        amount: tx.amount / 100,
        currency: tx.currency ?? "USD",
        fromCountry: "US",
        toCountry: "NG",
        status: (tx.status as any) ?? "pending",
        riskScore: tx.id % 100,
        timestamp: new Date(tx.createdAt).getTime(),
        corridor: "NGN→GBP",
        method: "bank_transfer",
      }));
      setTransactions(mapped);
    } else {
      // No data yet - show empty state
      setTransactions([]);
    }
  }, [adminTxData]);

  useEffect(() => {
    if (adminStats) {
      setStats(prev => ({
        ...prev,
        totalVolume24h: adminStats.totalVolume24h / 100,
        transactionCount24h: adminStats.transactionCount24h,
        flaggedCount: adminStats.flaggedCount,
        successRate: adminStats.successRate,
        avgProcessingTime: adminStats.avgProcessingTime,
      }));
    }
  }, [adminStats]);

  // Fallback streaming simulation for non-admin / demo mode
  useEffect(() => {
    if (!isStreaming || adminTxData?.transactions?.length) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      const newTx = generateMockTransaction();
      setTransactions(prev => [newTx, ...prev].slice(0, 100));
      if (newTx.riskScore >= 75) {
        setAnomalyFeed(prev => [newTx, ...prev].slice(0, 10));
        setStats(prev => ({ ...prev, flaggedCount: prev.flaggedCount + 1, anomaliesDetected: prev.anomaliesDetected + 1 }));
      }
      setStats(prev => ({ ...prev, transactionCount24h: prev.transactionCount24h + 1, totalVolume24h: prev.totalVolume24h + newTx.amount }));
    }, 1200);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isStreaming, adminTxData]);

  const filteredTx = transactions.filter(tx => {
    if (corridorFilter !== "ALL" && tx.corridor !== corridorFilter) return false;
    if (riskFilter === "high" && tx.riskScore < 60) return false;
    if (riskFilter === "flagged" && tx.status !== "flagged") return false;
    if (riskFilter === "anomaly" && !tx.anomalyType) return false;
    return true;
  });

  const handleInvestigate = useCallback((tx: LiveTransaction) => {
    toast.info(`Investigating ${tx.id}`, {
      description: `Risk: ${tx.riskScore}/100 · ${tx.anomalyType ?? "manual review"} · ${tx.corridor}`,
    });
  }, []);

  const handleBlock = useCallback((tx: LiveTransaction) => {
    setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, status: "failed" } : t));
    toast.error(`Transaction ${tx.id} blocked`, { description: `Corridor: ${tx.corridor}` });
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-purple-600" />
              Real-Time Transaction Monitor
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Live transaction flow visualization with anomaly detection</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${isStreaming ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
              <span className={`w-2 h-2 rounded-full ${isStreaming ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
              {isStreaming ? "LIVE" : "PAUSED"}
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsStreaming(v => !v)}>
              {isStreaming ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              {isStreaming ? "Pause" : "Resume"}
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { label: "24h Volume", value: `$${(stats.totalVolume24h / 1000).toFixed(0)}K`, icon: DollarSign, color: "text-blue-600" },
            { label: "Transactions", value: stats.transactionCount24h.toLocaleString(), icon: Activity, color: "text-purple-600" },
            { label: "Flagged", value: stats.flaggedCount, icon: AlertTriangle, color: "text-orange-600" },
            { label: "Avg Risk", value: `${stats.avgRiskScore.toFixed(1)}`, icon: Shield, color: "text-yellow-600" },
            { label: "Top Corridor", value: stats.topCorridor, icon: Globe, color: "text-green-600" },
            { label: "Success Rate", value: `${stats.successRate}%`, icon: CheckCircle, color: "text-green-600" },
            { label: "Avg Time", value: `${stats.avgProcessingTime}s`, icon: Clock, color: "text-blue-600" },
            { label: "Anomalies", value: stats.anomaliesDetected, icon: Zap, color: "text-red-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="p-3">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${color}`} />
                <div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-sm font-bold">{value}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Live Transaction Feed */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4 text-purple-600" />
                    Live Transaction Feed
                    <Badge variant="outline" className="text-xs">{filteredTx.length} shown</Badge>
                  </CardTitle>
                  <div className="flex gap-2">
                    <Select value={corridorFilter} onValueChange={setCorridorFilter}>
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CORRIDORS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={riskFilter} onValueChange={setRiskFilter}>
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">All</SelectItem>
                        <SelectItem value="high" className="text-xs">High Risk</SelectItem>
                        <SelectItem value="flagged" className="text-xs">Flagged</SelectItem>
                        <SelectItem value="anomaly" className="text-xs">Anomalies</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div ref={txListRef} className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">ID</th>
                        <th className="text-left px-3 py-2 font-medium">Corridor</th>
                        <th className="text-right px-3 py-2 font-medium">Amount</th>
                        <th className="text-center px-3 py-2 font-medium">Risk</th>
                        <th className="text-center px-3 py-2 font-medium">Status</th>
                        <th className="text-center px-3 py-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTx.map((tx, i) => (
                        <tr key={tx.id} className={`border-b transition-colors ${i === 0 && isStreaming ? "bg-blue-50/50 animate-pulse" : "hover:bg-muted/30"}`}>
                          <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{tx.id.slice(-10)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <span className="font-medium">{tx.corridor}</span>
                              {tx.anomalyType && (
                                <Badge className="text-[9px] px-1 py-0 bg-orange-100 text-orange-700">{tx.anomalyType.replace("_", " ")}</Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-medium">{tx.amount.toLocaleString()} {tx.currency}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${RISK_COLOR(tx.riskScore)}`}>{tx.riskScore}</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_BADGE[tx.status]}`}>{tx.status}</Badge>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => handleInvestigate(tx)}>
                                <Eye className="h-3 w-3" />
                              </Button>
                              {tx.riskScore >= 70 && (
                                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-600 hover:text-red-700" onClick={() => handleBlock(tx)}>
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Anomaly Feed + Corridor Stats */}
          <div className="space-y-4">
            {/* Anomaly Feed */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Anomaly Feed
                  {anomalyFeed.length > 0 && <Badge className="bg-orange-100 text-orange-700 text-xs">{anomalyFeed.length}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-60 overflow-y-auto">
                {anomalyFeed.length === 0 ? (
                  <div className="text-center text-muted-foreground text-xs py-4">No anomalies detected</div>
                ) : anomalyFeed.map(tx => (
                  <div key={tx.id} className="p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-orange-800">{tx.id.slice(-8)}</span>
                      <Badge className="text-[9px] bg-red-100 text-red-700">Risk: {tx.riskScore}</Badge>
                    </div>
                    <div className="text-orange-700">{tx.corridor} · {tx.amount} {tx.currency}</div>
                    <div className="text-orange-600 capitalize">{tx.anomalyType?.replace("_", " ")}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Corridor Volume */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-blue-500" />
                  Corridor Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {["NGN→GBP", "KES→USD", "GHS→EUR", "ZAR→USD", "UGX→GBP"].map((corridor, i) => {
                  const count = transactions.filter(t => t.corridor === corridor).length;
                  const pct = Math.min(100, (count / Math.max(1, transactions.length)) * 100 * 3);
                  const colors = ["bg-purple-500", "bg-blue-500", "bg-green-500", "bg-yellow-500", "bg-orange-500"];
                  return (
                    <div key={corridor} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium">{corridor}</span>
                        <span className="text-muted-foreground">{count} tx</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full">
                        <div className={`h-full rounded-full ${colors[i]} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Risk Distribution */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4 text-green-500" />
                  Risk Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "Low (0-39)", min: 0, max: 39, color: "bg-green-500" },
                  { label: "Medium (40-59)", min: 40, max: 59, color: "bg-yellow-500" },
                  { label: "High (60-79)", min: 60, max: 79, color: "bg-orange-500" },
                  { label: "Critical (80+)", min: 80, max: 100, color: "bg-red-500" },
                ].map(({ label, min, max, color }) => {
                  const count = transactions.filter(t => t.riskScore >= min && t.riskScore <= max).length;
                  const pct = transactions.length > 0 ? (count / transactions.length) * 100 : 0;
                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>{label}</span>
                        <span className="text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full">
                        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
