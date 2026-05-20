/**
 * RemitFlow Community Feed Client
 * Typed HTTP client for the Go community activity feed microservice (port 8084)
 */

const FEED_BASE = process.env.COMMUNITY_FEED_URL ?? "http://localhost:8084";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "remitflow-internal-2024";

export interface ActivityEvent {
  id: string;
  type: string;
  category: "marketplace" | "community" | "talent" | "invest" | "family" | "referral" | "system";
  actor: string;
  action: string;
  detail: string;
  amount?: number;
  currency?: string;
  country?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface PublishEventRequest {
  type: string;
  category: string;
  actor: string;
  action: string;
  detail?: string;
  amount?: number;
  currency?: string;
  country?: string;
  metadata?: Record<string, unknown>;
}

export interface FeedStats {
  connectedClients: number;
  totalEvents: number;
  eventsPerMinute: number;
  uptimeSeconds: number;
}

async function fetchFeed<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${FEED_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": INTERNAL_TOKEN,
      ...(options?.headers ?? {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`[CommunityFeed] ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const communityFeedClient = {
  /** Get recent activity events (last 50) */
  getRecent: (): Promise<{ events: ActivityEvent[]; count: number }> =>
    fetchFeed("/recent"),

  /** Get feed health and stats */
  getStats: (): Promise<FeedStats> => fetchFeed("/stats"),

  /** Publish an event to the feed (internal use only) */
  publish: (event: PublishEventRequest): Promise<{ ok: boolean; eventId: string }> =>
    fetchFeed("/publish", {
      method: "POST",
      body: JSON.stringify(event),
    }),

  /** Health check */
  health: (): Promise<{ status: string; service: string; stats: FeedStats }> =>
    fetchFeed("/health"),
};
