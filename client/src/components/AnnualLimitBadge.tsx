/**
 * AnnualLimitBadge — v199
 * Shows CBN annual limit utilization for a given purpose code.
 * Renders a compact progress bar + remaining amount badge.
 */
import { trpc } from "@/lib/trpc";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AnnualLimitBadgeProps {
  purposeCode: string;
  className?: string;
  compact?: boolean;
}

const PURPOSE_LABELS: Record<string, string> = {
  EDU: "Education", MED: "Medical", TRV: "Travel", REM: "Remittance",
  SME: "SME / Trade", HNW: "High Net Worth", INV: "Investment", DIVI: "Dividends",
};

export function AnnualLimitBadge({ purposeCode, className = "", compact = false }: AnnualLimitBadgeProps) {
  const { data, isLoading } = trpc.outbound.swift.getAnnualLimit.useQuery(
    { purpose_code: purposeCode },
    { enabled: !!purposeCode, staleTime: 60_000 }
  );

  if (isLoading) {
    return (
      <div className={`animate-pulse h-6 w-40 bg-muted rounded ${className}`} />
    );
  }

  if (!data || data.annualCapUsd === 0) return null;

  const { annualCapUsd, usedUsd, remainingUsd, utilizationPct, isExceeded, calendarYear } = data;
  const label = PURPOSE_LABELS[purposeCode] ?? purposeCode;

  const statusColor =
    isExceeded ? "text-destructive" :
    utilizationPct >= 80 ? "text-amber-500" :
    "text-emerald-600";

  const progressColor =
    isExceeded ? "bg-destructive" :
    utilizationPct >= 80 ? "bg-amber-500" :
    "bg-emerald-500";

  const Icon = isExceeded ? AlertTriangle : utilizationPct >= 80 ? AlertTriangle : CheckCircle2;

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={isExceeded ? "destructive" : "outline"}
              className={`gap-1 cursor-help ${className}`}
            >
              <Icon className="h-3 w-3" />
              {isExceeded
                ? "Limit reached"
                : `$${remainingUsd.toLocaleString()} remaining`}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-semibold">{label} — CBN Annual Limit ({calendarYear})</p>
            <p className="text-sm text-muted-foreground mt-1">
              Used: ${usedUsd.toLocaleString()} of ${annualCapUsd.toLocaleString()} ({utilizationPct}%)
            </p>
            {isExceeded && (
              <p className="text-sm text-destructive mt-1">
                Annual limit exceeded. New transfers will be blocked.
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isExceeded ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/30"} ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className={`h-4 w-4 ${statusColor}`} />
          <span>{label} Annual Limit ({calendarYear})</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">CBN Form A annual limit for {label} transfers. Resets on January 1.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <span className={`text-sm font-semibold ${statusColor}`}>
          {isExceeded ? "EXCEEDED" : `${utilizationPct}% used`}
        </span>
      </div>

      <Progress
        value={Math.min(utilizationPct, 100)}
        className="h-2"
        // Override indicator color via inline style since shadcn Progress doesn't expose it
        style={{ "--progress-indicator-color": isExceeded ? "hsl(var(--destructive))" : utilizationPct >= 80 ? "#f59e0b" : "#10b981" } as React.CSSProperties}
      />

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Used: <strong className="text-foreground">${usedUsd.toLocaleString()}</strong></span>
        <span>Cap: <strong className="text-foreground">${annualCapUsd.toLocaleString()}</strong></span>
        {!isExceeded && (
          <span>Remaining: <strong className={statusColor}>${remainingUsd.toLocaleString()}</strong></span>
        )}
      </div>

      {isExceeded && (
        <p className="text-xs text-destructive font-medium">
          ⚠ Annual limit exceeded. Transfers under this purpose code are blocked until {calendarYear + 1}.
        </p>
      )}
    </div>
  );
}
