/**
 * ConnectionQualityIndicator.tsx — v174
 * Compact indicator showing real-time connection quality.
 * Uses Network Information API + navigator.onLine + RTT measurement.
 * Designed for low-bandwidth African environments.
 */
import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff, Signal, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type Quality = "good" | "fair" | "poor" | "offline";

interface QualityInfo {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  description: string;
}

const QUALITY_MAP: Record<Quality, QualityInfo> = {
  good: {
    label: "Good",
    color: "text-green-600",
    bgColor: "bg-green-50 border-green-200",
    icon: <Wifi className="h-3.5 w-3.5" />,
    description: "Full speed connection",
  },
  fair: {
    label: "Fair",
    color: "text-amber-600",
    bgColor: "bg-amber-50 border-amber-200",
    icon: <Signal className="h-3.5 w-3.5" />,
    description: "Reduced speed — some features may be slower",
  },
  poor: {
    label: "Poor",
    color: "text-orange-600",
    bgColor: "bg-orange-50 border-orange-200",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    description: "2G/slow connection — offline mode active for non-critical features",
  },
  offline: {
    label: "Offline",
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-200",
    icon: <WifiOff className="h-3.5 w-3.5" />,
    description: "No connection — transfers queued for retry",
  },
};

function measureQuality(): Quality {
  if (!navigator.onLine) return "offline";
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  };
  const conn = nav.connection;
  if (!conn) return "good";
  const { effectiveType, downlink, rtt, saveData } = conn;
  if (saveData) return "poor"; // User has data-saver on
  if (effectiveType === "slow-2g" || effectiveType === "2g") return "poor";
  if (effectiveType === "3g" || (rtt && rtt > 400) || (downlink && downlink < 0.5)) return "fair";
  return "good";
}

interface Props {
  /** Show the full banner (default: compact badge) */
  variant?: "badge" | "banner";
  className?: string;
}

export function ConnectionQualityIndicator({ variant = "badge", className }: Props) {
  const [quality, setQuality] = useState<Quality>(() => measureQuality());
  const [rtt, setRtt] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Measure RTT by pinging /api/health
  const measureRtt = async () => {
    try {
      const t0 = performance.now();
      await fetch("/api/health", { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5000) });
      const elapsed = Math.round(performance.now() - t0);
      setRtt(elapsed);
      // Adjust quality based on measured RTT
      if (!navigator.onLine) { setQuality("offline"); return; }
      if (elapsed > 800) setQuality("poor");
      else if (elapsed > 300) setQuality("fair");
      else setQuality("good");
    } catch {
      if (!navigator.onLine) setQuality("offline");
      else setQuality("poor");
      setRtt(null);
    }
  };

  useEffect(() => {
    const handleOnline = () => { setQuality(measureQuality()); measureRtt(); };
    const handleOffline = () => { setQuality("offline"); setRtt(null); };
    const handleNetworkChange = () => { setQuality(measureQuality()); };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const nav = navigator as Navigator & { connection?: EventTarget };
    nav.connection?.addEventListener("change", handleNetworkChange);

    // Measure RTT every 30s
    measureRtt();
    pingTimerRef.current = setInterval(measureRtt, 30_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      nav.connection?.removeEventListener("change", handleNetworkChange);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    };
  }, []);

  const info = QUALITY_MAP[quality];

  // Don't show badge when connection is good
  if (variant === "badge" && quality === "good") return null;

  if (variant === "badge") {
    return (
      <button
        onClick={() => setShowDetail(d => !d)}
        className={cn(
          "relative flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium transition-all",
          info.bgColor,
          info.color,
          className
        )}
        title={info.description}
      >
        {info.icon}
        <span>{info.label}</span>
        {rtt && <span className="opacity-60">{rtt}ms</span>}
        {showDetail && (
          <div className="absolute top-full left-0 mt-1 z-50 w-56 bg-white border rounded-lg shadow-lg p-3 text-left">
            <div className="font-semibold text-sm text-foreground mb-1">Connection Quality</div>
            <div className="text-xs text-muted-foreground">{info.description}</div>
            {rtt && <div className="text-xs mt-1">Latency: <strong>{rtt}ms</strong></div>}
            <div className="text-xs mt-1 text-muted-foreground">
              {quality === "offline" && "Transfers will be queued and sent when you reconnect."}
              {quality === "poor" && "Using compressed data mode. Rate updates every 5 minutes."}
              {quality === "fair" && "Rate updates every 2 minutes to save data."}
            </div>
          </div>
        )}
      </button>
    );
  }

  // Banner variant
  if (quality === "good") return null;

  return (
    <div className={cn(
      "flex items-center gap-2 px-4 py-2 text-sm border-b",
      info.bgColor,
      info.color,
      className
    )}>
      {info.icon}
      <span className="font-medium">{info.label} connection</span>
      <span className="opacity-75">— {info.description}</span>
      {rtt && <span className="ml-auto opacity-60 text-xs">{rtt}ms latency</span>}
    </div>
  );
}
