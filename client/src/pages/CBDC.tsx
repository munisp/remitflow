import { useState, useRef, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Coins, ArrowRightLeft, Wallet, Globe, Shield,
  QrCode, History, Camera, CameraOff, CheckCircle2,
  Clock, ArrowDownLeft, ArrowUpRight, RefreshCw,
  ChevronRight, AlertCircle, Copy, Share2, Link2
} from "lucide-react";
import { toast } from "sonner";
import jsQR from "jsqr";
import QRCode from "qrcode";

const CBDC_CURRENCIES = [
  { code: "eNGN", name: "Digital Naira", country: "Nigeria", flag: "🇳🇬", status: "pilot", color: "bg-green-100 text-green-800" },
  { code: "eSAR", name: "Digital Riyal", country: "Saudi Arabia", flag: "🇸🇦", status: "pilot", color: "bg-green-100 text-green-800" },
  { code: "eGHS", name: "Digital Cedi", country: "Ghana", flag: "🇬🇭", status: "research", color: "bg-yellow-100 text-yellow-800" },
  { code: "eKES", name: "Digital Shilling", country: "Kenya", flag: "🇰🇪", status: "research", color: "bg-yellow-100 text-yellow-800" },
  { code: "eZAR", name: "Digital Rand", country: "South Africa", flag: "🇿🇦", status: "research", color: "bg-yellow-100 text-yellow-800" },
  { code: "eCNY", name: "Digital Yuan", country: "China", flag: "🇨🇳", status: "live", color: "bg-blue-100 text-blue-800" },
  { code: "eEUR", name: "Digital Euro", country: "EU", flag: "🇪🇺", status: "pilot", color: "bg-green-100 text-green-800" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  completed:  { bg: "bg-green-100", text: "text-green-700",  label: "Completed" },
  pending:    { bg: "bg-amber-100",  text: "text-amber-700",  label: "Pending" },
  failed:     { bg: "bg-red-100",    text: "text-red-700",    label: "Failed" },
  processing: { bg: "bg-blue-100",   text: "text-blue-700",   label: "Processing" },
};

// ─── QR Scanner Hook ──────────────────────────────────────────────────────────
function useQrScanner(onScan: (data: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startScan = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setScanning(true);
    } catch {
      setError("Camera access denied. Please allow camera permissions or use manual entry.");
    }
  }, []);

  const stopScan = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    cancelAnimationFrame(animRef.current);
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animRef.current = requestAnimationFrame(tick); return;
      }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
      if (code?.data) { onScan(code.data); stopScan(); return; }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [scanning, onScan, stopScan]);

  useEffect(() => () => stopScan(), [stopScan]);
  return { videoRef, canvasRef, scanning, error, startScan, stopScan };
}

