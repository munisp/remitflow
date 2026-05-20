/**
 * RateLockBanner — shows a countdown timer when a rate lock is active.
 * Displayed on the SendMoney page after a quote is fetched.
 * Creates urgency and reduces drop-off before the user completes the transfer.
 */
import { useEffect, useState } from "react";
import { Lock, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface RateLockBannerProps {
  /** Duration in seconds the rate is locked for (default: 15 minutes = 900s) */
  durationSeconds?: number;
  /** Called when the lock expires */
  onExpire?: () => void;
  /** The locked rate to display */
  rate?: string;
  /** The currency pair */
  pair?: string;
  className?: string;
}

export default function RateLockBanner({
  durationSeconds = 900,
  onExpire,
  rate,
  pair = "USD → NGN",
  className,
}: RateLockBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState(durationSeconds);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setSecondsLeft(durationSeconds);
    setExpired(false);
  }, [durationSeconds]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      setExpired(true);
      onExpire?.();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, onExpire]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const pct = (secondsLeft / durationSeconds) * 100;

  const urgency = secondsLeft <= 60 ? "critical" : secondsLeft <= 180 ? "warning" : "ok";

  if (expired) {
    return (
      <div className={cn(
        "flex items-center gap-2.5 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm",
        className
      )}>
        <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
        <div>
          <span className="font-semibold text-red-300">Rate expired.</span>
          <span className="text-red-400/80 ml-1.5">Please refresh your quote to get the latest rate.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border px-4 py-3 text-sm transition-all",
      urgency === "ok" && "border-emerald-500/40 bg-emerald-950/20",
      urgency === "warning" && "border-amber-500/40 bg-amber-950/20",
      urgency === "critical" && "border-red-500/40 bg-red-950/20 rate-lock-active",
      className
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Lock className={cn(
            "h-4 w-4 flex-shrink-0",
            urgency === "ok" && "text-emerald-400",
            urgency === "warning" && "text-amber-400",
            urgency === "critical" && "text-red-400",
          )} />
          <div>
            <span className={cn(
              "font-semibold",
              urgency === "ok" && "text-emerald-300",
              urgency === "warning" && "text-amber-300",
              urgency === "critical" && "text-red-300",
            )}>
              Rate locked
            </span>
            {rate && (
              <span className="text-muted-foreground ml-1.5">
                {pair} @ <span className="font-mono font-medium text-foreground">{rate}</span>
              </span>
            )}
          </div>
        </div>

        {/* Countdown */}
        <div className={cn(
          "flex items-center gap-1.5 font-mono font-bold text-base tabular-nums flex-shrink-0",
          urgency === "ok" && "text-emerald-300",
          urgency === "warning" && "text-amber-300",
          urgency === "critical" && "text-red-300",
        )}>
          {minutes.toString().padStart(2, "0")}:{seconds.toString().padStart(2, "0")}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2.5 h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000",
            urgency === "ok" && "bg-emerald-500",
            urgency === "warning" && "bg-amber-500",
            urgency === "critical" && "bg-red-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {urgency === "critical" && (
        <p className="mt-1.5 text-xs text-red-400">
          Complete your transfer now — this rate expires in under a minute.
        </p>
      )}
    </div>
  );
}
