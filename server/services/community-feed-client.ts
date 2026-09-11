/**
 * RemitFlow Community Feed Client
 *
 * Wave 7 (C8): go-community-feed was deleted as an unbuildable scaffold — no
 * feed service exists. Every method now throws UNAVAILABLE ("service not
 * deployed"); health() honestly reports offline.
 */

const NOT_DEPLOYED = "community-feed service not deployed";

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

function unavailable<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`UNAVAILABLE: ${NOT_DEPLOYED} — communityFeedClient.${method} cannot be served`));
}

export const communityFeedClient = {
  /** Get recent activity events — service not deployed, always throws */
  getRecent: (): Promise<{ events: ActivityEvent[]; count: number }> =>
    unavailable("getRecent()"),

  /** Get feed health and stats — service not deployed, always throws */
  getStats: (): Promise<FeedStats> =>
    unavailable("getStats()"),

  /** Publish an event — service not deployed, always throws */
  publish: (_event: PublishEventRequest): Promise<{ ok: boolean; eventId: string }> =>
    unavailable("publish()"),

  /** Health check — honest: the service does not exist, always offline */
  health: (): Promise<{ status: string; service: string; stats: FeedStats }> =>
    Promise.resolve({
      status: "offline",
      service: "community-feed (not deployed)",
      stats: { connectedClients: 0, totalEvents: 0, eventsPerMinute: 0, uptimeSeconds: 0 },
    }),
};
