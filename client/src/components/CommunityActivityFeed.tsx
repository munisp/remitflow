/**
 * CommunityActivityFeed
 * Real-time community activity feed powered by the Go SSE microservice.
 * Falls back to polling via tRPC when SSE is unavailable.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ShoppingBag, Users, Heart, TrendingUp, Home, Globe,
  Star, Zap, ArrowRight, Wifi, WifiOff,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  type: string;
  category: string;
  actor: string;
  action: string;
  detail: string;
  amount?: number;
  currency?: string;
  country?: string;
  timestamp: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  marketplace: { icon: ShoppingBag, color: "text-orange-400", bg: "bg-orange-500/10" },
  talent:      { icon: Users,       color: "text-blue-400",   bg: "bg-blue-500/10" },
  community:   { icon: Heart,       color: "text-pink-400",   bg: "bg-pink-500/10" },
  invest:      { icon: TrendingUp,  color: "text-green-400",  bg: "bg-green-500/10" },
  family:      { icon: Home,        color: "text-purple-400", bg: "bg-purple-500/10" },
  referral:    { icon: Star,        color: "text-yellow-400", bg: "bg-yellow-500/10" },
  system:      { icon: Zap,         color: "text-cyan-400",   bg: "bg-cyan-500/10" },
};

function getConfig(category: string) {
  return CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.system;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatAmount(amount?: number, currency?: string): string | null {
  if (!amount) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Demo events for SSE fallback ─────────────────────────────────────────────

const DEMO_EVENTS: ActivityEvent[] = [
  { id: "d1", type: "order_placed", category: "marketplace", actor: "Amara K.", action: "placed an order", detail: "Premium Ankara Fabric Collection", amount: 45, currency: "USD", country: "NG", timestamp: new Date(Date.now() - 2 * 60000).toISOString() },
  { id: "d2", type: "fund_contribution", category: "community", actor: "Kwame O.", action: "contributed to", detail: "Lagos School Building Fund", amount: 200, currency: "USD", country: "GH", timestamp: new Date(Date.now() - 5 * 60000).toISOString() },
  { id: "d3", type: "talent_booking", category: "talent", actor: "Fatima A.", action: "booked a session with", detail: "Dr. Amara Osei — Fintech Consultant", amount: 150, currency: "USD", country: "GB", timestamp: new Date(Date.now() - 8 * 60000).toISOString() },
  { id: "d4", type: "investment", category: "invest", actor: "Chidi N.", action: "invested in", detail: "West Africa Tech Collective", amount: 500, currency: "USD", country: "US", timestamp: new Date(Date.now() - 12 * 60000).toISOString() },
  { id: "d5", type: "referral_joined", category: "referral", actor: "Zainab M.", action: "joined via referral from", detail: "Kofi B.", country: "CA", timestamp: new Date(Date.now() - 18 * 60000).toISOString() },
  { id: "d6", type: "family_transfer", category: "family", actor: "Emeka O.", action: "sent money to family member", detail: "Monthly support — Okafor family", amount: 300, currency: "USD", country: "NG", timestamp: new Date(Date.now() - 25 * 60000).toISOString() },
  { id: "d7", type: "listing_created", category: "marketplace", actor: "Nkechi A.", action: "listed a new product", detail: "Handmade Adire Tie-Dye Cloth", amount: 35, currency: "USD", country: "NG", timestamp: new Date(Date.now() - 32 * 60000).toISOString() },
  { id: "d8", type: "proposal_voted", category: "community", actor: "Seun B.", action: "voted on proposal", detail: "Expand Nairobi Water Fund to Kisumu", country: "KE", timestamp: new Date(Date.now() - 45 * 60000).toISOString() },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  className?: string;
  maxItems?: number;
  showHeader?: boolean;
  compact?: boolean;
}

export function CommunityActivityFeed({
  className,
  maxItems = 20,
  showHeader = true,
  compact = false,
}: Props) {
  const [events, setEvents] = useState<ActivityEvent[]>(DEMO_EVENTS);
  const [sseConnected, setSseConnected] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // tRPC polling fallback
  const { data: feedData, refetch } = trpc.communityFeed.recent.useQuery(undefined, {
    refetchInterval: false,
    retry: false,
  });

  // Merge tRPC data into events
  useEffect(() => {
    if (feedData?.events && feedData.events.length > 0) {
      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newEvts = (feedData.events as ActivityEvent[]).filter((e) => !existingIds.has(e.id));
        if (newEvts.length === 0) return prev;
        return [...newEvts, ...prev].slice(0, maxItems);
      });
    }
  }, [feedData, maxItems]);

  // SSE connection to Go microservice via tRPC proxy
  useEffect(() => {
    const SSE_URL = "/api/community-feed/stream";

    const trySSE = () => {
      try {
        const es = new EventSource(SSE_URL);
        esRef.current = es;

        es.onopen = () => {
          setSseConnected(true);
          setIsLive(true);
          if (pollRef.current) clearInterval(pollRef.current);
        };

        es.onmessage = (evt) => {
          try {
            const event: ActivityEvent = JSON.parse(evt.data);
            setEvents((prev) => [event, ...prev].slice(0, maxItems));
          } catch { /* ignore parse errors */ }
        };

        es.onerror = () => {
          setSseConnected(false);
          setIsLive(false);
          es.close();
          // Fall back to polling
          startPolling();
        };
      } catch {
        startPolling();
      }
    };

    const startPolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => {
        refetch();
      }, 8000);
    };

    // Start with polling, attempt SSE upgrade
    startPolling();
    setTimeout(trySSE, 1000);

    return () => {
      esRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [maxItems, refetch]);

  const displayEvents = events.slice(0, maxItems);

  return (
    <div className={cn("flex flex-col", className)}>
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-indigo-400" />
            <span className="font-semibold text-sm">Community Activity</span>
          </div>
          <div className="flex items-center gap-1.5">
            {isLive ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className="text-xs text-green-400 font-medium">Live</span>
                <Wifi className="h-3 w-3 text-green-400" />
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Polling</span>
              </>
            )}
          </div>
        </div>
      )}

      <ScrollArea className={compact ? "h-[320px]" : "h-[480px]"}>
        <div className="space-y-2 pr-2">
          {displayEvents.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            displayEvents.map((event, idx) => {
              const cfg = getConfig(event.category);
              const Icon = cfg.icon;
              const amount = formatAmount(event.amount, event.currency);

              return (
                <div
                  key={event.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg transition-all duration-300",
                    "hover:bg-muted/40 cursor-default",
                    idx === 0 && isLive && "animate-in slide-in-from-top-2 duration-300",
                    "bg-muted/20"
                  )}
                >
                  {/* Icon */}
                  <div className={cn("p-1.5 rounded-full shrink-0 mt-0.5", cfg.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-foreground leading-relaxed">
                        <span className="font-semibold">{event.actor}</span>
                        {" "}
                        <span className="text-muted-foreground">{event.action}</span>
                        {" "}
                        <span className="font-medium truncate">{event.detail}</span>
                      </p>
                      {amount && (
                        <Badge variant="outline" className={cn("text-xs shrink-0 font-semibold", cfg.color, "border-current/30")}>
                          {amount}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{timeAgo(event.timestamp)}</span>
                      {event.country && (
                        <span className="text-xs text-muted-foreground">· {event.country}</span>
                      )}
                      <Badge variant="secondary" className="text-xs py-0 px-1.5 capitalize">
                        {event.category}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {displayEvents.length} events · {sseConnected ? "SSE connected" : "Polling every 8s"}
        </span>
        <button
          onClick={() => refetch()}
          className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
        >
          Refresh <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
