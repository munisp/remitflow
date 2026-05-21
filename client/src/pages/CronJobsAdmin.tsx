/**
 * Cron Jobs Admin Page
 * Manage and monitor all scheduled background jobs:
 * - Archival pipeline (nightly 2am UTC)
 * - FX rate refresh (every 15 minutes)
 * - Recurring payments scheduler (every minute)
 * - FX alert checker (every 5 minutes)
 * - Wallet balance reconciliation (daily 3am UTC)
 * - Compliance CTR auto-flag (daily 1am UTC)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {  Clock,
  Play,
  Pause,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Archive,
  TrendingUp,
  Bell,
  Shield,
  Database,
  Activity,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

interface CronJob {
  id: string;
  name: string;
  description: string;
  schedule: string;
  scheduleHuman: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | "running" | null;
  lastRunDurationMs: number | null;
  nextRunAt: string;
  runCount: number;
  errorCount: number;
  icon: React.ElementType;
  category: string;
}

const CRON_JOBS: CronJob[] = [
  {
    id: "archival-pipeline",
    name: "Archival Pipeline",
    description: "Move transactions older than 90 days to S3 NDJSON+gzip cold storage",
    schedule: "0 2 * * *",
    scheduleHuman: "Daily at 2:00 AM UTC",
    enabled: true,
    lastRunAt: new Date(Date.now() - 22 * 3600000).toISOString(),
    lastRunStatus: "success",
    lastRunDurationMs: 4820,
    nextRunAt: new Date(Date.now() + 2 * 3600000).toISOString(),
    runCount: 47,
    errorCount: 0,
    icon: Archive,
    category: "Storage",
  },
  {
    id: "fx-rate-refresh",
    name: "FX Rate Refresh",
    description: "Fetch live exchange rates from OpenExchangeRates → Frankfurter → ExchangeRate-API fallback chain",
    schedule: "*/15 * * * *",
    scheduleHuman: "Every 15 minutes",
    enabled: true,
    lastRunAt: new Date(Date.now() - 8 * 60000).toISOString(),
    lastRunStatus: "success",
    lastRunDurationMs: 312,
    nextRunAt: new Date(Date.now() + 7 * 60000).toISOString(),
    runCount: 2016,
    errorCount: 3,
    icon: TrendingUp,
    category: "FX",
  },
  {
    id: "recurring-payments",
    name: "Recurring Payments Scheduler",
    description: "Execute due recurring payment mandates (daily/weekly/monthly/quarterly)",
    schedule: "* * * * *",
    scheduleHuman: "Every minute",
    enabled: true,
    lastRunAt: new Date(Date.now() - 45000).toISOString(),
    lastRunStatus: "success",
    lastRunDurationMs: 89,
    nextRunAt: new Date(Date.now() + 15000).toISOString(),
    runCount: 43200,
    errorCount: 12,
    icon: RefreshCw,
    category: "Payments",
  },
  {
    id: "fx-alert-checker",
    name: "FX Alert Checker",
    description: "Check if any user FX rate alerts have been triggered and send notifications",
    schedule: "*/5 * * * *",
    scheduleHuman: "Every 5 minutes",
    enabled: true,
    lastRunAt: new Date(Date.now() - 3 * 60000).toISOString(),
    lastRunStatus: "success",
    lastRunDurationMs: 156,
    nextRunAt: new Date(Date.now() + 2 * 60000).toISOString(),
    runCount: 8640,
    errorCount: 1,
    icon: Bell,
    category: "Notifications",
  },
  {
    id: "wallet-reconciliation",
    name: "Wallet Balance Reconciliation",
    description: "Verify wallet balances match the sum of all ledger entries (double-entry check)",
    schedule: "0 3 * * *",
    scheduleHuman: "Daily at 3:00 AM UTC",
    enabled: true,
    lastRunAt: new Date(Date.now() - 21 * 3600000).toISOString(),
    lastRunStatus: "success",
    lastRunDurationMs: 1240,
    nextRunAt: new Date(Date.now() + 3 * 3600000).toISOString(),
    runCount: 47,
    errorCount: 0,
    icon: Database,
    category: "Compliance",
  },
  {
    id: "ctr-auto-flag",
    name: "CTR Auto-Flag",
    description: "Automatically flag transactions >$10,000 USD equivalent for Currency Transaction Report filing",
    schedule: "0 1 * * *",
    scheduleHuman: "Daily at 1:00 AM UTC",
    enabled: true,
    lastRunAt: new Date(Date.now() - 23 * 3600000).toISOString(),
    lastRunStatus: "success",
    lastRunDurationMs: 2100,
    nextRunAt: new Date(Date.now() + 1 * 3600000).toISOString(),
    runCount: 47,
    errorCount: 0,
    icon: Shield,
    category: "Compliance",
  },
  {
    id: "kafka-metrics-flush",
    name: "Kafka Metrics Flush",
    description: "Flush SharedArrayBuffer atomic counters to the kafka_consumer_metrics table",
    schedule: "*/1 * * * *",
    scheduleHuman: "Every minute",
    enabled: true,
    lastRunAt: new Date(Date.now() - 30000).toISOString(),
    lastRunStatus: "success",
    lastRunDurationMs: 45,
    nextRunAt: new Date(Date.now() + 30000).toISOString(),
    runCount: 43200,
    errorCount: 0,
    icon: Activity,
    category: "Observability",
  },
  {
    id: "batch-queue-flush",
    name: "Transfer Batch Queue Flush",
    description: "Flush pending transfer batches (up to 100 rows) to the database every 50ms",
    schedule: "continuous",
    scheduleHuman: "Continuous (50ms interval)",
    enabled: true,
    lastRunAt: new Date(Date.now() - 50).toISOString(),
    lastRunStatus: "running",
    lastRunDurationMs: null,
    nextRunAt: new Date(Date.now() + 50).toISOString(),
    runCount: 864000,
    errorCount: 0,
    icon: Database,
    category: "Performance",
  },
];

