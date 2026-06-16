import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Clock, Play, Pause, RefreshCw, ChevronRight, AlertCircle, CheckCircle2,
  XCircle, Activity, Calendar, Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

type Job = {
  task_uid: string;
  name: string;
  cron: string;
  path: string;
  description?: string;
  enabled: boolean;
  next_execution_at?: string;
  last_execution_at?: string;
  last_status?: string;
};

type LogEntry = {
  execution_id: string;
  started_at: string;
  finished_at?: string;
  status: string;
  http_status?: number;
  duration_ms?: number;
};

function StatusBadge({ status, enabled }: { status?: string; enabled: boolean }) {
  if (!enabled) return <Badge variant="secondary" className="gap-1"><Pause className="w-3 h-3" /> Paused</Badge>;
  if (!status) return <Badge className="gap-1 bg-blue-100 text-blue-700"><Clock className="w-3 h-3" /> Scheduled</Badge>;
  if (status === "success" || status === "ok") return <Badge className="gap-1 bg-green-100 text-green-700"><CheckCircle2 className="w-3 h-3" /> Success</Badge>;
  if (status === "error" || status === "failed") return <Badge className="gap-1 bg-red-100 text-red-700"><XCircle className="w-3 h-3" /> Failed</Badge>;
  return <Badge className="gap-1 bg-yellow-100 text-yellow-700"><Activity className="w-3 h-3" /> {status}</Badge>;
}

function LogStatusBadge({ status, httpStatus }: { status: string; httpStatus?: number }) {
  const ok = status === "success" || status === "ok" || (httpStatus && httpStatus < 300);
  if (ok) return <Badge className="gap-1 bg-green-100 text-green-700 text-xs"><CheckCircle2 className="w-3 h-3" /> {httpStatus ?? "OK"}</Badge>;
  return <Badge className="gap-1 bg-red-100 text-red-700 text-xs"><XCircle className="w-3 h-3" /> {httpStatus ?? status}</Badge>;
}

function formatCron(cron: string) {
  // Humanise common 6-field cron patterns
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 6) {
    const [, min, hour, dom, , dow] = parts;
    if (dom === "*" && dow === "*") {
      if (hour === "*/6" && min === "0") return "Every 6 hours";
      if (hour === "*/12" && min === "0") return "Every 12 hours";
      if (hour === "*/1" && min === "0") return "Every hour";
      if (hour !== "*" && min !== "*") return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`;
    }
  }
  return cron;
}

function LogsDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const { data, isLoading, refetch } = trpc.system.heartbeatLogs.useQuery(
    { taskUid: job.task_uid },
    { refetchOnWindowFocus: false }
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            Execution History — <span className="font-mono text-sm">{job.name}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {data?.total ?? 0} total executions
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </Button>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading logs...
            </div>
          ) : !data?.logs.length ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <Calendar className="w-8 h-8 opacity-40" />
              <p className="text-sm">No executions yet</p>
              <p className="text-xs">This job hasn't run since it was created.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Execution ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((log: LogEntry) => (
                  <TableRow key={log.execution_id}>
                    <TableCell className="text-xs">
                      {new Date(log.started_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.duration_ms != null ? `${log.duration_ms}ms` : log.finished_at
                        ? `${new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()}ms`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <LogStatusBadge status={log.status} httpStatus={log.http_status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[140px]">
                      {log.execution_id}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminScheduledJobs() {
  const { t } = useTranslation();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const utils = trpc.useUtils();

  const { data, isLoading, error, refetch } = trpc.system.heartbeatList.useQuery(undefined, {
    refetchInterval: 30000, // auto-refresh every 30s
  });

  const pauseMutation = trpc.system.heartbeatPause.useMutation({
    onSuccess: (_, vars) => {
      const uid = vars && 'taskUid' in vars ? vars.taskUid : '';
      toast.success("Job paused", { description: `Task ${uid} will no longer trigger.` });
      utils.system.heartbeatList.invalidate();
    },
    onError: (e) => toast.error("Failed to pause", { description: e.message }),
  });

  const resumeMutation = trpc.system.heartbeatResume.useMutation({
    onSuccess: (_, vars) => {
      const uid = vars && 'taskUid' in vars ? vars.taskUid : '';
      toast.success("Job resumed", { description: `Task ${uid} is now active.` });
      utils.system.heartbeatList.invalidate();
    },
    onError: (e) => toast.error("Failed to resume", { description: e.message }),
  });

  const jobs: Job[] = data?.jobs ?? [];
  const activeCount = jobs.filter(j => j.enabled).length;
  const pausedCount = jobs.filter(j => !j.enabled).length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clock className="w-6 h-6 text-primary" /> Scheduled Jobs
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage Heartbeat cron jobs that POST to <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/scheduled/*</code> endpoints.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{jobs.length}</div>
              <div className="text-xs text-muted-foreground">Total Jobs</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{activeCount}</div>
              <div className="text-xs text-muted-foreground">Active</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-amber-600">{pausedCount}</div>
              <div className="text-xs text-muted-foreground">Paused</div>
            </CardContent>
          </Card>
        </div>

        {/* Jobs table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Cron Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" /> Loading jobs...
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-lg p-4">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Failed to load jobs</p>
                  <p className="text-xs mt-0.5">{error.message}</p>
                </div>
              </div>
            ) : !jobs.length ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Clock className="w-10 h-10 opacity-30" />
                <p className="font-medium">No scheduled jobs</p>
                <p className="text-xs text-center max-w-xs">
                  Use <code className="bg-muted px-1 rounded">manus-heartbeat create</code> in the sandbox CLI to register cron jobs.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Next Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.task_uid}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{job.name}</p>
                          {job.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">{job.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{formatCron(job.cron)}</p>
                          <code className="text-xs text-muted-foreground">{job.cron}</code>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{job.path}</code>
                      </TableCell>
                      <TableCell className="text-xs">
                        {job.next_execution_at
                          ? new Date(job.next_execution_at).toLocaleString()
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.last_status} enabled={job.enabled} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-xs"
                            onClick={() => setSelectedJob(job)}
                          >
                            <ChevronRight className="w-3 h-3" /> Logs
                          </Button>
                          {job.enabled ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs text-amber-600 hover:text-amber-700"
                              disabled={pauseMutation.isPending}
                              onClick={() => pauseMutation.mutate({ taskUid: job.task_uid })}
                            >
                              <Pause className="w-3 h-3" /> Pause
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs text-green-600 hover:text-green-700"
                              disabled={resumeMutation.isPending}
                              onClick={() => resumeMutation.mutate({ taskUid: job.task_uid })}
                            >
                              <Play className="w-3 h-3" /> Resume
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Info callout */}
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
          <Activity className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-blue-800">
            <p className="font-medium">How Heartbeat jobs work</p>
            <p className="text-xs mt-1 text-blue-700">
              The Manus platform POSTs to your <code className="bg-blue-100 px-1 rounded">/api/scheduled/*</code> endpoints on the configured cron schedule.
              Jobs are authenticated via the <code className="bg-blue-100 px-1 rounded">x-scheduled-task</code> header.
              Jobs only fire when the site is deployed — they do not trigger in the local sandbox.
            </p>
          </div>
        </div>
      </div>

      {selectedJob && (
        <LogsDialog job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </DashboardLayout>
  );
}
