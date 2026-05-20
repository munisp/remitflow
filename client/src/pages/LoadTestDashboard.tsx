/**
 * Load Test Dashboard — RemitFlow v98.4
 * Real concurrent HTTP requests, live progress, p50/p95/p99, histogram, endpoint breakdown.
 * 80/20 Pareto skew pattern from the 1B Payments/Day benchmark.
 */
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Activity, Play, Square, Zap, Clock,
  TrendingUp, AlertTriangle, CheckCircle, BarChart3, Target, Server,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";

interface LatencyBucket { label: string; count: number; pct: number; }
interface TestResult {
  totalRequests: number; successCount: number; errorCount: number;
  durationMs: number; rps: number; p50Ms: number; p95Ms: number;
  p99Ms: number; maxMs: number; minMs: number; errorRate: number;
  buckets: LatencyBucket[];
  endpointBreakdown?: { endpoint: string; count: number; avgMs: number; errorCount: number }[];
  timestamp: string;
}

function LatencyBar({ ms, max, label }: { ms: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (ms / max) * 100) : 0;
  const color = ms < 50 ? "bg-emerald-500" : ms < 200 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-10 font-mono">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-3">
        <div className={`h-3 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-mono font-semibold w-16 text-right">{ms}ms</span>
    </div>
  );
}

function BucketHistogram({ buckets }: { buckets: LatencyBucket[] }) {
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div className="space-y-1.5">
      {buckets.map(b => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono w-20 text-right">{b.label}</span>
          <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
            <div className="h-5 bg-violet-500/70 rounded transition-all duration-700"
              style={{ width: `${(b.count / maxCount) * 100}%` }} />
            <span className="absolute inset-0 flex items-center px-2 text-xs font-mono">
              {b.count} ({b.pct}%)
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LoadTestDashboard() {
  const [workers, setWorkers] = useState(20);
  const [duration, setDuration] = useState(30);
  const [targetUrl, setTargetUrl] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: status, refetch: refetchStatus } = trpc.loadTest.status.useQuery(undefined, {
    refetchInterval: isRunning ? 2000 : false,
  });
  const { data: endpointsData } = trpc.loadTest.endpoints.useQuery();

  const runMutation = trpc.loadTest.run.useMutation({
    onSuccess: (data) => {
      setResult(data as TestResult);
      setIsRunning(false);
      if (timerRef.current) clearInterval(timerRef.current);
      toast.success(`Load test complete — ${data.totalRequests} requests, p99: ${data.p99Ms}ms`);
    },
    onError: (err) => {
      setIsRunning(false);
      if (timerRef.current) clearInterval(timerRef.current);
      toast.error(`Load test failed: ${err.message}`);
    },
  });

  const stopMutation = trpc.loadTest.stop.useMutation({
    onSuccess: () => {
      setIsRunning(false);
      if (timerRef.current) clearInterval(timerRef.current);
      toast.info("Load test stopped");
      refetchStatus();
    },
  });

  useEffect(() => {
    if (status?.lastResult && !result) setResult(status.lastResult as TestResult);
  }, [status]);

  const handleRun = () => {
    setIsRunning(true);
    setResult(null);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    runMutation.mutate({ workers, durationSeconds: duration, targetUrl: targetUrl || undefined });
  };

  const progress = isRunning ? Math.min(100, Math.round((elapsed / duration) * 100)) : 0;
  const displayResult = result ?? (status?.lastResult as TestResult | null);
  const getLatencyColor = (ms: number) =>
    ms < 50 ? "text-emerald-500" : ms < 200 ? "text-amber-500" : "text-red-500";

  return (

    <DashboardLayout>
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-violet-500" />
            Load Test Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            80/20 Pareto skew benchmark — {endpointsData?.endpoints?.length ?? 5} endpoints
          </p>
        </div>
        <Badge variant={isRunning ? "default" : "outline"} className={isRunning ? "bg-violet-600 animate-pulse" : ""}>
          {isRunning ? `Running ${elapsed}s / ${duration}s` : displayResult ? "Last run complete" : "Ready"}
        </Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" />Test Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Concurrent Workers: <span className="font-mono text-violet-500">{workers}</span></Label>
              <Slider value={[workers]} onValueChange={([v]) => setWorkers(v)} min={1} max={100} step={1} disabled={isRunning} />
            </div>
            <div className="space-y-2">
              <Label>Duration: <span className="font-mono text-violet-500">{duration}s</span></Label>
              <Slider value={[duration]} onValueChange={([v]) => setDuration(v)} min={5} max={300} step={5} disabled={isRunning} />
            </div>
            <div className="space-y-2">
              <Label>Target URL (optional)</Label>
              <Input placeholder={typeof window !== "undefined" ? window.location.origin : ""} value={targetUrl} onChange={e => setTargetUrl(e.target.value)} disabled={isRunning} />
            </div>
          </div>
          {endpointsData && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Endpoints (hot path = first 20%)</Label>
              <div className="flex flex-wrap gap-1">
                {endpointsData.endpoints.map((ep, i) => (
                  <Badge key={ep} variant="outline" className={`text-xs font-mono ${i === 0 ? "border-violet-500 text-violet-500" : ""}`}>
                    {i === 0 ? "🔥 " : ""}{ep}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {isRunning && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Running…</span><span>{elapsed}s / {duration}s ({progress}%)</span>
              </div>
              <Progress value={progress} />
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleRun} disabled={isRunning} className="bg-violet-600 hover:bg-violet-700">
              <Play className="w-4 h-4 mr-2" />Run Load Test
            </Button>
            {isRunning && (
              <Button variant="outline" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
                <Square className="w-4 h-4 mr-2" />Stop
              </Button>
            )}
          </div>
          <div className="bg-muted rounded p-3 font-mono text-xs text-muted-foreground">
            # CLI: node scripts/load-test-v98.mjs --workers {workers} --duration {duration}
          </div>
        </CardContent>
      </Card>

      {displayResult && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Requests", value: displayResult.totalRequests.toLocaleString(), icon: Activity, color: "text-violet-500" },
              { label: "Req/sec (RPS)", value: displayResult.rps, icon: Zap, color: "text-blue-500" },
              { label: "Error Rate", value: `${displayResult.errorRate}%`, icon: AlertTriangle, color: displayResult.errorRate > 5 ? "text-red-500" : "text-emerald-500" },
              { label: "Duration", value: `${(displayResult.durationMs / 1000).toFixed(1)}s`, icon: Clock, color: "text-amber-500" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><span className="text-xs text-muted-foreground">{label}</span></div>
                  <div className="text-2xl font-bold font-mono">{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4 text-violet-500" />Latency Percentiles</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <LatencyBar ms={displayResult.p50Ms} max={displayResult.maxMs} label="p50" />
                <LatencyBar ms={displayResult.p95Ms} max={displayResult.maxMs} label="p95" />
                <LatencyBar ms={displayResult.p99Ms} max={displayResult.maxMs} label="p99" />
                <LatencyBar ms={displayResult.maxMs} max={displayResult.maxMs} label="max" />
                <div className="pt-2 border-t grid grid-cols-3 gap-2 text-center">
                  {[["p50", displayResult.p50Ms], ["p95", displayResult.p95Ms], ["p99", displayResult.p99Ms]].map(([l, v]) => (
                    <div key={l as string}>
                      <div className={`text-xl font-bold font-mono ${getLatencyColor(v as number)}`}>{v}ms</div>
                      <div className="text-xs text-muted-foreground">{l}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4 text-violet-500" />Latency Distribution</CardTitle></CardHeader>
              <CardContent>
                <BucketHistogram buckets={displayResult.buckets} />
                <div className="mt-3 pt-3 border-t flex justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-emerald-500" />{displayResult.successCount.toLocaleString()} ok</span>
                  <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-500" />{displayResult.errorCount.toLocaleString()} err</span>
                  <span>min: {displayResult.minMs}ms</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {displayResult.endpointBreakdown && displayResult.endpointBreakdown.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Server className="w-4 h-4 text-violet-500" />Endpoint Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left py-2 font-medium">Endpoint</th>
                        <th className="text-right py-2 font-medium">Requests</th>
                        <th className="text-right py-2 font-medium">Avg Latency</th>
                        <th className="text-right py-2 font-medium">Errors</th>
                        <th className="text-right py-2 font-medium">Error %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayResult.endpointBreakdown.map(ep => (
                        <tr key={ep.endpoint} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 font-mono text-xs text-violet-400">{ep.endpoint}</td>
                          <td className="py-2 text-right font-mono">{ep.count.toLocaleString()}</td>
                          <td className={`py-2 text-right font-mono font-semibold ${getLatencyColor(ep.avgMs)}`}>{ep.avgMs}ms</td>
                          <td className="py-2 text-right font-mono text-red-400">{ep.errorCount}</td>
                          <td className="py-2 text-right font-mono text-xs">{ep.count > 0 ? ((ep.errorCount / ep.count) * 100).toFixed(1) : "0.0"}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className={`border-l-4 ${displayResult.p99Ms < 200 ? "border-l-emerald-500" : displayResult.p99Ms < 500 ? "border-l-amber-500" : "border-l-red-500"}`}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                {displayResult.p99Ms < 200 ? <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />}
                <div>
                  <div className="font-semibold">
                    {displayResult.p99Ms < 50 ? "Excellent" : displayResult.p99Ms < 200 ? "Good" : displayResult.p99Ms < 500 ? "Acceptable — consider optimization" : "High latency — optimization required"}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {displayResult.rps} RPS · p99={displayResult.p99Ms}ms · {workers} workers · {duration}s
                    {displayResult.errorRate > 5 && ` · High error rate (${displayResult.errorRate}%)`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Tested at {new Date(displayResult.timestamp).toLocaleString()}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!displayResult && !isRunning && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Configure and run a load test to see latency percentiles, RPS, and endpoint breakdown.</p>
            <p className="text-xs text-muted-foreground mt-1">Uses 80/20 Pareto skew — 80% of traffic hits the top 20% of endpoints.</p>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