// ─── Receive Tab ──────────────────────────────────────────────────────────────
// ─── My QR Component ─────────────────────────────────────────────────────────
function MyQrDisplay({ currency, onClose }: { currency: string; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState(currency);

  const generateMutation = trpc.cbdc.generatePaymentRequest.useMutation({
    onSuccess: async (data) => {
      setWalletAddress(data.walletAddress);
      setDeepLinkUrl(data.qrData ?? null); // qrData is now the deep-link URL
      setExpiry(data.expiresAt ? new Date(data.expiresAt).toLocaleTimeString() : null);
      try {
        const url = await QRCode.toDataURL(data.qrData ?? '', {
          width: 240,
          margin: 2,
          color: { dark: "#1e1b4b", light: "#ffffff" },
        });
        setQrDataUrl(url);
      } catch {
        toast.error("Failed to render QR code");
      }
    },
    onError: (e) => toast.error("Failed to generate QR", { description: e.message }),
  });

  const handleGenerate = () => {
    generateMutation.mutate({
      currency: selectedCurrency,
      amount: amount ? parseFloat(amount) : 0,
      purpose: purpose || undefined,
    });
  };

  const handleCopyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress).then(() => toast.success("Wallet address copied!"));
    }
  };

  // Deep-link URL stored from the last generatePaymentRequest response
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);

  const handleShareLink = async () => {
    const url = deepLinkUrl ?? walletAddress ?? "";
    if (!url) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "RemitFlow Payment Request",
          text: `Send me ${amount ? `${parseFloat(amount).toLocaleString()} ${selectedCurrency}` : selectedCurrency}${purpose ? ` for ${purpose}` : ""} via RemitFlow`,
          url,
        });
      } catch {
        // User dismissed share sheet — fall back to clipboard
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard!");
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Payment link copied to clipboard!");
    }
  };

  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <QrCode className="w-4 h-4" /> My Payment QR Code
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!qrDataUrl ? (
          <>
            <p className="text-sm text-muted-foreground">
              Generate a QR code that others can scan to send you CBDC directly.
            </p>
            <div>
              <Label className="text-xs">Currency</Label>
              <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CBDC_CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.flag} {c.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Request Amount (optional)</Label>
              <Input type="number" placeholder="Leave blank for any amount" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Purpose (optional)</Label>
              <Input placeholder="e.g. Invoice #1234, Rent..." value={purpose} onChange={e => setPurpose(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 gap-2" onClick={handleGenerate} disabled={generateMutation.isPending}>
                {generateMutation.isPending
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</>
                  : <><QrCode className="w-4 h-4" /> Generate QR</>}
              </Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-white rounded-xl border-2 border-purple-200 shadow-sm">
                <img src={qrDataUrl} alt="Payment QR Code" className="w-48 h-48" />
              </div>
              {expiry && (
                <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full">
                  <Clock className="w-3 h-3" /> Expires at {expiry} (15 min)
                </div>
              )}
              {amount && (
                <p className="text-sm font-semibold text-center">
                  Requesting {parseFloat(amount).toLocaleString()} {selectedCurrency}
                </p>
              )}
              {purpose && <p className="text-xs text-muted-foreground text-center">{purpose}</p>}
            </div>
            {walletAddress && (
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Your wallet address</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono truncate flex-1">{walletAddress}</code>
                  <button onClick={handleCopyAddress} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleShareLink}>
                <Share2 className="w-3.5 h-3.5" /> Share Link
              </Button>
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => {
                if (deepLinkUrl) { navigator.clipboard.writeText(deepLinkUrl).then(() => toast.success("Link copied!")); }
              }}>
                <Link2 className="w-3.5 h-3.5" /> Copy Link
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setQrDataUrl(null); setWalletAddress(null); setDeepLinkUrl(null); }}>
                Regenerate
              </Button>
              <Button variant="outline" className="flex-1" onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReceiveTab() {
  // ── Deep-link: parse URL params like /cbdc?amount=100&currency=eNGN&purpose=Invoice&wallet=cbdc:123:eNGN
  const [mode, setMode] = useState<"qr" | "manual" | "myqr">("qr");
  const [parsed, setParsed] = useState<{ walletAddress: string; amount: number; currency: string; purpose?: string } | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const wallet = p.get("wallet");
    const amount = p.get("amount");
    const currency = p.get("currency");
    const purpose = p.get("purpose") ?? undefined;
    if (wallet && amount && currency) {
      // Clean up URL without reload
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      return { walletAddress: wallet, amount: parseFloat(amount), currency, purpose };
    }
    return null;
  });
  const [manualTransferId, setManualTransferId] = useState("");
  const [manualSender, setManualSender] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualCurrency, setManualCurrency] = useState("eNGN");
  const [manualPurpose, setManualPurpose] = useState("");
  const [success, setSuccess] = useState(false);

  const receiveMutation = trpc.cbdc.receive.useMutation({
    onSuccess: (data) => {
      if (data.duplicate) {
        toast.warning("Duplicate transfer", { description: "This transfer has already been processed." });
      } else {
        setSuccess(true);
        toast.success("CBDC received!", { description: `Transfer ${data.reference} credited to your wallet.` });
      }
    },
    onError: (e) => toast.error("Receive failed", { description: e.message }),
  });

  const handleQrScan = useCallback((raw: string) => {
    // Support both deep-link URL format and legacy JSON format
    try {
      // Try URL format first: /cbdc?wallet=...&amount=...&currency=...
      if (raw.includes('wallet=') && raw.includes('amount=') && raw.includes('currency=')) {
        const url = new URL(raw);
        const wallet = url.searchParams.get('wallet');
        const amount = url.searchParams.get('amount');
        const currency = url.searchParams.get('currency');
        const purpose = url.searchParams.get('purpose') ?? undefined;
        if (wallet && amount && currency) {
          setParsed({ walletAddress: wallet, amount: parseFloat(amount), currency, purpose });
          toast.success('QR code scanned!', { description: `${amount} ${currency} payment request detected.` });
          return;
        }
      }
      // Fall back to legacy JSON format
      const data = JSON.parse(raw);
      if (data.walletAddress && data.amount && data.currency) {
        setParsed(data);
        toast.success('QR code scanned!', { description: `${data.amount} ${data.currency} payment request detected.` });
      } else {
        toast.error('Invalid QR code', { description: 'This QR code does not contain a valid CBDC payment request.' });
      }
    } catch {
      toast.error('Invalid QR code', { description: 'Could not parse QR code data.' });
    }
  }, []);
  const { videoRef, canvasRef, scanning, error: camError, startScan, stopScan } = useQrScanner(handleQrScan);
  const { data: rateStatus } = trpc.cbdc.receiveRateStatus.useQuery(undefined, { refetchInterval: 30_000 });

  const handleConfirmQr = () => {
    if (!parsed) return;
    receiveMutation.mutate({
      transferId: `QR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      senderWallet: parsed.walletAddress,
      amount: parsed.amount,
      currency: parsed.currency,
      purpose: parsed.purpose,
    });
  };

  const handleManualSubmit = () => {
    if (!manualTransferId || !manualSender || !manualAmount) return;
    receiveMutation.mutate({
      transferId: manualTransferId.trim(),
      senderWallet: manualSender.trim(),
      amount: parseFloat(manualAmount),
      currency: manualCurrency,
      purpose: manualPurpose || undefined,
    });
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-semibold">Transfer Received!</h3>
        <p className="text-muted-foreground text-sm text-center max-w-xs">
          Your CBDC wallet has been credited. The balance will reflect immediately.
        </p>
        <Button variant="outline" onClick={() => { setSuccess(false); setParsed(null); }}>
          Receive Another
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      {rateStatus && (
        <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium border ${
          rateStatus.remaining === 0
            ? 'bg-red-50 border-red-200 text-red-700'
            : rateStatus.remaining <= 3
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          <span>
            {rateStatus.remaining === 0
              ? '⛔ Hourly receive limit reached'
              : `✅ ${rateStatus.remaining} of ${rateStatus.limit} receives remaining this hour`}
          </span>
          {rateStatus.remaining === 0 && (
            <span className="opacity-75">
              Resets {new Date(rateStatus.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant={mode === "qr" ? "default" : "outline"} size="sm" onClick={() => { setMode("qr"); stopScan(); }} className="flex-1 gap-2">
          <QrCode className="w-4 h-4" /> Scan QR
        </Button>
        <Button variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => { setMode("manual"); stopScan(); }} className="flex-1 gap-2">
          <ChevronRight className="w-4 h-4" /> Manual
        </Button>
        <Button variant={mode === "myqr" ? "default" : "outline"} size="sm" onClick={() => { setMode("myqr"); stopScan(); }} className="flex-1 gap-2">
          <Wallet className="w-4 h-4" /> My QR
        </Button>
      </div>

      {mode === "qr" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><QrCode className="w-4 h-4" /> Scan Payment Request QR</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!parsed ? (
              <>
                <div className="relative rounded-lg overflow-hidden bg-black aspect-square max-h-64">
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  <canvas ref={canvasRef} className="hidden" />
                  {!scanning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
                      <Camera className="w-10 h-10 text-white/70" />
                      <p className="text-white/70 text-sm">Camera inactive</p>
                    </div>
                  )}
                  {scanning && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-primary rounded-tl" />
                      <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-primary rounded-tr" />
                      <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-primary rounded-bl" />
                      <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-primary rounded-br" />
                    </div>
                  )}
                </div>
                {camError && (
                  <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{camError}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  {!scanning ? (
                    <Button className="flex-1 gap-2" onClick={startScan}><Camera className="w-4 h-4" /> Start Camera</Button>
                  ) : (
                    <Button variant="outline" className="flex-1 gap-2" onClick={stopScan}><CameraOff className="w-4 h-4" /> Stop Camera</Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Point the camera at a CBDC payment request QR code generated by another user.
                </p>
              </>
            ) : (
              <div className="space-y-4">
                {/* ─── One-tap confirm card ─────────────────────────────── */}
                <div className="rounded-xl border-2 border-green-300 bg-gradient-to-b from-green-50 to-white overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-green-100 border-b border-green-200">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="font-semibold text-green-800 text-sm">Payment Request Detected</span>
                    <Badge className="ml-auto bg-green-600 text-white text-xs">Ready to Receive</Badge>
                  </div>
                  {/* Amount hero */}
                  <div className="flex flex-col items-center py-5 gap-1">
                    <span className="text-3xl font-bold tracking-tight">
                      {parsed.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-lg font-semibold text-muted-foreground">{parsed.currency}</span>
                    {parsed.purpose && (
                      <span className="mt-1 text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-full">{parsed.purpose}</span>
                    )}
                  </div>
                  {/* Details grid */}
                  <div className="px-4 pb-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Sender wallet</span>
                      <span className="font-mono text-xs max-w-[160px] truncate">{parsed.walletAddress}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Action</span>
                      <span className="text-green-700 font-medium">Credit your {parsed.currency} wallet</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Settlement</span>
                      <span className="font-medium">Instant · On-chain record</span>
                    </div>
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700" onClick={handleConfirmQr} disabled={receiveMutation.isPending}>
                    {receiveMutation.isPending
                      ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing...</>
                      : <><ArrowDownLeft className="w-4 h-4" /> Confirm & Receive</>}
                  </Button>
                  <Button variant="outline" onClick={() => setParsed(null)}>Rescan</Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  By confirming, you acknowledge receipt of the CBDC transfer. This action is irreversible.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {mode === "myqr" && (
        <MyQrDisplay currency={manualCurrency} onClose={() => setMode("qr")} />
      )}

      {mode === "manual" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Manual Transfer Entry</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">Transfer ID <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. CBDC-1234567890-ABCDEF" value={manualTransferId} onChange={e => setManualTransferId(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Unique reference provided by the sender.</p>
            </div>
            <div>
              <Label className="text-xs">Sender Wallet Address <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. cbdc:42:eNGN or 0x1234..." value={manualSender} onChange={e => setManualSender(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount <span className="text-destructive">*</span></Label>
                <Input type="number" placeholder="0.00" value={manualAmount} onChange={e => setManualAmount(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={manualCurrency} onValueChange={setManualCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CBDC_CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.flag} {c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Purpose (optional)</Label>
              <Input placeholder="e.g. School fees, Rent..." value={manualPurpose} onChange={e => setManualPurpose(e.target.value)} />
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleManualSubmit}
              disabled={!manualTransferId || !manualSender || !manualAmount || receiveMutation.isPending}
            >
              {receiveMutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing...</>
                : <><ArrowDownLeft className="w-4 h-4" /> Record Received Transfer</>}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── History Tab ──────────────────────────────────────────────────────────────
function HistoryTab() {
  const { data: txns = [], isLoading, refetch } = trpc.cbdc.transactions.useQuery({ limit: 20 });

  const formatDate = (d: Date | string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const copyRef = (ref: string) => {
    navigator.clipboard.writeText(ref).then(() => toast.success("Copied to clipboard"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Loading..." : `${(txns as any[]).length} recent transaction${(txns as any[]).length !== 1 ? "s" : ""}`}
        </p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : (txns as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <History className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">No CBDC transactions yet.</p>
          <p className="text-xs text-muted-foreground">Transfers you send or receive will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(txns as any[]).map((tx: any) => {
            const isReceive = tx.type === "receive";
            const statusInfo = STATUS_COLORS[tx.status] ?? STATUS_COLORS.pending;
            return (
              <div key={tx.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isReceive ? "bg-green-100" : "bg-blue-100"}`}>
                  {isReceive
                    ? <ArrowDownLeft className="w-4 h-4 text-green-600" />
                    : <ArrowUpRight className="w-4 h-4 text-blue-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{tx.description || (isReceive ? "CBDC Received" : "CBDC Sent")}</span>
                    <Badge className={`text-xs shrink-0 ${statusInfo.bg} ${statusInfo.text} border-0`}>{statusInfo.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDate(tx.createdAt)}
                    </span>
                    {tx.reference && (
                      <button
                        className="text-xs text-muted-foreground font-mono truncate max-w-[120px] hover:text-foreground flex items-center gap-1"
                        onClick={() => copyRef(tx.reference)}
                        title="Copy reference"
                      >
                        <Copy className="w-3 h-3" />
                        {String(tx.reference).slice(0, 16)}…
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-semibold ${isReceive ? "text-green-600" : "text-foreground"}`}>
                    {isReceive ? "+" : "−"}{Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground">{tx.currency}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CBDC() {
  const { data: wallets = [], refetch } = trpc.cbdc.wallets.useQuery();
  const transferMutation = trpc.cbdc.transfer.useMutation({
    onSuccess: (d) => { toast.success(`CBDC transfer initiated! Ref: ${d.reference}`); refetch(); setAmount(""); setRecipient(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const [selectedCurrency, setSelectedCurrency] = useState("eNGN");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  // Auto-switch to receive tab when deep-link params are present
  const [tab, setTab] = useState<"wallets" | "transfer" | "receive" | "history" | "corridors">(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("wallet") && p.get("amount") && p.get("currency")) return "receive";
    return "wallets";
  });

  const walletList = Array.isArray(wallets) ? wallets : [];
  const selectedWallet = walletList.find((w: any) => w.currency === selectedCurrency);

  const TABS = [
    { key: "wallets",   label: "Wallets",   icon: <Wallet className="w-3.5 h-3.5" /> },
    { key: "transfer",  label: "Send",      icon: <ArrowUpRight className="w-3.5 h-3.5" /> },
    { key: "receive",   label: "Receive",   icon: <ArrowDownLeft className="w-3.5 h-3.5" /> },
    { key: "history",   label: "History",   icon: <History className="w-3.5 h-3.5" /> },
    { key: "corridors", label: "Corridors", icon: <Globe className="w-3.5 h-3.5" /> },
  ] as const;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Coins className="w-7 h-7 text-purple-600" /> CBDC — Central Bank Digital Currencies
          </h1>
          <p className="text-muted-foreground">Send and receive government-issued digital currencies across borders</p>
        </div>

        {/* Info Banner */}
        <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950/20">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <Shield className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-purple-900 dark:text-purple-100">Government-Backed Digital Money</p>
                <p className="text-sm text-purple-700 dark:text-purple-300">
                  CBDCs are digital forms of national currencies issued by central banks. They offer instant settlement,
                  programmable payments, and financial inclusion for the unbanked.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-1 border-b overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── Wallets ── */}
        {tab === "wallets" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {CBDC_CURRENCIES.map(c => {
              const wallet = walletList.find((w: any) => w.currency === c.code);
              return (
                <Card key={c.code} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{c.flag}</span>
                        <div>
                          <p className="font-semibold">{c.code}</p>
                          <p className="text-xs text-muted-foreground">{c.name}</p>
                        </div>
                      </div>
                      <Badge className={`text-xs ${c.color}`}>{c.status}</Badge>
                    </div>
                    <p className="text-2xl font-bold">
                      {wallet ? Number(wallet.balance).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{c.country}</p>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => { setSelectedCurrency(c.code); setTab("transfer"); }}>
                        <ArrowRightLeft className="w-3 h-3 mr-1" /> Send
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setTab("receive")}>
                        <ArrowDownLeft className="w-3 h-3 mr-1" /> Receive
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* ── Send ── */}
        {tab === "transfer" && (
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5" /> CBDC Transfer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>From CBDC Wallet</Label>
                <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CBDC_CURRENCIES.map(c => (
                      <SelectItem key={c.code} value={c.code}>{c.flag} {c.code} — {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedWallet && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Balance: {Number(selectedWallet.balance).toLocaleString()} {selectedCurrency}
                  </p>
                )}
              </div>
              <div>
                <Label>Recipient Wallet Address</Label>
                <Input placeholder="e.g. 0x1234...abcd or phone number" value={recipient} onChange={e => setRecipient(e.target.value)} />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Network Fee</span><span>0.00 {selectedCurrency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Settlement Time</span><span className="text-green-600">Instant</span></div>
                <div className="flex justify-between font-medium"><span>Total</span><span>{amount || "0.00"} {selectedCurrency}</span></div>
              </div>
              <Button className="w-full" disabled={!amount || !recipient || transferMutation.isPending}
                onClick={() => transferMutation.mutate({ to: recipient, currency: selectedCurrency, amount: parseFloat(amount), description: "CBDC Transfer" })}>
                {transferMutation.isPending ? "Processing..." : "Send CBDC"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Receive ── */}
        {tab === "receive" && <ReceiveTab />}

        {/* ── History ── */}
        {tab === "history" && <HistoryTab />}

        {/* ── Corridors ── */}
        {tab === "corridors" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">Active CBDC cross-border corridors with real-time settlement</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { from: "🇳🇬 eNGN", to: "🇸🇦 eSAR", volume: "₦2.4B", status: "live", latency: "< 3s" },
                { from: "🇳🇬 eNGN", to: "🇨🇳 eCNY", volume: "₦890M", status: "live", latency: "< 5s" },
                { from: "🇬🇭 eGHS", to: "🇳🇬 eNGN", volume: "GH₵120M", status: "pilot", latency: "< 10s" },
                { from: "🇰🇪 eKES", to: "🇳🇬 eNGN", volume: "KSh340M", status: "pilot", latency: "< 8s" },
                { from: "🇪🇺 eEUR", to: "🇳🇬 eNGN", volume: "€45M", status: "live", latency: "< 4s" },
              ].map((c, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.from}</span>
                        <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{c.to}</span>
                      </div>
                      <Badge className={c.status === "live" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>{c.status}</Badge>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span>Volume: {c.volume}/day</span>
                      <span>Latency: {c.latency}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
