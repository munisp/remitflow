import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * ImpersonationBanner — shown as a persistent amber banner at the top of every
 * page when the current session was started via admin impersonation.
 *
 * Detection: reads `impersonating` + `impName` from the URL query params on
 * first mount and persists the state in sessionStorage so it survives navigation.
 * Clicking "End session" logs out and clears the flag.
 */
export function ImpersonationBanner() {
  const [impersonating, setImpersonating] = useState(false);
  const [impName, setImpName] = useState("");
  const [, navigate] = useLocation();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      sessionStorage.removeItem("impersonating");
      sessionStorage.removeItem("impName");
      setImpersonating(false);
      navigate("/");
      toast.success("Impersonation ended — you have been logged out of the impersonated session.");
    },
  });

  useEffect(() => {
    // Check URL query params first (set by redirect from /api/impersonate)
    const params = new URLSearchParams(window.location.search);
    const impFlag = params.get("impersonating");
    const nameParam = params.get("impName");
    if (impFlag === "1") {
      const name = decodeURIComponent(nameParam ?? "");
      sessionStorage.setItem("impersonating", "1");
      sessionStorage.setItem("impName", name);
      setImpersonating(true);
      setImpName(name);
      // Clean the URL without reloading
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    } else {
      // Restore from sessionStorage on navigation
      const stored = sessionStorage.getItem("impersonating");
      if (stored === "1") {
        setImpersonating(true);
        setImpName(sessionStorage.getItem("impName") ?? "");
      }
    }
  }, []);

  if (!impersonating) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-md">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          You are impersonating{impName ? ` ${impName}` : " a user"} — this session expires in 15 minutes.
        </span>
      </div>
      <button
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
        className="flex items-center gap-1 rounded bg-amber-700 px-3 py-1 text-xs text-white hover:bg-amber-800 disabled:opacity-60"
      >
        <X className="h-3 w-3" />
        End session
      </button>
    </div>
  );
}
