/**
 * GlobalMobileNav — persistent 5-tab bottom navigation for the core app.
 * Tabs: Home | Wallet | Send (FAB) | Activity | More
 *
 * Visible on all authenticated pages at mobile breakpoint (< md).
 * The Send button is a raised FAB in the center.
 */
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  Home,
  Wallet,
  ArrowUpRight,
  Activity,
  Menu,
  Send,
  CreditCard,
  Users,
  Settings,
  HelpCircle,
  Shield,
  Bell,
  Star,
  User,
  LogOut,
  Sun,
  Moon,
  Search,
  ChevronRight,
  X,
  PiggyBank,
  BarChart3,
  Globe,
  QrCode,
  Phone,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

// Pages where the global nav should NOT show (public pages, landing, etc.)
const EXCLUDED_PATHS = new Set([
  "/",
  "/home",
  "/landing",
  "/login",
  "/signup",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

// "More" menu items — organized by section
const MORE_SECTIONS = [
  {
    label: "Account",
    items: [
      { icon: User, label: "Profile", path: "/profile" },
      { icon: Users, label: "Beneficiaries", path: "/beneficiaries" },
      { icon: CreditCard, label: "Cards", path: "/cards" },
      { icon: PiggyBank, label: "Savings", path: "/savings" },
      { icon: Settings, label: "Settings", path: "/settings" },
    ],
  },
  {
    label: "Payments",
    items: [
      { icon: Phone, label: "Airtime & Data", path: "/airtime" },
      { icon: QrCode, label: "QR Pay", path: "/qr-code" },
      { icon: Globe, label: "Exchange Rates", path: "/exchange" },
      { icon: BarChart3, label: "Analytics", path: "/account-health" },
    ],
  },
  {
    label: "Security & Support",
    items: [
      { icon: Shield, label: "KYC Verification", path: "/kyc" },
      { icon: Bell, label: "Notifications", path: "/notifications" },
      { icon: Star, label: "Referral", path: "/referral" },
      { icon: HelpCircle, label: "Support", path: "/support" },
    ],
  },
];

interface TabDef {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
  matchPaths?: string[];
}

const TABS: TabDef[] = [
  {
    id: "home",
    label: "Home",
    icon: Home,
    path: "/dashboard",
    matchPaths: ["/dashboard"],
  },
  {
    id: "wallet",
    label: "Wallet",
    icon: Wallet,
    path: "/wallet",
    matchPaths: ["/wallet", "/wallet/multi-currency-v2"],
  },
  {
    id: "send",
    label: "Send",
    icon: Send,
    path: "/send",
    matchPaths: ["/send", "/send-money"],
  },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    path: "/transactions",
    matchPaths: ["/transactions", "/tracking", "/transfer-tracking"],
  },
  {
    id: "more",
    label: "More",
    icon: Menu,
    path: "",
    matchPaths: [],
  },
];

export function GlobalMobileNav() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close "More" menu when route changes
  useEffect(() => {
    setMoreOpen(false);
  }, [location]);

  // Don't show on excluded paths or when not authenticated
  if (!user) return null;
  if (EXCLUDED_PATHS.has(location)) return null;

  const isTabActive = (tab: TabDef) => {
    if (tab.id === "more") return moreOpen;
    return tab.matchPaths?.some(
      (p) => location === p || location.startsWith(p + "/") || location.startsWith(p + "?")
    );
  };

  const handleTabPress = (tab: TabDef) => {
    haptics.selection();
    if (tab.id === "more") {
      setMoreOpen(!moreOpen);
      return;
    }
    setMoreOpen(false);
    navigate(tab.path);
  };

  return (
    <>
      {/* Spacer to prevent content from being hidden behind the nav */}
      <div className="h-20 md:hidden" aria-hidden="true" />

      {/* "More" menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          {/* Menu panel */}
          <div className="absolute bottom-20 left-0 right-0 z-50 mx-2 mb-1 rounded-2xl bg-background border shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-foreground">More</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted active:scale-95 transition-all"
                aria-label="Close menu"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto pb-4">
              {MORE_SECTIONS.map((section) => (
                <div key={section.label} className="px-2 mt-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
                    {section.label}
                  </p>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = location === item.path;
                    return (
                      <button
                        key={item.path}
                        onClick={() => {
                          haptics.light();
                          navigate(item.path);
                          setMoreOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all active:scale-[0.98]",
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground hover:bg-muted"
                        )}
                      >
                        <div
                          className={cn(
                            "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                            isActive
                              ? "bg-primary/15"
                              : "bg-muted"
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4",
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground"
                            )}
                          />
                        </div>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50",
          "md:hidden",
          "bg-background/95 backdrop-blur-md",
          "border-t border-border/60",
          "shadow-[0_-4px_20px_rgba(0,0,0,0.1)]"
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-around px-2 h-16">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = isTabActive(tab);
            const isSend = tab.id === "send";

            if (isSend) {
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabPress(tab)}
                  className="relative flex flex-col items-center justify-center -mt-5"
                  aria-label="Send money"
                >
                  <div
                    className={cn(
                      "h-14 w-14 rounded-full flex items-center justify-center shadow-lg",
                      "bg-primary text-primary-foreground",
                      "active:scale-90 transition-transform duration-150",
                      "ring-4 ring-background"
                    )}
                  >
                    <ArrowUpRight className="h-6 w-6" />
                  </div>
                  <span className="text-[10px] font-medium text-primary mt-1">
                    Send
                  </span>
                </button>
              );
            }

            return (
              <button
                key={tab.id}
                onClick={() => handleTabPress(tab)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5",
                  "min-w-0 flex-1 h-full px-1 py-2",
                  "transition-all duration-150 active:scale-95",
                  "rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "relative"
                )}
                aria-label={tab.label}
                aria-current={isActive ? "page" : undefined}
              >
                {/* Active indicator */}
                {isActive && (
                  <span className="absolute top-1 inset-x-3 h-0.5 rounded-full bg-primary" />
                )}

                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-7 rounded-xl transition-all duration-150",
                    isActive ? "bg-primary/10" : "bg-transparent"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 transition-all duration-150",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium leading-none transition-all duration-150",
                    isActive ? "text-primary" : "text-muted-foreground"
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
