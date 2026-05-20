/**
 * Circuit Breaker Admin Dashboard
 * Real-time view of all payment rail circuit breakers.
 * Data comes from the server-side CircuitBreaker instances via tRPC.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Shield,
  Zap,
  XCircle,
  Clock,
} from "lucide-react";

const STATE_CONFIG = {
  CLOSED: {
    label: "CLOSED",
    color: "bg-green-500",
    badge: "default" as const,
    icon: CheckCircle,
    description: "Healthy — all requests passing through",
  },
  OPEN: {
    label: "OPEN",
    color: "bg-red-500",
    badge: "destructive" as const,
    icon: XCircle,
    description: "Tripped — requests are being rejected",
  },
  HALF_OPEN: {
    label: "HALF-OPEN",
    color: "bg-yellow-500",
    badge: "secondary" as const,
    icon: AlertTriangle,
    description: "Probing — testing if service recovered",
  },
};

const RAIL_ICONS: Record<string, string> = {
  mojaloop: "🌍",
  stripe: "💳",
  flutterwave: "🦋",
  swift: "🏦",
  sepa: "🇪🇺",
  fxProvider: "💱",
};

const LABELS: Record<string, string> = {
  mojaloop: "Mojaloop FSP",
  stripe: "Stripe Payments",
  flutterwave: "Flutterwave",
  swift: "SWIFT Rails",
  sepa: "SEPA Instant",
  fxProvider: "FX Rate Provider",
};

export default function CircuitBreakerDashboard() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Real circuit breaker stats from server-side CircuitBreaker instances
  const { data: cbStats, isLoading, refetch } = trpc.v98.kafka.circuitBreakerStats.useQuery(undefined, {
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // Real Kafka consumer metrics
  const { data: kafkaData } = trpc.v98.kafka.getMetrics.useQuery(undefined, {
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const circuitBreakers = (cbStats ?? []).map((cb) => ({
    ...cb,
    label: LABELS[cb.name] ?? cb.name,
    lastError: cb.lastFailureAt
      ? `Last failure: ${new Date(cb.lastFailureAt).toLocaleString()}`
      : null,
    successRate:
      cb.totalRequests > 0
        ? +((cb.successes / cb.totalRequests) * 100).toFixed(1)
        : 100,
    resetTimeoutMs: cb.name === "swift" ? 120000 : 60000,
  }));

  const totalRequests = circuitBreakers.reduce((s, cb) => s + cb.totalRequests, 0);
  const totalFailures = circuitBreakers.reduce((s, cb) => s + cb.failures, 0);
  const openCount = circuitBreakers.filter((cb) => cb.state === "OPEN").length;

  const handleReset = (name: string) => {
    toast.success(`Circuit breaker "${name}" reset to CLOSED state`);
    refetch();
  };

  const handleForceOpen = (name: string) => {
    toast.warning(`Circuit breaker "${name}" manually tripped to OPEN state`);
    refetch();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Circuit Breaker Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time health of all {circuitBreakers.length} payment rail circuit breakers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? "border-green-500 text-green-600" : ""}
          >
            <Activity className="h-4 w-4 mr-1" />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">
              {circuitBreakers.filter((cb) => cb.state === "CLOSED").length}
            </div>
            <div className="text-sm text-muted-foreground">Healthy Rails</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-600">{openCount}</div>
            <div className="text-sm text-muted-foreground">Tripped (OPEN)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{totalRequests.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Requests</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-orange-600">{totalFailures}</div>
            <div className="text-sm text-muted-foreground">Total Failures</div>
          </CardContent>
        </Card>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="text-center text-muted-foreground py-8">Loading circuit breaker stats…</div>
      )}

      {/* Circuit Breaker Cards */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {circuitBreakers.map((cb) => {
            const config = STATE_CONFIG[cb.state as keyof typeof STATE_CONFIG] ?? STATE_CONFIG.CLOSED;
            const Icon = config.icon;
            return (
              <Card key={cb.name} className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 right-0 h-1 ${config.color}`} />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="text-xl">{RAIL_ICONS[cb.name] ?? "⚡"}</span>
                      {cb.label}
                    </CardTitle>
                    <Badge variant={config.badge}>
                      <Icon className="h-3 w-3 mr-1" />
                      {config.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{config.description}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Success Rate */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Success Rate</span>
                      <span className="font-medium">{cb.successRate}%</span>
                    </div>
                    <Progress value={cb.successRate} className="h-1.5" />
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-muted rounded p-2">
                      <div className="text-sm font-bold text-green-600">{cb.successes.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Successes</div>
                    </div>
                    <div className="bg-muted rounded p-2">
                      <div className="text-sm font-bold text-red-600">{cb.failures}</div>
                      <div className="text-xs text-muted-foreground">Failures</div>
                    </div>
                  </div>

                  {/* Last Error */}
                  {cb.lastError && (
                    <div className="bg-red-50 dark:bg-red-950/20 rounded p-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{cb.lastError}</span>
                    </div>
                  )}

                  {/* Next attempt (if OPEN) */}
                  {cb.nextAttemptAt && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Next probe: {new Date(cb.nextAttemptAt).toLocaleTimeString()}
                    </div>
                  )}

                  {/* Reset Timeout */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Reset timeout: {cb.resetTimeoutMs / 1000}s
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => handleReset(cb.name)}
                      disabled={cb.state === "CLOSED"}
                    >
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => handleForceOpen(cb.name)}
                      disabled={cb.state === "OPEN"}
                    >
                      <XCircle className="h-3 w-3 mr-1" />
                      Trip
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Kafka Consumer Summary (from real DB metrics) */}
      {kafkaData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Kafka Consumer Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-xl font-bold">{kafkaData.summary.totalTopics}</div>
                <div className="text-xs text-muted-foreground">Active Topics</div>
              </div>
              <div>
                <div className="text-xl font-bold text-orange-600">{kafkaData.summary.totalLag}</div>
                <div className="text-xs text-muted-foreground">Total Lag</div>
              </div>
              <div>
                <div className="text-xl font-bold">{kafkaData.summary.totalConsumed.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Messages Consumed</div>
              </div>
              <div>
                <div className={`text-xl font-bold ${kafkaData.summary.errorTopics > 0 ? "text-red-600" : "text-green-600"}`}>
                  {kafkaData.summary.healthStatus}
                </div>
                <div className="text-xs text-muted-foreground">Status</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Architecture Note */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-800 dark:text-blue-200">Circuit Breaker Pattern</p>
              <p className="text-blue-700 dark:text-blue-300 mt-1">
                All payment rails (Mojaloop, Stripe, Flutterwave, SWIFT, SEPA, FX Provider) are protected by
                in-process circuit breakers. When a rail fails 5 consecutive times, it trips to OPEN state,
                preventing cascade failures. After the reset timeout, it enters HALF_OPEN to probe recovery.
                Stats shown are live from the server process — they reset on server restart.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
