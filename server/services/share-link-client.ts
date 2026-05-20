/**
 * RemitFlow Share Link Client
 * Typed HTTP client for the Rust social sharing link generator (port 8085)
 */

const SHARE_BASE = process.env.SHARE_LINK_URL ?? "http://localhost:8085";

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

async function fetchShare<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${SHARE_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`[ShareLink] ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const shareLinkClient = {
  /** Generate a new share link */
  generate: (req: GenerateShareLinkRequest): Promise<GenerateShareLinkResponse> =>
    fetchShare("/generate", {
      method: "POST",
      body: JSON.stringify({
        resource_type: req.resourceType,
        resource_id: req.resourceId,
        title: req.title,
        description: req.description,
        image_url: req.imageUrl,
        target_url: req.targetUrl,
        base_url: req.baseUrl,
        expires_in_days: req.expiresInDays,
        created_by: req.createdBy,
        metadata: req.metadata,
      }),
    }).then((raw: any) => ({
      id: raw.id,
      slug: raw.slug,
      shortUrl: raw.short_url,
      ogUrl: raw.og_url,
      shareUrls: {
        whatsapp: raw.share_urls?.whatsapp ?? "",
        twitter: raw.share_urls?.twitter ?? "",
        facebook: raw.share_urls?.facebook ?? "",
        telegram: raw.share_urls?.telegram ?? "",
        copy: raw.share_urls?.copy ?? raw.short_url,
      },
      expiresAt: raw.expires_at,
    })),

  /** Resolve a slug to its target URL */
  resolve: (slug: string): Promise<{ found: boolean; redirectUrl?: string; link?: ShareLink }> =>
    fetchShare(`/resolve/${slug}`).then((raw: any) => ({
      found: raw.found,
      redirectUrl: raw.redirect_url,
      link: raw.link,
    })),

  /** Get stats for a share link */
  stats: (slug: string): Promise<ShareLinkStats> =>
    fetchShare(`/stats/${slug}`).then((raw: any) => ({
      slug: raw.slug,
      clicks: raw.clicks,
      views: raw.views,
      createdAt: raw.created_at,
      isActive: raw.is_active,
    })),

  /** Track a click or view on a share link */
  track: (slug: string, eventType: "click" | "view"): Promise<{ ok: boolean }> =>
    fetchShare(`/track/${slug}`, {
      method: "POST",
      body: JSON.stringify({ event_type: eventType }),
    }),

  /** List all active share links */
  list: (): Promise<{ links: ShareLink[]; count: number }> =>
    fetchShare("/list"),

  /** Health check */
  health: (): Promise<{ status: string; service: string; linksStored: number }> =>
    fetchShare("/health").then((raw: any) => ({
      status: raw.status,
      service: raw.service,
      linksStored: raw.links_stored ?? 0,
    })),
};