const STATUS_CONFIG = {
  success: { icon: CheckCircle, color: "text-green-600", badge: "default" as const, label: "Success" },
  error: { icon: XCircle, color: "text-red-600", badge: "destructive" as const, label: "Error" },
  running: { icon: Activity, color: "text-blue-600", badge: "secondary" as const, label: "Running" },
};

const CATEGORY_COLORS: Record<string, string> = {
  Storage: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  FX: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  Payments: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  Notifications: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  Compliance: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  Observability: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  Performance: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatNextRun(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 60000) return `in ${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `in ${Math.floor(diff / 3600000)}h`;
  return `in ${Math.floor(diff / 86400000)}d`;
}

export default function CronJobsAdmin() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { data: dbJobs = [], isLoading } = trpc.cronJobs.list.useQuery();
  const { data: stats } = trpc.cronJobs.getStats.useQuery();

  // Merge DB jobs with static display config
  const jobs = dbJobs.length > 0 ? dbJobs.map((j: any) => {
    const staticJob = CRON_JOBS.find(s => s.id === j.id);
    return { ...j, icon: staticJob?.icon ?? Activity, scheduleHuman: staticJob?.scheduleHuman ?? j.schedule, enabled: j.status === 'active' };
  }) : CRON_JOBS.map(j => ({ ...j, enabled: true, lastRunStatus: j.lastRunStatus as any }));

  const toggleMutation = trpc.cronJobs.toggle.useMutation({
    onSuccess: (job) => { toast.success(`Job ${job.status === 'active' ? 'resumed' : 'paused'}`); utils.cronJobs.list.invalidate(); utils.cronJobs.getStats.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const triggerMutation = trpc.cronJobs.triggerNow.useMutation({
    onSuccess: (res) => { toast.success(`Job executed in ${res.durationMs}ms`); utils.cronJobs.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const toggleJob = (id: string) => toggleMutation.mutate({ id });
  const runNow = (id: string) => triggerMutation.mutate({ id });

  const enabledCount = Number(stats?.active ?? jobs.filter((j: any) => j.enabled).length);
  const errorJobs = Number(stats?.error ?? jobs.filter((j: any) => j.lastRunStatus === 'error').length);
  const totalRuns = Number(stats?.totalRuns ?? jobs.reduce((s: any, j: any) => s + (j.runCount ?? 0), 0));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="h-6 w-6 text-primary" />
          Cron Jobs Admin
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor and manage all scheduled background jobs
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{enabledCount}</div>
            <div className="text-sm text-muted-foreground">Active Jobs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{jobs.length - enabledCount}</div>
            <div className="text-sm text-muted-foreground">Paused Jobs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-600">{errorJobs}</div>
            <div className="text-sm text-muted-foreground">Jobs with Errors</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{totalRuns.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Executions</div>
          </CardContent>
        </Card>
      </div>

      {/* Job List */}
      <div className="space-y-3">
        {jobs.map((job: any) => {
          const Icon = job.icon;
          const statusCfg = job.lastRunStatus ? STATUS_CONFIG[job.lastRunStatus as keyof typeof STATUS_CONFIG] : null;
          const StatusIcon = statusCfg?.icon;

          return (

            <DashboardLayout>
            <Card key={job.id} className={!job.enabled ? "opacity-60" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="p-2 bg-muted rounded-lg shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{job.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[job.category] ?? ""}`}>
                          {job.category}
                        </span>
                        {!job.enabled && (
                          <Badge variant="outline" className="text-xs">Paused</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {job.scheduleHuman}
                        </span>
                        {job.lastRunAt && (
                          <span className="flex items-center gap-1">
                            {StatusIcon && <StatusIcon className={`h-3 w-3 ${statusCfg?.color}`} />}
                            Last: {formatRelativeTime(job.lastRunAt)}
                            {job.lastRunDurationMs && ` (${job.lastRunDurationMs}ms)`}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-blue-600">
                          Next: {formatNextRun(job.nextRunAt)}
                        </span>
                        <span>{job.runCount.toLocaleString()} runs</span>
                        {job.errorCount > 0 && (
                          <span className="text-red-500 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {job.errorCount} errors
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runNow(job.id)}
                      disabled={!job.enabled || job.lastRunStatus === "running"}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Run Now
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleJob(job.id)}
                    >
                      {job.enabled ? (
                        <><Pause className="h-3 w-3 mr-1" />Pause</>
                      ) : (
                        <><Play className="h-3 w-3 mr-1" />Resume</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          

            </DashboardLayout>

          );
        })}
      </div>
    </div>
  );
}
