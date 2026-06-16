/**
 * OfflineQueueBanner — persistent banner showing queued offline transfers.
 * Appears when there are unsent transfers waiting for connectivity.
 */
import { useState, useEffect } from "react";
import { WifiOff, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineQueueBanner() {
  const [queueCount, setQueueCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const checkQueue = async () => {
      try {
        if ("indexedDB" in window) {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open("remitflow-offline-queue", 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const tx = db.transaction("pending_transfers", "readonly");
          const store = tx.objectStore("pending_transfers");
          const countReq = store.count();
          countReq.onsuccess = () => setQueueCount(countReq.result);
          db.close();
        }
      } catch {
        setQueueCount(0);
      }
    };

    checkQueue();
    const interval = setInterval(checkQueue, 5000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (queueCount === 0 && isOnline) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm transition-all",
        !isOnline
          ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800"
          : "bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border-b border-blue-200 dark:border-blue-800"
      )}
      role="alert"
      aria-live="polite"
    >
      {!isOnline ? (
        <WifiOff className="h-4 w-4 shrink-0" />
      ) : (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      )}
      <span className="flex-1 text-xs font-medium">
        {!isOnline
          ? `You're offline${queueCount > 0 ? ` · ${queueCount} transfer${queueCount > 1 ? "s" : ""} queued` : ""}`
          : `Sending ${queueCount} queued transfer${queueCount > 1 ? "s" : ""}...`}
      </span>
      {queueCount > 0 && (
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      )}
    </div>
  );
}
