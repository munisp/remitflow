/**
 * CrossSellOfferModal — v199
 * Shown on login / dashboard load when the Python scoreCrossSell > 0.7.
 * Calls trpc.outbound.crossSell.checkAndTrigger on mount, then shows the modal
 * if an offer is returned. The user can accept (navigate to CTA URL) or dismiss.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, X, ExternalLink, TrendingUp, Shield, PiggyBank, Briefcase, CreditCard } from "lucide-react";
import { useLocation } from "wouter";

const OFFER_ICONS: Record<string, React.ElementType> = {
  savings_account: PiggyBank,
  diaspora_bond: TrendingUp,
  insurance: Shield,
  investment_fund: Briefcase,
  credit_card: CreditCard,
};

const OFFER_COLORS: Record<string, string> = {
  savings_account: "from-emerald-500/20 to-teal-500/10 border-emerald-500/30",
  diaspora_bond: "from-blue-500/20 to-indigo-500/10 border-blue-500/30",
  insurance: "from-purple-500/20 to-violet-500/10 border-purple-500/30",
  investment_fund: "from-amber-500/20 to-orange-500/10 border-amber-500/30",
  credit_card: "from-rose-500/20 to-pink-500/10 border-rose-500/30",
};

interface CrossSellOfferModalProps {
  /** Segment hint from the current page context (optional) */
  segment?: "labor" | "education" | "medical" | "sme" | "hnw";
  /** Only trigger on specific pages (default: trigger everywhere) */
  onlyOnDashboard?: boolean;
}

export function CrossSellOfferModal({ segment, onlyOnDashboard = false }: CrossSellOfferModalProps) {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [offerId, setOfferId] = useState<number | null>(null);
  const [offerData, setOfferData] = useState<{
    offerType: string;
    headline: string | null;
    body: string | null;
    ctaLabel: string | null;
    ctaUrl: string | null;
    score: string;
  } | null>(null);

  const triggerMutation = trpc.outbound.crossSell.checkAndTrigger.useMutation({
    onSuccess: (data) => {
      if (data.offer && data.offer.status === "pending") {
        setOfferId(data.offer.id);
        setOfferData({
          offerType: data.offer.offerType,
          headline: data.offer.headline,
          body: data.offer.body,
          ctaLabel: data.offer.ctaLabel,
          ctaUrl: data.offer.ctaUrl,
          score: data.offer.score as string,
        });
        setOpen(true);
      }
    },
  });

  const markShownMutation = trpc.outbound.crossSell.markShown.useMutation();
  const respondMutation = trpc.outbound.crossSell.respond.useMutation();

  useEffect(() => {
    if (!isAuthenticated) return;
    // Delay by 2 seconds to let the page settle
    const timer = setTimeout(() => {
      triggerMutation.mutate({ segment });
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    if (open && offerId) {
      markShownMutation.mutate({ offerId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, offerId]);

  const handleAccept = () => {
    if (offerId) respondMutation.mutate({ offerId, response: "accepted" });
    setOpen(false);
    if (offerData?.ctaUrl) {
      navigate(offerData.ctaUrl);
    }
  };

  const handleDismiss = () => {
    if (offerId) respondMutation.mutate({ offerId, response: "dismissed" });
    setOpen(false);
  };

  if (!offerData) return null;

  const Icon = OFFER_ICONS[offerData.offerType] ?? Sparkles;
  const gradientClass = OFFER_COLORS[offerData.offerType] ?? "from-primary/20 to-primary/10 border-primary/30";
  const scoreNum = parseFloat(offerData.score);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className={`-mx-6 -mt-6 mb-4 p-6 rounded-t-lg bg-gradient-to-br border-b ${gradientClass}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-background/80 backdrop-blur-sm">
                  <Icon className="h-6 w-6 text-foreground" />
                </div>
                <div>
                  <Badge variant="secondary" className="text-xs mb-1">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Personalised for you
                  </Badge>
                  <DialogTitle className="text-lg leading-tight">
                    {offerData.headline ?? "Special Offer"}
                  </DialogTitle>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors mt-1"
                aria-label="Dismiss offer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <DialogDescription className="text-sm text-foreground/80 leading-relaxed">
            {offerData.body ?? "Discover this exclusive offer tailored to your remittance profile."}
          </DialogDescription>
        </DialogHeader>

        {scoreNum > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(scoreNum * 100)}%` }}
              />
            </div>
            <span>{Math.round(scoreNum * 100)}% match</span>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={handleDismiss} className="flex-1">
            Not now
          </Button>
          <Button size="sm" onClick={handleAccept} className="flex-1 gap-1.5">
            {offerData.ctaLabel ?? "Learn More"}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
