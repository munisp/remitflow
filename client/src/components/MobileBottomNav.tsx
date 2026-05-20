/**
 * MobileBottomNav
 * Persistent bottom tab bar for community pages on mobile.
 * Tracks nav taps via the Python nav-analytics microservice.
 * Replaces the sidebar on mobile (< md breakpoint).
 */
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Globe, ShoppingBag, Users, Heart, TrendingUp, Home,
} from "lucide-react";

// ─── Nav config ───────────────────────────────────────────────────────────────

interface NavTab {
  id: "hub" | "market" | "talent" | "funds" | "invest" | "family";
  label: string;
  icon: React.ElementType;
  href: string;
  color: string;
  activeColor: string;
  activeBg: string;
}

const NAV_TABS: NavTab[] = [
  {
    id: "hub",
    label: "Hub",
    icon: Globe,
    href: "/community-hub",
    color: "text-muted-foreground",
    activeColor: "text-indigo-400",
    activeBg: "bg-indigo-500/15",
  },
  {
    id: "market",
    label: "Market",
    icon: ShoppingBag,
    href: "/afrimarket",
    color: "text-muted-foreground",
    activeColor: "text-orange-400",
    activeBg: "bg-orange-500/15",
  },
  {
    id: "talent",
    label: "Talent",
    icon: Users,
    href: "/talent-bridge",
    color: "text-muted-foreground",
    activeColor: "text-blue-400",
    activeBg: "bg-blue-500/15",
  },
  {
    id: "funds",
    label: "Funds",
    icon: Heart,
    href: "/community",
    color: "text-muted-foreground",
    activeColor: "text-pink-400",
    activeBg: "bg-pink-500/15",
  },
  {
    id: "invest",
    label: "Invest",
    icon: TrendingUp,
    href: "/diaspora-invest",
    color: "text-muted-foreground",
    activeColor: "text-green-400",
    activeBg: "bg-green-500/15",
  },
  {
    id: "family",
    label: "Family",
    icon: Home,
    href: "/family",
    color: "text-muted-foreground",
    activeColor: "text-purple-400",
    activeBg: "bg-purple-500/15",
  },
];

// Community page paths that should show the bottom nav
const COMMUNITY_PATHS = new Set([
  "/community-hub",
  "/afrimarket",
  "/talent-bridge",
  "/community",
  "/diaspora-invest",
  "/family",
]);

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileBottomNav() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();

  const trackMutation = trpc.navAnalytics.track.useMutation();

  // Only show on community pages
  const isVisible = COMMUNITY_PATHS.has(location);
  if (!isVisible) return null;

  const handleTabPress = (tab: NavTab) => {
    // Track the tap (fire-and-forget)
    if (user) {
      trackMutation.mutate({
        tab: tab.id,
        segment: "community_user",
        platform: "pwa",
      });
    }
    navigate(tab.href);
  };

  return (
    <>
      {/* Spacer to prevent content from being hidden behind the nav */}
      <div className="h-16 md:hidden" aria-hidden="true" />

      {/* Bottom nav bar */}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50",
          "md:hidden", // Only visible on mobile
          "bg-background/95 backdrop-blur-md",
          "border-t border-border/60",
          "safe-area-inset-bottom", // iOS safe area
          "shadow-[0_-4px_20px_rgba(0,0,0,0.15)]"
        )}
        role="navigation"
        aria-label="Community navigation"
      >
        <div className="flex items-center justify-around px-1 h-16">
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = location === tab.href || location.startsWith(tab.href + "?");

            return (
              <button
                key={tab.id}
                onClick={() => handleTabPress(tab)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5",
                  "min-w-0 flex-1 h-full px-1 py-2",
                  "transition-all duration-200 active:scale-95",
                  "rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "relative"
                )}
                aria-label={tab.label}
                aria-current={isActive ? "page" : undefined}
              >
                {/* Active indicator pill */}
                {isActive && (
                  <span
                    className={cn(
                      "absolute top-1.5 inset-x-2 h-0.5 rounded-full",
                      tab.activeColor.replace("text-", "bg-")
                    )}
                  />
                )}

                {/* Icon container */}
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-7 rounded-xl transition-all duration-200",
                    isActive ? tab.activeBg : "bg-transparent"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4.5 w-4.5 transition-all duration-200",
                      isActive ? cn(tab.activeColor, "scale-110") : tab.color
                    )}
                    style={{ width: "1.125rem", height: "1.125rem" }}
                  />
                </span>

                {/* Label */}
                <span
                  className={cn(
                    "text-[10px] font-medium leading-none transition-all duration-200",
                    isActive ? tab.activeColor : tab.color
                  )}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

// ─── Hook: useNavAnalytics ────────────────────────────────────────────────────

/**
 * Hook to manually track a nav interaction from any community page.
 * Usage: const { track } = useNavAnalytics(); track("market", 30);
 */
export function useNavAnalytics() {
  const trackMutation = trpc.navAnalytics.track.useMutation();
  const { user } = useAuth();

  const track = (
    tab: "hub" | "market" | "talent" | "funds" | "invest" | "family",
    dwellSeconds?: number
  ) => {
    if (!user) return;
    trackMutation.mutate({
      tab,
      dwellSeconds,
      platform: "pwa",
      segment: "community_user",
    });
  };

  return { track, isPending: trackMutation.isPending };
}
