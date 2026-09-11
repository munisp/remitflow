/**
 * RemitFlow Nav Analytics Client
 *
 * Wave 7 (C8): python-nav-analytics was deleted as an unbuildable scaffold —
 * no nav-analytics service exists. Every method now throws UNAVAILABLE
 * ("service not deployed"); health() honestly reports offline.
 */

const NOT_DEPLOYED = "nav-analytics service not deployed";

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

function unavailable<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`UNAVAILABLE: ${NOT_DEPLOYED} — navAnalyticsClient.${method} cannot be served`));
}

export const navAnalyticsClient = {
  /** Track a nav tap event — service not deployed, always throws */
  track: (event: {
    tab: string;
    userId?: string;
    segment?: string;
    platform?: string;
    country?: string;
    dwellSeconds?: number;
  }): Promise<{ ok: boolean; tab: string; totalEvents: number }> =>
    unavailable(`track(${event.tab})`),

  /** Get summary stats — service not deployed, always throws */
  getSummary: (hours = 24): Promise<NavSummary> =>
    unavailable(`getSummary(${hours}h)`),

  /** Get heatmap data — service not deployed, always throws */
  getHeatmap: (hours = 168): Promise<NavHeatmap> =>
    unavailable(`getHeatmap(${hours}h)`),

  /** Get AI-ranked nav order recommendations — service not deployed, always throws */
  getRecommendations: (segment = "new_user"): Promise<{
    segment: string;
    totalEventsAnalyzed: number;
    recommendedOrder: NavRecommendation[];
    model: string;
  }> =>
    unavailable(`getRecommendations(${segment})`),

  /** Get top community features — service not deployed, always throws */
  getTopFeatures: (hours = 24): Promise<{ periodHours: number; topFeatures: TopFeature[] }> =>
    unavailable(`getTopFeatures(${hours}h)`),

  /** Get daily active users per nav section — service not deployed, always throws */
  getRetention: (days = 7): Promise<{ days: number; retention: RetentionDay[]; labels: Record<string, string> }> =>
    unavailable(`getRetention(${days}d)`),

  /** Health check — honest: the service does not exist, always offline */
  health: (): Promise<{ status: string; service: string; totalEvents: number }> =>
    Promise.resolve({ status: "offline", service: "nav-analytics (not deployed)", totalEvents: 0 }),
};
