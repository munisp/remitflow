/**
 * Onboarding Funnel — guided first-time experience with progress tracking.
 * Steps: Welcome → Verify Phone → Basic KYC → First Transfer → Invite Friend
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Phone, Shield, ArrowUpRight, Users, ChevronRight } from "lucide-react";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  actionLabel: string;
  actionUrl: string;
  completed: boolean;
}

export function OnboardingFunnel({
  currentStep = 0,
  completedSteps = [],
  onStepClick,
}: {
  currentStep?: number;
  completedSteps?: string[];
  onStepClick?: (stepId: string, url: string) => void;
}) {
  const steps: OnboardingStep[] = [
    { id: "phone", title: "Verify your phone", description: "Add and verify your phone number for account security", icon: <Phone className="h-5 w-5" />, actionLabel: "Verify Phone", actionUrl: "/settings/phone", completed: completedSteps.includes("phone") },
    { id: "kyc", title: "Verify your identity", description: "Upload your ID to unlock higher transfer limits", icon: <Shield className="h-5 w-5" />, actionLabel: "Start KYC", actionUrl: "/kyc", completed: completedSteps.includes("kyc") },
    { id: "transfer", title: "Send your first transfer", description: "Send money to family or friends in seconds", icon: <ArrowUpRight className="h-5 w-5" />, actionLabel: "Send Money", actionUrl: "/send", completed: completedSteps.includes("transfer") },
    { id: "invite", title: "Invite a friend", description: "Earn ₦1,000 for every friend who signs up", icon: <Users className="h-5 w-5" />, actionLabel: "Invite Friends", actionUrl: "/referral", completed: completedSteps.includes("invite") },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const progress = (completedCount / steps.length) * 100;

  if (completedCount === steps.length) return null;

  return (
    <Card className="mb-6 border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Welcome to RemitFlow!</CardTitle>
            <CardDescription>Complete these steps to get started</CardDescription>
          </div>
          <span className="text-sm font-medium text-muted-foreground">{completedCount}/{steps.length}</span>
        </div>
        <Progress value={progress} className="mt-2 h-2" aria-label={`Onboarding progress: ${completedCount} of ${steps.length} steps complete`} />
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step, i) => (
          <button
            key={step.id}
            onClick={() => !step.completed && onStepClick?.(step.id, step.actionUrl)}
            disabled={step.completed}
            className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
            aria-label={`${step.title}${step.completed ? " — completed" : ""}`}
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${step.completed ? "bg-green-100 text-green-600" : "bg-primary/10 text-primary"}`}>
              {step.completed ? <CheckCircle2 className="h-5 w-5" /> : step.icon}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
            {!step.completed && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
