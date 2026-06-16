/**
 * OnboardingChecklist — inline dashboard card showing setup progress.
 * Replaces the modal-based OnboardingTour with a persistent, non-intrusive checklist.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/_core/hooks/useAuth";
import { haptics } from "@/lib/haptics";
import {
  CheckCircle2,
  Circle,
  User,
  Shield,
  Wallet,
  Send,
  ChevronRight,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChecklistStep {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  path: string;
  done: boolean;
}

function getSteps(user: {
  kycTier?: string | null;
  email?: string | null;
  name?: string | null;
} | null): ChecklistStep[] {
  if (!user) return [];
  return [
    {
      id: "profile",
      icon: User,
      label: "Complete your profile",
      description: "Add your name and contact details",
      path: "/settings",
      done: !!user.email && !!user.name,
    },
    {
      id: "kyc",
      icon: Shield,
      label: "Verify your identity",
      description: "Unlock higher transfer limits",
      path: "/kyc",
      done:
        !!user.kycTier &&
        user.kycTier !== "tier0" &&
        user.kycTier !== "tier1",
    },
    {
      id: "wallet",
      icon: Wallet,
      label: "Fund your wallet",
      description: "Add money via card, bank, or PayPal",
      path: "/wallet",
      done: false,
    },
    {
      id: "send",
      icon: Send,
      label: "Send your first transfer",
      description: "Send money to family in minutes",
      path: "/send",
      done: false,
    },
  ];
}

export function OnboardingChecklist() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("remitflow-onboarding-dismissed") === "true"
  );

  const steps = getSteps(user);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const pct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
  const nextStep = steps.find((s) => !s.done);

  if (dismissed || allDone || !user) return null;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                Welcome, {user.name?.split(" ")[0] ?? "there"}!
              </h3>
              <p className="text-xs text-muted-foreground">
                {doneCount} of {steps.length} complete
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setDismissed(true);
              localStorage.setItem("remitflow-onboarding-dismissed", "true");
            }}
            className="p-1 rounded-md hover:bg-muted transition-colors"
            aria-label="Dismiss onboarding"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Progress bar */}
        <Progress value={pct} className="h-1.5 mb-3" />

        {/* Steps */}
        <div className="space-y-1">
          {steps.map((step) => {
            const Icon = step.icon;
            const isNext = step.id === nextStep?.id;
            return (
              <button
                key={step.id}
                onClick={() => {
                  if (!step.done) {
                    haptics.light();
                    navigate(step.path);
                  }
                }}
                disabled={step.done}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all",
                  step.done
                    ? "opacity-60 cursor-default"
                    : "hover:bg-primary/5 active:scale-[0.98] cursor-pointer",
                  isNext && "bg-primary/5 ring-1 ring-primary/20"
                )}
              >
                {step.done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0 flex items-center justify-center">
                    {isNext && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      step.done && "line-through text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </p>
                  {!step.done && (
                    <p className="text-xs text-muted-foreground">
                      {step.description}
                    </p>
                  )}
                </div>
                {!step.done && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* CTA */}
        {nextStep && (
          <Button
            size="sm"
            className="w-full mt-3 active:scale-95 transition-transform"
            onClick={() => {
              haptics.impact();
              navigate(nextStep.path);
            }}
          >
            {nextStep.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
