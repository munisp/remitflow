import { useState, useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { X, Download, Smartphone, Wifi, Bell, RefreshCw, Share } from "lucide-react";

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAUpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) { console.log("[PWA] SW registered:", r?.scope); },
    onRegisterError(err) { console.warn("[PWA] SW error:", err); },
  });

  if (!needRefresh) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100vw-2rem)] max-w-sm">
      <div className="flex items-center gap-3 rounded-2xl bg-violet-600 px-4 py-3 shadow-2xl border border-violet-400/30">
        <RefreshCw className="h-5 w-5 text-white shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Update available</p>
          <p className="text-xs text-violet-200">A new version of RemitFlow is ready.</p>
        </div>
        <Button size="sm" onClick={() => updateServiceWorker(true)}
          className="bg-white text-violet-700 hover:bg-violet-50 h-8 px-3 text-xs font-semibold shrink-0">
          Update
        </Button>
      </div>
    </div>
  );
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSBanner, setShowIOSBanner] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone) {
      setIsInstalled(true);
      return;
    }
    if (isIOS()) {
      const dismissed = sessionStorage.getItem("pwa-ios-dismissed");
      if (!dismissed) { setTimeout(() => setShowIOSBanner(true), 3500); }
      return;
    }
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setIsInstalled(true);
    setShowBanner(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  if (isInstalled) return null;

  // iOS instructions
  if (showIOSBanner) return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96 animate-in slide-in-from-bottom-4 duration-300">
      <Card className="border border-blue-500/30 bg-gray-900/95 backdrop-blur-md shadow-2xl">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <p className="text-sm font-semibold text-white">Install RemitFlow</p>
            <button onClick={() => { sessionStorage.setItem("pwa-ios-dismissed","1"); setShowIOSBanner(false); }} className="text-gray-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2 text-xs text-gray-300">
            <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center font-bold shrink-0">1</span><span>Tap the <Share className="inline h-3.5 w-3.5 text-blue-400" /> Share button in Safari</span></div>
            <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center font-bold shrink-0">2</span><span>Tap <strong className="text-white">"Add to Home Screen"</strong></span></div>
            <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center font-bold shrink-0">3</span><span>Tap <strong className="text-white">Add</strong></span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96 animate-in slide-in-from-bottom-4 duration-300">
      <Card className="border border-indigo-500/30 bg-gray-900/95 backdrop-blur-md shadow-2xl shadow-indigo-500/10">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 border border-indigo-500/30">
              <Smartphone className="h-5 w-5 text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Install RemitFlow</p>
              <p className="text-xs text-gray-400 mt-0.5">Get the full app experience with offline access, push notifications, and instant loading.</p>
              <div className="flex gap-3 mt-2">
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Wifi className="h-3 w-3 text-green-400" /> Offline ready
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Bell className="h-3 w-3 text-yellow-400" /> Push alerts
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Download className="h-3 w-3 text-blue-400" /> Fast loads
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleInstall} className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white">
                  <Download className="h-3 w-3 mr-1" /> Install App
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-7 text-xs text-gray-400 hover:text-white">
                  Not now
                </Button>
              </div>
            </div>
            <button onClick={handleDismiss} className="shrink-0 text-gray-500 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PWAOfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const online = () => setIsOffline(false);
    const offline = () => setIsOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 text-center text-xs py-1.5 font-medium">
      <Wifi className="inline h-3 w-3 mr-1" />
      You are offline — showing cached data. Some features may be limited.
    </div>
  );
}
