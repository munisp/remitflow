/**
 * SessionTimeout — shows a countdown warning before session expires.
 * Allows users to extend their session with one tap.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptics } from "@/lib/haptics";

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE_MS = 60 * 1000; // Show warning 60s before expiry

export function SessionTimeout() {
  const { user, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const lastActivity = useRef(Date.now());

  const resetTimer = useCallback(() => {
    lastActivity.current = Date.now();
    setShowWarning(false);
    setCountdown(60);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);

    timeoutRef.current = setTimeout(() => {
      setShowWarning(true);
      haptics.warning();
      setCountdown(60);
      intervalRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(intervalRef.current);
            logout();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }, SESSION_TIMEOUT_MS - WARNING_BEFORE_MS);
  }, [logout]);

  useEffect(() => {
    if (!user) return;
    resetTimer();
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    const handler = () => {
      if (!showWarning) resetTimer();
    };
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, resetTimer, showWarning]);

  if (!showWarning || !user) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 max-w-sm w-full bg-background rounded-2xl shadow-2xl border overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 text-center">
          <div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <Clock className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Session Expiring</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Your session will expire in{" "}
            <span className="font-bold text-foreground">{countdown}s</span>.
            Tap below to stay logged in.
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 active:scale-95 transition-transform"
              onClick={() => {
                logout();
              }}
            >
              Sign Out
            </Button>
            <Button
              className="flex-1 active:scale-95 transition-transform"
              onClick={() => {
                haptics.success();
                resetTimer();
              }}
            >
              Stay Logged In
            </Button>
          </div>
        </div>
        {/* Countdown bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
            style={{ width: `${(countdown / 60) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
