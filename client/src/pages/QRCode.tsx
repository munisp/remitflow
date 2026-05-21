import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QrCode, Download, Share2, Copy, RefreshCw, Scan } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const CURRENCIES = ["USD","GBP","EUR","NGN","KES","GHS","ZAR"];

export default function QRCodePage() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [generated, setGenerated] = useState(false);
  const { data: profile, isLoading } = trpc.auth.me.useQuery();
  const { data: wallets = [] } = trpc.wallet.list.useQuery();
  const walletArr = Array.isArray(wallets) ? wallets : [];
  const qrRef = useRef<HTMLDivElement>(null);

  const qrData = JSON.stringify({ user: profile?.name, amount: amount || "any", currency, note, userId: (profile as any)?.id });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`;

  const handleGenerate = () => { if (!amount && !note) { toast.error("Add an amount or note to generate QR"); return; } setGenerated(true); toast.success("QR code generated!"); };
  const handleCopy = () => { navigator.clipboard.writeText(qrData); toast.success("QR data copied!"); };
  const handleDownload = () => { const a = document.createElement("a"); a.href = qrUrl; a.download = `remitflow-qr-${Date.now()}.png`; a.click(); toast.success("QR code downloaded!"); };
  const handleShare = async () => { if (navigator.share) { await navigator.share({ title: "RemitFlow Payment QR", text: `Pay ${profile?.name} via RemitFlow`, url: qrUrl }); } else { handleCopy(); } };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><QrCode className="w-6 h-6 text-primary" />Payment QR Code</h1>
          <p className="text-muted-foreground text-sm mt-1">Generate a QR code for others to pay you instantly</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Configure Payment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount (optional)</Label><Input className="mt-1" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></div>
              <div><Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Note (optional)</Label><Input className="mt-1" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Invoice #1234, Rent payment" /></div>
            <Button className="w-full" onClick={handleGenerate}><QrCode className="w-4 h-4 mr-2" />Generate QR Code</Button>
          </CardContent>
        </Card>

        {generated && (
          <Card>
            <CardHeader><CardTitle className="text-center">Your Payment QR</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <div ref={qrRef} className="p-4 bg-white rounded-xl border-2 border-primary/20 shadow-sm">
                <img src={qrUrl} alt="Payment QR Code" className="w-48 h-48" />
              </div>
              <div className="text-center">
                <p className="font-semibold">{profile?.name ?? "RemitFlow User"}</p>
                {amount && <p className="text-lg font-bold text-primary">{currency} {parseFloat(amount).toLocaleString()}</p>}
                {note && <p className="text-sm text-muted-foreground">{note}</p>}
              </div>
              <div className="flex gap-2 w-full">
                <Button variant="outline" className="flex-1" onClick={handleDownload}><Download className="w-4 h-4 mr-2" />Download</Button>
                <Button variant="outline" className="flex-1" onClick={handleShare}><Share2 className="w-4 h-4 mr-2" />Share</Button>
                <Button variant="outline" size="icon" onClick={handleCopy}><Copy className="w-4 h-4" /></Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">Anyone who scans this QR code can send you a payment via RemitFlow</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Scan className="w-4 h-4" />Scan to Pay</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">To pay someone, use the Send Money flow and tap "Scan QR" to scan their payment code. Works with any RemitFlow QR code.</p>
            <Button variant="outline" className="w-full mt-3" onClick={() => window.location.href = "/send"}><Scan className="w-4 h-4 mr-2" />Go to Send Money</Button>
          </CardContent>
        </Card>

        {walletArr.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Your Wallets</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {walletArr.slice(0, 4).map((w: any) => (
                <div key={w.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="text-sm font-medium">{w.currency} Wallet</span>
                  <span className="font-semibold">{w.currency} {Number(w.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
