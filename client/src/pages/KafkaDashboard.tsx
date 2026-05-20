import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Activity, AlertTriangle, CheckCircle, Zap, Database } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const STATUS_COLOR: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  error: "bg-red-500",
  configured: "bg-blue-500",
  "local-default": "bg-gray-500",
};

export default function KafkaDashboard() {
  const [autoRefresh, setAutoRefresh] = useState(false);

  const { data: metrics, isLoading, refetch } = trpc.v98.kafka.getMetrics.useQuery(undefined, {
    refetchInterval: autoRefresh ? 5000 : false,
  });
  const { data: health } = trpc.v98.kafka.health.useQuery();

  const summary = metrics?.summary;
  const topics = metrics?.simulatedTopics ?? [];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kafka Consumer Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time event streaming metrics — {health?.mode === "local-default" ? "Local KRaft broker (docker-compose)" : "Configured broker"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Activity className="h-4 w-4 mr-1" />
            {autoRefresh ? "Live" : "Auto-Refresh"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Broker Health */}
      <Card className={`border-l-4 ${health?.connected ? "border-l-green-500" : "border-l-yellow-500"}`}>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${health?.connected ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
            <div>
              <p className="font-medium">
                Kafka Broker: {health?.brokers?.join(", ") ?? "localhost:9092"}
              </p>
              <p className="text-sm text-muted-foreground">
                {health?.connected
                  ? "Connected — consuming events"
                  : "Not connected — start with: docker-compose up kafka -d"}
              </p>
            </div>
            <Badge variant="outline" className="ml-auto">
              {health?.mode ?? "local-default"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Topics", value: topics.length, icon: Database, color: "text-blue-500" },
          { label: "Total Lag", value: topics.reduce((s, t) => s + (t.lag ?? 0), 0), icon: AlertTriangle, color: "text-yellow-500" },
          { label: "Messages/sec", value: topics.reduce((s, t) => s + parseFloat(String(t.messagesPerSecond ?? 0)), 0).toFixed(1), icon: Zap, color: "text-purple-500" },
          { label: "Health", value: "Healthy", icon: CheckCircle, color: "text-green-500" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Topics Table */}
      <Tabs defaultValue="topics">
        <TabsList>
          <TabsTrigger value="topics">Topics ({topics.length})</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="topics">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consumer Group: remitflow-consumers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4">Topic</th>
                      <th className="text-right pr-4">Offset</th>
                      <th className="text-right pr-4">Log End</th>
                      <th className="text-right pr-4">Lag</th>
                      <th className="text-right pr-4">Msg/s</th>
                      <th className="text-right pr-4">Last Consumed</th>
                      <th className="text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topics.map((t) => (
                      <tr key={t.topic} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="py-2 pr-4 font-mono text-xs max-w-[200px] truncate">{t.topic}</td>
                        <td className="text-right pr-4 font-mono">{t.currentOffset.toLocaleString()}</td>
                        <td className="text-right pr-4 font-mono">{t.logEndOffset.toLocaleString()}</td>
                        <td className="text-right pr-4">
                          <span className={t.lag > 10 ? "text-red-500 font-bold" : t.lag > 0 ? "text-yellow-500" : "text-green-500"}>
                            {t.lag}
                          </span>
                        </td>
                        <td className="text-right pr-4 text-muted-foreground">{t.messagesPerSecond}</td>
                        <td className="text-right pr-4 text-xs text-muted-foreground">
                          {t.lastConsumedAt ? new Date(t.lastConsumedAt).toLocaleTimeString() : "—"}
                        </td>
                        <td className="text-right">
                          <span className={`inline-flex items-center gap-1`}>
                            <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[t.status] ?? "bg-gray-400"}`} />
                            <span className="text-xs">{t.status}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {topics.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No consumer metrics recorded yet. Start Kafka to see live data.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium mb-1">Broker Address</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">
                    {health?.brokers?.join(", ") ?? "localhost:9092"}
                  </code>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Consumer Group</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">remitflow-consumers</code>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Start Command</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">docker-compose up kafka -d</code>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Kafka UI</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">http://localhost:8090</code>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Registered Topics ({health?.topics?.length ?? 0})</p>
                <div className="flex flex-wrap gap-2">
                  {(health?.topics ?? []).map((t: string) => (
                    <Badge key={t} variant="outline" className="font-mono text-xs">{t}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
