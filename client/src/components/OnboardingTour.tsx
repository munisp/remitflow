import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowRight, ArrowLeft, X, Send, Wallet, Users, ShieldCheck,
  TrendingUp, Bell, CheckCircle, Sparkles,
} from "lucide-react";

const TOUR_KEY = "remitflow_onboarding_done";

interface TourStep {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  cta?: string;
  ctaPath?: string;
  badge?: string;
}

const STEPS: TourStep[] = [
  {
    icon: Sparkles,
    iconColor: "text-violet-600",
    iconBg: "bg-violet-100 dark:bg-violet-900/30",
    title: "Welcome to RemitFlow",
    description:
      "You're now part of the fastest-growing diaspora financial platform. Send money home, invest in your roots, save together, and build wealth across borders — all in one place.",
    badge: "Let's get started",
  },
  {
    icon: Send,
    iconColor: "text-emerald-600",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
    title: "Send Money Home",
    description:
      "Transfer funds to Nigeria, Ghana, Kenya, Senegal, and 40+ countries in minutes. Our rates beat banks by up to 6.5% — meaning more money reaches your family.",
    cta: "Send Money",
    ctaPath: "/send-money",
    badge: "Most popular",
  },
  {
    icon: Users,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-100 dark:bg-blue-900/30",
    title: "Save Your Recipients",
    description:
      "Add your family members and friends as beneficiaries once. After that, every transfer takes under 10 seconds — no need to re-enter account details.",
    cta: "Add Beneficiary",
    ctaPath: "/beneficiaries",
  },
  {
    icon: Wallet,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-100 dark:bg-amber-900/30",
    title: "Multi-Currency Wallet",
    description:
      "Hold USD, GBP, EUR, and NGN in your wallet. Top up with a card or bank transfer. Lock in exchange rates for up to 15 minutes before sending.",
    cta: "View Wallet",
    ctaPath: "/wallet",
  },
  {
    icon: ShieldCheck,
    iconColor: "text-red-600",
    iconBg: "bg-red-100 dark:bg-red-900/30",
    title: "Verify Your Identity",
    description:
      "Complete KYC to unlock higher transfer limits. Tier 1 takes under 2 minutes with just a phone number. Tier 2 unlocks up to $10,000/month.",
    cta: "Start KYC",
    ctaPath: "/kyc",
    badge: "Recommended",
  },
  {
    icon: TrendingUp,
    iconColor: "text-purple-600",
    iconBg: "bg-purple-100 dark:bg-purple-900/30",
    title: "Invest in Your Roots",
    description:
      "Browse diaspora investment opportunities — real estate, agriculture, tech startups, and bonds — all vetted and denominated in USD or NGN.",
    cta: "Explore Investments",
    ctaPath: "/diaspora-invest",
  },
  {
    icon: Bell,
    iconColor: "text-orange-600",
    iconBg: "bg-orange-100 dark:bg-orange-900/30",
    title: "Stay in the Loop",
    description:
      "Get real-time notifications for every transfer, rate alert, KYC update, and security event. Enable push notifications to stay informed even when the app is closed.",
    cta: "Set Rate Alert",
    ctaPath: "/rate-alerts",
  },
  {
    icon: CheckCircle,
    iconColor: "text-emerald-600",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
    title: "You're All Set!",
    description:
      "Your account is ready. Start by sending your first transfer or topping up your wallet. If you need help, the live chat button in the bottom-right corner connects you to our support team instantly.",
    cta: "Go to Dashboard",
    ctaPath: "/dashboard",
    badge: "Ready to go",
  },
];

export function OnboardingTour() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user) return;
    const done = localStorage.getItem(TOUR_KEY);
    if (!done) {
      // Small delay so the dashboard loads first
      const t = setTimeout(() => setOpen(true), 1200);
      return () => clearTimeout(t);
    }
  }, [user]);

  const dismiss = () => {
    localStorage.setItem(TOUR_KEY, "1");
    setOpen(false);
  };

  const handleCta = (path?: string) => {
    if (step === STEPS.length - 1) {
      dismiss();
      if (path) navigate(path);
    } else {
      setStep((s) => s + 1);
    }
  };

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        {/* Progress bar */}
        <div className="h-1 bg-muted w-full">
          <div
            className="h-full bg-violet-500 transition-all duration-500"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6 space-y-5">
          {/* Close */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {current.badge && (
                <Badge className="text-xs bg-violet-100 text-violet-700 border-0">{current.badge}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {step + 1} of {STEPS.length}
              </span>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Skip tour"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Icon */}
          <div className="flex justify-center">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${current.iconBg}`}>
              <Icon className={`w-8 h-8 ${current.iconColor}`} />
            </div>
          </div>

          {/* Content */}
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">{current.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{current.description}</p>
          </div>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? "w-6 bg-violet-500" : i < step ? "w-1.5 bg-violet-300" : "w-1.5 bg-muted"
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => s - 1)}
                className="flex-none"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => handleCta(current.ctaPath)}
            >
              {current.cta ?? (isLast ? "Finish" : "Next")}
              {!isLast && <ArrowRight className="w-3.5 h-3.5 ml-1.5" />}
            </Button>
          </div>

          {!isLast && (
            <button
              onClick={dismiss}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              Skip tour
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
