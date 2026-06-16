import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Zap, AlertTriangle, CheckCircle2, RefreshCw, TrendingUp, Clock } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function APIUsageDashboard() {
  const { t } = useTranslation();
  const [days, setDays] = useState(7);

  // apiUsage namespace (from productionV82) has: summary, timeSeries
  const { data: summaryData, isLoading, refetch } = trpc.apiUsage.summary.useQuery(undefined, { refetchInterval: 30000 });

  const { data: timeSeriesData } = trpc.apiUsage.timeSeries.useQuery({ days });

  // summaryData is an array of per-key stats
  const keyStats = summaryData ?? [];
  const timeSeries = timeSeriesData ?? [];

  const totalRequests = keyStats.reduce((sum: number, k: any) => sum + (k.totalRequests ?? 0), 0);
  const avgSuccessRate = keyStats.length > 0
    ? keyStats.reduce((sum: number, k: any) => sum + parseFloat(k.successRate ?? "0"), 0) / keyStats.length
    : 0;
  const avgLatency = keyStats.length > 0
    ? Math.round(keyStats.reduce((sum: number, k: any) => sum + (k.avgLatencyMs ?? 0), 0) / keyStats.length)
    : 0;
  const totalLast24h = keyStats.reduce((sum: number, k: any) => sum + (k.last24h ?? 0), 0);

  // Aggregate top endpoints across all keys
  const endpointMap: Record<string, number> = {};
  keyStats.forEach((k: any) => {
    (k.topEndpoints ?? []).forEach((ep: any) => {
      endpointMap[ep.path] = (endpointMap[ep.path] ?? 0) + ep.count;
    });
  });
  const topEndpoints = Object.entries(endpointMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path, count]) => ({ endpoint: path, count }));

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            API Usage Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time API key usage analytics and performance metrics</p>
        </div>
        <div className="flex gap-2">
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="7">Last 7d</SelectItem>
              <SelectItem value="30">Last 30d</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-blue-500" />
              <p className="text-sm text-muted-foreground">Total Requests</p>
            </div>
            <p className="text-2xl font-bold">{totalRequests.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <p className="text-sm text-muted-foreground">Success Rate</p>
            </div>
            <p className="text-2xl font-bold text-green-600">{avgSuccessRate.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-yellow-500" />
              <p className="text-sm text-muted-foreground">Avg Latency</p>
            </div>
            <p className="text-2xl font-bold">{avgLatency}ms</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-purple-500" />
              <p className="text-sm text-muted-foreground">Last 24h</p>
            </div>
            <p className="text-2xl font-bold">{totalLast24h.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* By API Key */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Usage by API Key
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>
            ) : keyStats.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No API key usage data yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key Name</TableHead>
                    <TableHead>Requests</TableHead>
                    <TableHead>Success</TableHead>
                    <TableHead>Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keyStats.slice(0, 8).map((k: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{k.keyName ?? `Key #${k.keyId}`}</TableCell>
                      <TableCell>{(k.totalRequests ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <span className={parseFloat(k.successRate) >= 99 ? "text-green-600" : parseFloat(k.successRate) >= 95 ? "text-yellow-600" : "text-red-600"}>
                          {k.successRate}%
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{k.avgLatencyMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Top Endpoints */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Top Endpoints
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>
            ) : topEndpoints.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No endpoint data yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Calls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topEndpoints.map((e: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{e.endpoint}</TableCell>
                      <TableCell>{e.count?.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Time Series */}
      {timeSeries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Daily Request Volume
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>P50 Latency</TableHead>
                  <TableHead>P99 Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeSeries.map((t: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{t.date}</TableCell>
                    <TableCell>{t.requests?.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={t.errors > 50 ? "destructive" : "secondary"}>{t.errors}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{t.latencyP50}ms</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{t.latencyP99}ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
