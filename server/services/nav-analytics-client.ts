/**
 * RemitFlow Nav Analytics Client
 * Typed HTTP client for the Python mobile navigation analytics service (port 8086)
 */

const NAV_BASE = process.env.NAV_ANALYTICS_URL ?? "http://localhost:8086";

export interface NavTabSummary {
  tab: string;
  label: string;
  icon: string;
  taps: number;
  sharePct: number;
  engagementScore: number;
}

export interface NavSummary {
  periodHours: number;
  totalTaps: number;
  uniqueUsers: number;
  tabs: NavTabSummary[];
  platforms: Record<string, number>;
  topCountries: Array<{ country: string; taps: number }>;
}

export interface NavRecommendation {
  tab: string;
  label: string;
  icon: string;
  score: number;
  taps: number;
  engagementPct: number;
  rank: number;
}

export interface NavHeatmap {
  periodHours: number;
  hours: number[];
  heatmap: Record<string, number[]>;
  labels: Record<string, string>;
}

export interface TopFeature {
  rank: number;
  tab: string;
  label: string;
  icon: string;
  taps: number;
  sharePct: number;
  trend: "up" | "down";
}

export interface RetentionDay {
  date: string;
  totalDau: number;
  tabs: Record<string, number>;
}

async function fetchNav<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${NAV_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`[NavAnalytics] ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const navAnalyticsClient = {
  /** Track a nav tap event */
  track: (event: {
    tab: string;
    userId?: string;
    segment?: string;
    platform?: string;
    country?: string;
    dwellSeconds?: number;
  }): Promise<{ ok: boolean; tab: string; totalEvents: number }> =>
    fetchNav("/track", {
      method: "POST",
      body: JSON.stringify({
        tab: event.tab,
        user_id: event.userId,
        segment: event.segment,
        platform: event.platform,
        country: event.country,
        dwell_seconds: event.dwellSeconds,
      }),
    }),

  /** Get summary stats for nav usage */
  getSummary: (hours = 24): Promise<NavSummary> =>
    fetchNav<any>(`/summary?hours=${hours}`).then((raw) => ({
      periodHours: raw.period_hours,
      totalTaps: raw.total_taps,
      uniqueUsers: raw.unique_users,
      tabs: (raw.tabs ?? []).map((t: any) => ({
        tab: t.tab,
        label: t.label,
        icon: t.icon,
        taps: t.taps,
        sharePct: t.share_pct,
        engagementScore: t.engagement_score,
      })),
      platforms: raw.platforms ?? {},
      topCountries: raw.top_countries ?? [],
    })),

  /** Get heatmap data */
  getHeatmap: (hours = 168): Promise<NavHeatmap> =>
    fetchNav<any>(`/heatmap?hours=${hours}`).then((raw) => ({
      periodHours: raw.period_hours,
      hours: raw.hours,
      heatmap: raw.heatmap,
      labels: raw.labels,
    })),

  /** Get AI-ranked nav order recommendations for a segment */
  getRecommendations: (segment = "new_user"): Promise<{
    segment: string;
    totalEventsAnalyzed: number;
    recommendedOrder: NavRecommendation[];
    model: string;
  }> =>
    fetchNav<any>(`/recommendations?segment=${segment}`).then((raw) => ({
      segment: raw.segment,
      totalEventsAnalyzed: raw.total_events_analyzed,
      recommendedOrder: (raw.recommended_order ?? []).map((r: any) => ({
        tab: r.tab,
        label: r.label,
        icon: r.icon,
        score: r.score,
        taps: r.taps,
        engagementPct: r.engagement_pct,
        rank: r.rank,
      })),
      model: raw.model,
    })),

  /** Get top 5 most-used community features */
  getTopFeatures: (hours = 24): Promise<{ periodHours: number; topFeatures: TopFeature[] }> =>
    fetchNav<any>(`/top-features?hours=${hours}`).then((raw) => ({
      periodHours: raw.period_hours,
      topFeatures: (raw.top_features ?? []).map((f: any) => ({
        rank: f.rank,
        tab: f.tab,
        label: f.label,
        icon: f.icon,
        taps: f.taps,
        sharePct: f.share_pct,
        trend: f.trend,
      })),
    })),

  /** Get daily active users per nav section */
  getRetention: (days = 7): Promise<{ days: number; retention: RetentionDay[]; labels: Record<string, string> }> =>
    fetchNav<any>(`/retention?days=${days}`).then((raw) => ({
      days: raw.days,
      retention: (raw.retention ?? []).map((r: any) => ({
        date: r.date,
        totalDau: r.total_dau,
        tabs: r.tabs,
      })),
      labels: raw.labels,
    })),

  /** Health check */
  health: (): Promise<{ status: string; service: string; totalEvents: number }> =>
    fetchNav<any>("/health").then((raw) => ({
      status: raw.status,
      service: raw.service,
      totalEvents: raw.total_events,
    })),
};
