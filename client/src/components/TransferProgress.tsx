/**
 * TransferProgress — real-time visual progress tracker for transfers.
 * Shows: Initiated → Processing → Compliance → Sending → Delivered
 */
import { cn } from "@/lib/utils";
import { Check, Loader2, Circle, Clock } from "lucide-react";

type TransferStage =
  | "initiated"
  | "processing"
  | "compliance"
  | "sending"
  | "delivered"
  | "failed";

interface TransferProgressProps {
  currentStage: TransferStage;
  estimatedMinutes?: number;
  className?: string;
}

const STAGES: { id: TransferStage; label: string }[] = [
  { id: "initiated", label: "Initiated" },
  { id: "processing", label: "Processing" },
  { id: "compliance", label: "Compliance" },
  { id: "sending", label: "Sending" },
  { id: "delivered", label: "Delivered" },
];

export function TransferProgress({
  currentStage,
  estimatedMinutes,
  className,
}: TransferProgressProps) {
  const currentIndex = STAGES.findIndex((s) => s.id === currentStage);
  const isFailed = currentStage === "failed";

  return (
    <div className={cn("py-4", className)} role="progressbar" aria-label="Transfer progress">
      <div className="flex items-center justify-between px-2">
        {STAGES.map((stage, i) => {
          const isComplete = currentIndex > i;
          const isCurrent = currentIndex === i;

          return (
            <div key={stage.id} className="flex flex-col items-center relative flex-1">
              {/* Connector line */}
              {i > 0 && (
                <div
                  className={cn(
                    "absolute top-3.5 right-1/2 w-full h-0.5 -z-10",
                    isComplete
                      ? "bg-emerald-500"
                      : isCurrent
                      ? "bg-gradient-to-r from-emerald-500 to-muted"
                      : "bg-muted"
                  )}
                />
              )}

              {/* Stage indicator */}
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center transition-all duration-300",
                  isComplete && "bg-emerald-500 text-white",
                  isCurrent &&
                    !isFailed &&
                    "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  isCurrent && isFailed && "bg-destructive text-destructive-foreground",
                  !isComplete && !isCurrent && "bg-muted text-muted-foreground"
                )}
              >
                {isComplete ? (
                  <Check className="h-3.5 w-3.5" />
                ) : isCurrent ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Circle className="h-2.5 w-2.5" />
                )}
              </div>

              {/* Label */}
              <span
                className={cn(
                  "text-[10px] mt-1.5 font-medium text-center",
                  isComplete && "text-emerald-600 dark:text-emerald-400",
                  isCurrent && "text-primary font-semibold",
                  !isComplete && !isCurrent && "text-muted-foreground"
                )}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ETA */}
      {estimatedMinutes !== undefined && currentStage !== "delivered" && !isFailed && (
        <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>
            Est. {estimatedMinutes < 1 ? "<1" : estimatedMinutes} min remaining
          </span>
        </div>
      )}
    </div>
  );
}
