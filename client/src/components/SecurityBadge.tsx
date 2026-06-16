/**
 * SecurityBadge — subtle trust signal for sensitive screens.
 * Shows encryption/security assurance on payment and KYC flows.
 */
import { Lock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type SecurityBadgeVariant = "inline" | "banner";

interface SecurityBadgeProps {
  variant?: SecurityBadgeVariant;
  label?: string;
  className?: string;
}

export function SecurityBadge({
  variant = "inline",
  label = "256-bit encrypted",
  className,
}: SecurityBadgeProps) {
  if (variant === "banner") {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 py-2 px-4",
          "bg-emerald-50 dark:bg-emerald-950/30 border-t border-emerald-100 dark:border-emerald-900/50",
          "text-emerald-700 dark:text-emerald-400",
          className
        )}
        role="status"
        aria-label="Security status"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{label}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
        "bg-emerald-50 dark:bg-emerald-950/30",
        "border border-emerald-200 dark:border-emerald-800",
        className
      )}
      role="status"
      aria-label="Security status"
    >
      <Lock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
      <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        {label}
      </span>
    </div>
  );
}
