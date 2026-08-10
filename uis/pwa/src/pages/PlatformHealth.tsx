import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ComponentStatus,
  PlatformComponent,
  PlatformHealthSnapshot,
  getPlatformHealthSnapshot,
} from "../services/healthService";
import { useAuthStore } from "../stores/authStore";
import LoadingSpinner from "../components/LoadingSpinner";

const REFRESH_INTERVAL_MS = 30_000;

const STATUS_META: Record<
  ComponentStatus,
  { label: string; dot: string; pill: string }
> = {
  healthy: {
    label: "Operational",
    dot: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  degraded: {
    label: "Degraded",
    dot: "bg-amber-500",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
  },
  down: {
    label: "Down",
    dot: "bg-red-500",
    pill: "bg-red-50 text-red-700 border-red-200",
  },
  unreachable: {
    label: "No signal",
    dot: "bg-slate-300",
    pill: "bg-slate-50 text-slate-500 border-slate-200",
  },
};

const OVERALL_META: Record<
  ComponentStatus,
  { headline: string; tone: string; icon: string }
> = {
  healthy: {
    headline: "All systems operational",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-800",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  degraded: {
    headline: "Some systems are degraded",
    tone: "bg-amber-50 border-amber-200 text-amber-800",
    icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-1.959-1.333-2.73 0L4.083 16c-.77 1.333.192 3 1.732 3z",
  },
  down: {
    headline: "Platform disruption detected",
    tone: "bg-red-50 border-red-200 text-red-800",
    icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  unreachable: {
    headline: "Status unavailable",
    tone: "bg-slate-50 border-slate-200 text-slate-700",
    icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
};

function formatLatency(latencyMs?: number): string | null {
  if (latencyMs === undefined || latencyMs === null) return null;
  if (latencyMs < 1) return "<1 ms";
  if (latencyMs < 1000) return `${Math.round(latencyMs)} ms`;
  return `${(latencyMs / 1000).toFixed(2)} s`;
}

function formatCheckedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ComponentCard: React.FC<{ component: PlatformComponent }> = ({ component }) => {
  const meta = STATUS_META[component.status];
  const latency = formatLatency(component.latencyMs);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot} ${
              component.status === "healthy" ? "" : "animate-pulse"
            }`}
          />
          <h3 className="truncate text-sm font-semibold text-slate-900">
            {component.name}
          </h3>
          {component.critical && (
            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Critical
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.pill}`}
        >
          {meta.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{component.description}</p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
        <span className="truncate pr-2">
          {component.detail ??
            (component.status === "unreachable"
              ? "No public health signal"
              : component.source)}
        </span>
        {latency && (
          <span className="shrink-0 font-medium text-slate-500">{latency}</span>
        )}
      </div>
    </div>
  );
};

const PlatformHealth: React.FC = () => {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";
  const [snapshot, setSnapshot] = useState<PlatformHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const result = await getPlatformHealthSnapshot({
          includeAdminPlatform: isAdmin,
        });
        if (!mountedRef.current) return;
        setSnapshot(result);
        setFetchError(null);
      } catch (err) {
        // getPlatformHealthSnapshot is designed not to throw; if it ever
        // does, surface the failure instead of showing stale success.
        if (!mountedRef.current) return;
        setFetchError(
          err instanceof Error ? err.message : "Failed to load platform status.",
        );
      } finally {
        if (!mountedRef.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isAdmin],
  );

  useEffect(() => {
    mountedRef.current = true;
    void refresh(true);
    const interval = setInterval(() => {
      if (document.hidden) return;
      void refresh(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  if (loading && !snapshot) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  const overall = snapshot?.overall ?? "unreachable";
  const overallMeta = OVERALL_META[overall];
  const healthyCount =
    snapshot?.components.filter((c) => c.status === "healthy").length ?? 0;
  const totalCount = snapshot?.components.length ?? 0;

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Status</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live health of the RemitFlow infrastructure components.
            {snapshot && (
              <span className="ml-1 text-slate-400">
                Last checked {formatCheckedAt(snapshot.checkedAt)} · auto-refreshes
                every 30s
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(false)}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-60"
        >
          <svg
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {fetchError}
        </div>
      )}

      {/* Overall banner */}
      <div
        className={`mb-6 flex items-center gap-4 rounded-2xl border p-5 ${overallMeta.tone}`}
      >
        <svg
          className="h-8 w-8 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={overallMeta.icon} />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{overallMeta.headline}</p>
          <p className="mt-0.5 text-sm opacity-80">
            {healthyCount} of {totalCount} components reporting healthy
            {snapshot?.api.version ? ` · API v${snapshot.api.version}` : ""}
            {snapshot?.api.latencyMs !== undefined
              ? ` · API responded in ${formatLatency(snapshot.api.latencyMs)}`
              : ""}
          </p>
        </div>
      </div>

      {/* Notes about unavailable signals */}
      {snapshot && snapshot.notes.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {snapshot.notes.map((note) => (
            <p key={note} className="text-xs text-slate-500">
              {note}
            </p>
          ))}
        </div>
      )}

      {/* Component grid */}
      {snapshot && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.components.map((component) => (
            <ComponentCard key={component.id} component={component} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-white p-4 text-xs text-slate-500">
        {(Object.keys(STATUS_META) as ComponentStatus[]).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_META[status].dot}`} />
            {STATUS_META[status].label}
          </span>
        ))}
        <span className="ml-auto text-slate-400">
          Components without a public health signal are shown as &ldquo;No
          signal&rdquo; and do not affect the overall status.
        </span>
      </div>
    </div>
  );
};

export default PlatformHealth;
