/**
 * RemitFlow Share Link Client
 *
 * Wave 7 (C9): NO share-link service exists anywhere in services/ — the old
 * target was a phantom and its callers fabricated share URLs/slugs. Every
 * method now throws UNAVAILABLE ("service not deployed"); health() honestly
 * reports offline. Do NOT reintroduce fabricated links.
 */

const NOT_DEPLOYED = "share-link service not deployed";

export interface ShareUrls {
  whatsapp: string;
  twitter: string;
  facebook: string;
  telegram: string;
  copy: string;
}

export interface GenerateShareLinkRequest {
  resourceType: "fund" | "talent" | "listing" | "collective" | "referral";
  resourceId: string;
  title: string;
  description: string;
  imageUrl?: string;
  targetUrl: string;
  baseUrl?: string;
  expiresInDays?: number;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateShareLinkResponse {
  id: string;
  slug: string;
  shortUrl: string;
  ogUrl: string;
  shareUrls: ShareUrls;
  expiresAt?: string;
}

export interface ShareLinkStats {
  slug: string;
  clicks: number;
  views: number;
  createdAt?: string;
  isActive: boolean;
}

export interface ShareLink {
  id: string;
  slug: string;
  resourceType: string;
  resourceId: string;
  title: string;
  description: string;
  imageUrl?: string;
  targetUrl: string;
  shortUrl: string;
  clicks: number;
  views: number;
  isActive: boolean;
  createdAt: string;
  expiresAt?: string;
}

function unavailable<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`UNAVAILABLE: ${NOT_DEPLOYED} — shareLinkClient.${method} cannot be served`));
}

export const shareLinkClient = {
  /** Generate a new share link — service not deployed, always throws */
  generate: (req: GenerateShareLinkRequest): Promise<GenerateShareLinkResponse> =>
    unavailable(`generate(${req.resourceType}:${req.resourceId})`),

  /** Resolve a slug to its target URL — service not deployed, always throws */
  resolve: (slug: string): Promise<{ found: boolean; redirectUrl?: string; link?: ShareLink }> =>
    unavailable(`resolve(${slug})`),

  /** Get stats for a share link — service not deployed, always throws */
  stats: (slug: string): Promise<ShareLinkStats> =>
    unavailable(`stats(${slug})`),

  /** Track a click or view on a share link — service not deployed, always throws */
  track: (slug: string, eventType: "click" | "view"): Promise<{ ok: boolean }> =>
    unavailable(`track(${slug},${eventType})`),

  /** List all active share links — service not deployed, always throws */
  list: (): Promise<{ links: ShareLink[]; count: number }> =>
    unavailable("list()"),

  /** Health check — honest: the service does not exist, always offline */
  health: (): Promise<{ status: string; service: string; linksStored: number }> =>
    Promise.resolve({ status: "offline", service: "share-link (not deployed)", linksStored: 0 }),
};
