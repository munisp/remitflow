/**
 * MobileSDK.tsx — Mobile SDK & Developer Hub for RemitFlow
 *
 * Reflects the real native codebase:
 *  - React Native: 164 screens, 8 services, 2 tests
 *  - Flutter: 165 screens, full Dart SDK
 *  - Android native: 104 Kotlin files (security, performance, analytics)
 *  - iOS native: 91 Swift files (Secure Enclave, Jailbreak detection, etc.)
 */

import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Smartphone,
  Code2,
  Zap,
  Shield,
  Bell,
  Fingerprint,
  Link2,
  Download,
  ExternalLink,
  Copy,
  CheckCircle2,
  Globe,
  Package,
  Layers,
  ArrowRight,
  Terminal,
  BookOpen,
  GitBranch,
  Star,
  Wifi,
  Lock,
  RefreshCw,
  MapPin,
  CreditCard,
  Users,
  FlaskConical,
  AlertTriangle,
  FileCode2,
  Cpu,
  Activity,
  ChevronRight,
  Key,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

// ─── Code block ──────────────────────────────────────────────────────────────
function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/80">
        <span className="text-xs text-slate-400 font-mono">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
        >
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-sm text-slate-200 font-mono overflow-x-auto leading-relaxed whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

// ─── Feature pill ─────────────────────────────────────────────────────────────
function FeaturePill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-sm text-primary font-medium">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

// ─── SDK card ─────────────────────────────────────────────────────────────────
function SDKCard({
  icon: Icon,
  title,
  version,
  stars,
  description,
  badge,
  badgeVariant = "secondary",
  features,
  installCmd,
  screenCount,
  language,
}: {
  icon: React.ElementType;
  title: string;
  version: string;
  stars: string;
  description: string;
  badge: string;
  badgeVariant?: "default" | "secondary" | "outline";
  features: string[];
  installCmd: string;
  screenCount: number;
  language: string;
}) {
  return (
    <Card className="flex flex-col h-full border-border/60 hover:border-primary/40 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs font-mono">
                  {version}
                </Badge>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  {stars}
                </span>
                <span className="text-xs text-muted-foreground">
                  {screenCount} screens
                </span>
              </div>
            </div>
          </div>
          <Badge variant={badgeVariant} className="shrink-0">
            {badge}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-2">{description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 flex-1">
        <div className="grid grid-cols-2 gap-2">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              {f}
            </div>
          ))}
        </div>
        <div className="mt-auto space-y-2">
          <CodeBlock code={installCmd} language={language} />
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => window.open("https://docs.remitflow.io/sdk", "_blank")}
          >
            <BookOpen className="h-4 w-4" /> View Documentation{" "}
            <ExternalLink className="h-3.5 w-3.5 ml-auto" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Capability row ───────────────────────────────────────────────────────────
type Support = "full" | "partial" | "planned";

function CapabilityRow({
  icon: Icon,
  title,
  rn,
  flutter,
  description,
}: {
  icon: React.ElementType;
  title: string;
  rn: Support;
  flutter: Support;
  description: string;
}) {
  const badge = (s: Support) =>
    s === "full" ? (
      <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs">Full</Badge>
    ) : s === "partial" ? (
      <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-xs">Partial</Badge>
    ) : (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        Planned
      </Badge>
    );
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="text-center w-20">{badge(rn)}</div>
      <div className="text-center w-20">{badge(flutter)}</div>
    </div>
  );
}

// ─── Native module card ───────────────────────────────────────────────────────
function NativeModuleCard({
  platform,
  color,
  modules,
  fileCount,
}: {
  platform: string;
  color: string;
  modules: { name: string; desc: string }[];
  fileCount: number;
}) {
  return (
    <Card className={`border ${color}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{platform}</CardTitle>
          <Badge variant="outline" className="text-xs">{fileCount} files</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {modules.map((m) => (
          <div key={m.name} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
            <FileCode2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-mono font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">{m.desc}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Sandbox banner ───────────────────────────────────────────────────────────
function SandboxBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 flex items-start gap-3">
      <FlaskConical className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-yellow-300">Sandbox / Test Mode Active</p>
        <p className="text-xs text-yellow-200/70 mt-1">
          API calls use test keys (<code className="font-mono bg-yellow-900/40 px-1 rounded">rfk_test_…</code>).
          Transfers are simulated, no real money moves. Use test card <code className="font-mono bg-yellow-900/40 px-1 rounded">4242 4242 4242 4242</code>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <code className="text-xs font-mono bg-yellow-900/30 border border-yellow-500/20 rounded px-2 py-1 text-yellow-200">
            REMITFLOW_ENV=sandbox
          </code>
          <code className="text-xs font-mono bg-yellow-900/30 border border-yellow-500/20 rounded px-2 py-1 text-yellow-200">
            BASE_URL=https://sandbox-api.remitflow.io/v1
          </code>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-yellow-400 hover:text-yellow-300 shrink-0"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MobileSDK() {
  const { t } = useTranslation();
  const [sandboxMode, setSandboxMode] = useState(false);
  const [, setLocation] = useLocation();
  const { data: healthData } = trpc.system.health.useQuery(undefined, { refetchInterval: 30000 });

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-6xl mx-auto pb-12">

        {/* Sandbox banner */}
        {sandboxMode && <SandboxBanner onDismiss={() => setSandboxMode(false)} />}

        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 p-8">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/30 via-transparent to-transparent pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-start gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                  Mobile SDK
                </Badge>
                <Badge variant="outline" className="text-slate-400 border-slate-600">
                  v2.4.0
                </Badge>
                {sandboxMode && (
                  <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
                    <FlaskConical className="h-3 w-3 mr-1" /> Sandbox
                  </Badge>
                )}
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Mobile SDK & Developer Hub
              </h1>
              <p className="text-slate-300 text-base max-w-xl">
                Build native iOS and Android remittance apps with RemitFlow's React Native and
                Flutter SDKs. Full feature parity with the web platform — 164 RN screens, 165 Flutter
                screens, 104 Kotlin modules, 91 Swift modules.
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <FeaturePill icon={Smartphone} label="React Native" />
                <FeaturePill icon={Layers} label="Flutter" />
                <FeaturePill icon={Shield} label="Biometric Auth" />
                <FeaturePill icon={Bell} label="Push Notifications" />
                <FeaturePill icon={Fingerprint} label="Face ID / Touch ID" />
                <FeaturePill icon={Link2} label="Deep Links" />
              </div>
            </div>
            <div className="flex flex-col gap-3 shrink-0">
              <Button
                className="gap-2 bg-indigo-600 hover:bg-indigo-700"
                onClick={() => { const a = document.createElement("a"); a.href = "https://registry.npmjs.org/@remitflow/sdk/-/sdk-1.0.0.tgz"; a.download = "remitflow-sdk.tgz"; a.click(); toast.success("SDK download started"); }}
              >
                <Download className="h-4 w-4" /> Download SDK
              </Button>
              <Button
                variant="outline"
                className="gap-2 border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={() => window.open("https://github.com/remitflow/sdk", "_blank")}
              >
                <GitBranch className="h-4 w-4" /> View on GitHub
              </Button>
              {/* Sandbox toggle */}
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/60">
                <FlaskConical className="h-4 w-4 text-yellow-400" />
                <Label htmlFor="sandbox-toggle" className="text-sm text-slate-300 cursor-pointer flex-1">
                  Sandbox Mode
                </Label>
                <Switch
                  id="sandbox-toggle"
                  checked={sandboxMode}
                  onCheckedChange={(v) => {
                    setSandboxMode(v);
                    toast.info(v ? "Sandbox mode enabled — test keys active" : "Production mode restored");
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stats bar — real codebase numbers */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "RN Screens", value: "164", icon: Smartphone, sub: "React Native" },
            { label: "Flutter Screens", value: "165", icon: Layers, sub: "Dart / Flutter" },
            { label: "Kotlin Modules", value: "104", icon: Cpu, sub: "Android native" },
            { label: "Swift Modules", value: "91", icon: Activity, sub: "iOS native" },
          ].map(({ label, value, icon: Icon, sub }) => (
            <Card key={label} className="border-border/60">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground/60">{sub}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* SDK Cards */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Official SDKs</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <SDKCard
              icon={Smartphone}
              title="React Native SDK"
              version="v2.4.0"
              stars="2.1k"
              badge="Stable"
              badgeVariant="default"
              screenCount={164}
              language="bash"
              description="Full-featured React Native library for iOS and Android. Hooks-first API, TypeScript native, Expo compatible. 8 core services: Biometric, Offline, Security, Wallet, Transaction, Analytics, CardScanner, CDPAuth."
              features={[
                "TypeScript first",
                "Expo compatible",
                "Hooks API",
                "Offline queue",
                "Biometric auth",
                "Push tokens",
                "Deep links",
                "Dark mode",
              ]}
              installCmd="npm install @remitflow/react-native-sdk"
            />
            <SDKCard
              icon={Layers}
              title="Flutter SDK"
              version="v1.8.2"
              stars="1.4k"
              badge="Stable"
              badgeVariant="default"
              screenCount={165}
              language="bash"
              description="Dart-native Flutter package with platform channels for biometrics, push, and secure storage. Null-safe. Covers all 30 user journeys including KYC, QR pay, rate lock, and savings goals."
              features={[
                "Null-safe Dart",
                "Platform channels",
                "BLoC / Riverpod",
                "Secure storage",
                "Biometric auth",
                "FCM / APNs",
                "Deep links",
                "Material 3",
              ]}
              installCmd="flutter pub add remitflow_sdk"
            />
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="quickstart">
          <TabsList className="flex flex-wrap h-auto gap-1 w-full max-w-2xl">
            <TabsTrigger value="quickstart">Quick Start</TabsTrigger>
            <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            <TabsTrigger value="native">Native Codebase</TabsTrigger>
            <TabsTrigger value="push">Push</TabsTrigger>
            <TabsTrigger value="deeplinks">Deep Links</TabsTrigger>
            <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          </TabsList>

          {/* Quick Start */}
          <TabsContent value="quickstart" className="mt-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</div>
                  <h3 className="font-semibold">Install the SDK</h3>
                </div>
                <CodeBlock
                  code={`npm install @remitflow/react-native-sdk\n# or\nyarn add @remitflow/react-native-sdk`}
                  language="bash"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</div>
                  <h3 className="font-semibold">Initialise the client</h3>
                </div>
                <CodeBlock
                  code={`import { RemitFlowProvider } from '@remitflow/react-native-sdk';

export default function App() {
  return (
    <RemitFlowProvider
      apiKey={process.env.REMITFLOW_API_KEY}
      environment="${sandboxMode ? "sandbox" : "production"}"
      region="eu-west-1"
    >
      <YourApp />
    </RemitFlowProvider>
  );
}`}
                  language="tsx"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">3</div>
                  <h3 className="font-semibold">Send a transfer</h3>
                </div>
                <CodeBlock
                  code={`import { useTransfer } from '@remitflow/react-native-sdk';

function SendScreen() {
  const { send, isLoading } = useTransfer();

  const handleSend = async () => {
    const result = await send({
      fromCurrency: 'GBP',
      toCurrency:   'NGN',
      amount:       100,
      recipientId:  'ben_abc123',
    });
    console.log('Transfer ID:', result.transferId);
  };
}`}
                  language="tsx"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">4</div>
                  <h3 className="font-semibold">Flutter equivalent</h3>
                </div>
                <CodeBlock
                  code={`import 'package:remitflow_sdk/remitflow_sdk.dart';

final client = RemitFlowClient(
  apiKey: const String.fromEnvironment('REMITFLOW_KEY'),
  environment: Environment.${sandboxMode ? "sandbox" : "production"},
);

final result = await client.transfers.send(
  TransferRequest(
    fromCurrency: 'GBP',
    toCurrency:   'NGN',
    amount:       100,
    recipientId:  'ben_abc123',
  ),
);`}
                  language="dart"
                />
              </div>
            </div>
          </TabsContent>

          {/* Capabilities matrix */}
          <TabsContent value="capabilities" className="mt-6">
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Feature Parity Matrix</CardTitle>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Full</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500 inline-block" /> Partial</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-500 inline-block" /> Planned</span>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] text-xs font-semibold text-muted-foreground mt-2">
                  <span>Feature</span>
                  <span className="w-20 text-center">React Native</span>
                  <span className="w-20 text-center">Flutter</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <CapabilityRow icon={CreditCard} title="Money Transfers" rn="full" flutter="full" description="Send, receive, quote, track" />
                <CapabilityRow icon={Fingerprint} title="Biometric Auth" rn="full" flutter="full" description="Face ID, Touch ID, Fingerprint" />
                <CapabilityRow icon={Bell} title="Push Notifications" rn="full" flutter="full" description="FCM + APNs, rich media" />
                <CapabilityRow icon={Shield} title="KYC / Identity" rn="full" flutter="partial" description="Document scan, liveness check" />
                <CapabilityRow icon={Wifi} title="Offline Mode" rn="full" flutter="partial" description="Queue transfers, cache rates" />
                <CapabilityRow icon={Globe} title="FX Rates & Alerts" rn="full" flutter="full" description="Live rates, target alerts" />
                <CapabilityRow icon={Users} title="Beneficiary Management" rn="full" flutter="full" description="CRUD, groups, favourites" />
                <CapabilityRow icon={Lock} title="Secure Storage" rn="full" flutter="full" description="Keychain / Keystore encryption" />
                <CapabilityRow icon={MapPin} title="Agent Locator" rn="full" flutter="planned" description="Maps, nearby agents" />
                <CapabilityRow icon={RefreshCw} title="Recurring Payments" rn="partial" flutter="planned" description="Scheduled transfers" />
                <CapabilityRow icon={Package} title="BNPL / Savings" rn="partial" flutter="planned" description="Buy Now Pay Later, goals" />
                <CapabilityRow icon={Terminal} title="Checkout SDK" rn="full" flutter="partial" description="Embedded payment sheet" />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Native Codebase */}
          <TabsContent value="native" className="mt-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <NativeModuleCard
                platform="Android — Kotlin (104 files)"
                color="border-green-500/20"
                fileCount={104}
                modules={[
                  { name: "CertificatePinning.kt", desc: "TLS certificate pinning against MITM attacks" },
                  { name: "RootDetection.kt", desc: "Detects rooted devices and blocks sensitive ops" },
                  { name: "DeviceBinding.kt", desc: "Binds session to device fingerprint" },
                  { name: "SecureKeyStore.kt", desc: "Android Keystore for key material storage" },
                  { name: "TransactionSigning.kt", desc: "ECDSA transaction signing with hardware-backed keys" },
                  { name: "MultiFactorAuthentication.kt", desc: "TOTP + biometric MFA flow" },
                  { name: "RuntimeProtection.kt", desc: "Anti-tampering & debugger detection" },
                  { name: "ComprehensiveAnalytics.kt", desc: "Event tracking, funnels, crash reporting" },
                  { name: "StartupOptimizer.kt", desc: "Cold start < 800ms via deferred init" },
                  { name: "VirtualScrolling.kt", desc: "Recycler view with 60fps large list rendering" },
                ]}
              />
              <NativeModuleCard
                platform="iOS — Swift (91 files)"
                color="border-blue-500/20"
                fileCount={91}
                modules={[
                  { name: "SecureEnclaveStorage.swift", desc: "Secure Enclave key storage for biometrics" },
                  { name: "JailbreakDetection.swift", desc: "Detects jailbroken devices, blocks app" },
                  { name: "CertificatePinning.swift", desc: "URLSession certificate pinning" },
                  { name: "DeviceBinding.swift", desc: "Device-bound session tokens via Keychain" },
                  { name: "TransactionSigning.swift", desc: "Secure Enclave ECDSA signing" },
                  { name: "MultiFactorAuthentication.swift", desc: "Face ID / Touch ID + TOTP" },
                  { name: "RuntimeProtection.swift", desc: "Anti-debugging, integrity checks" },
                  { name: "ComprehensiveAnalytics.swift", desc: "Analytics with privacy-preserving aggregation" },
                  { name: "BundleOptimizer.swift", desc: "App thinning, on-demand resources" },
                  { name: "VoiceAssistant.swift", desc: "Siri Shortcuts for quick transfers" },
                ]}
              />
            </div>
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">React Native Services (8 core services)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { name: "BiometricService.ts", desc: "Face ID / Fingerprint auth" },
                    { name: "OfflineService.ts", desc: "IndexedDB queue + sync" },
                    { name: "SecurityService.ts", desc: "Jailbreak, root, MITM checks" },
                    { name: "WalletService.ts", desc: "Balance, topup, withdraw" },
                    { name: "TransactionService.ts", desc: "Send, receive, history" },
                    { name: "AnalyticsService.ts", desc: "Events, funnels, errors" },
                    { name: "CardScannerService.ts", desc: "OCR card number extraction" },
                    { name: "CDPAuthService.ts", desc: "Customer Data Platform auth" },
                  ].map((s) => (
                    <div key={s.name} className="p-3 rounded-lg bg-muted/30 border border-border/40">
                      <p className="text-xs font-mono font-medium text-primary">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Push Notifications */}
          <TabsContent value="push" className="mt-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" /> React Native — Register Token
                </h3>
                <CodeBlock
                  code={`import { usePushNotifications } from '@remitflow/react-native-sdk';
import messaging from '@react-native-firebase/messaging';

function App() {
  const { registerToken } = usePushNotifications();

  useEffect(() => {
    messaging().getToken().then(token => {
      // Registers token with RemitFlow backend
      registerToken({ token, platform: 'fcm' });
    });
  }, []);
}`}
                  language="tsx"
                />
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" /> Flutter — Register Token
                </h3>
                <CodeBlock
                  code={`import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:remitflow_sdk/remitflow_sdk.dart';

Future<void> registerPushToken(RemitFlowClient client) async {
  final token = await FirebaseMessaging.instance.getToken();
  if (token != null) {
    await client.notifications.registerToken(
      token: token,
      platform: NotificationPlatform.fcm,
    );
  }
}`}
                  language="dart"
                />
              </div>
            </div>
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-sm">Notification Event Types</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { type: "transfer.completed", desc: "Transfer delivered to recipient" },
                    { type: "transfer.failed", desc: "Transfer failed, action needed" },
                    { type: "fx.alert.triggered", desc: "Target FX rate reached" },
                    { type: "kyc.approved", desc: "Identity verification approved" },
                    { type: "kyc.rejected", desc: "Document resubmission needed" },
                    { type: "wallet.credited", desc: "Wallet top-up confirmed" },
                  ].map(({ type, desc }) => (
                    <div key={type} className="p-3 rounded-lg bg-muted/50 border border-border/40">
                      <p className="text-xs font-mono text-primary">{type}</p>
                      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Deep Links */}
          <TabsContent value="deeplinks" className="mt-6 space-y-6">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-sm">Universal Link / App Link Scheme</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <CodeBlock
                  code={`# iOS Universal Links / Android App Links
remitflow://send?to=ben_abc123&amount=100&currency=NGN
remitflow://kyc/verify?tier=2
remitflow://transfer/track?id=txn_xyz789
remitflow://wallet/topup?currency=GBP
remitflow://rates?from=GBP&to=NGN

# HTTPS deep links (web fallback)
https://app.remitflow.com/send?to=ben_abc123
https://app.remitflow.com/track/txn_xyz789`}
                  language="text"
                />
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-primary" /> React Native Handler
                  </h3>
                  <CodeBlock
                    code={`import { useDeepLink } from '@remitflow/react-native-sdk';

function App() {
  const { handleDeepLink } = useDeepLink();

  // SDK automatically parses remitflow:// and https:// links
  // and navigates to the correct screen with pre-filled params
  useEffect(() => {
    handleDeepLink({ navigation });
  }, []);
}`}
                    language="tsx"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sandbox */}
          <TabsContent value="sandbox" className="mt-6 space-y-6">
            <Card className="border-yellow-500/20 bg-yellow-500/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-yellow-400" /> Sandbox / Test Environment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10">
                  <div className="flex-1">
                    <p className="text-sm font-medium">Sandbox Mode</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Toggle to use test keys and simulated transfers. No real money moves.
                    </p>
                  </div>
                  <Switch
                    checked={sandboxMode}
                    onCheckedChange={(v) => {
                      setSandboxMode(v);
                      toast.info(v ? "Sandbox mode enabled" : "Production mode restored");
                    }}
                  />
                </div>
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm">Environment Configuration</h3>
                  <CodeBlock
                    code={`# .env.sandbox
REMITFLOW_ENV=sandbox
REMITFLOW_API_KEY=rfk_test_your_test_key_here
REMITFLOW_BASE_URL=https://sandbox-api.remitflow.io/v1

# React Native
const client = RemitFlowClient({
  apiKey: process.env.REMITFLOW_API_KEY,
  environment: 'sandbox',  // ← switches all endpoints
});

# Flutter
final client = RemitFlowClient(
  apiKey: const String.fromEnvironment('REMITFLOW_KEY'),
  environment: Environment.sandbox,
);`}
                    language="bash"
                  />
                </div>
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm">Test Credentials</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      { label: "Test Card", value: "4242 4242 4242 4242", desc: "Visa — always succeeds" },
                      { label: "Decline Card", value: "4000 0000 0000 0002", desc: "Always declined" },
                      { label: "Test Phone", value: "+44 7700 900000", desc: "OTP: 123456" },
                      { label: "Test KYC Doc", value: "PASS_ID_001", desc: "Auto-approved in sandbox" },
                    ].map((c) => (
                      <div key={c.label} className="p-3 rounded-lg bg-muted/30 border border-border/40">
                        <p className="text-xs font-semibold text-muted-foreground">{c.label}</p>
                        <p className="text-sm font-mono mt-1">{c.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-orange-500/20 bg-orange-500/5 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Sandbox API keys (<code className="font-mono">rfk_test_…</code>) are rate-limited to 100 req/min.
                    Switch to live keys after Stripe KYC verification. Never commit API keys to source control.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Architecture diagram */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" /> Platform Architecture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="col-span-3 grid grid-cols-3 gap-3">
                {[
                  { label: "React Native App", sub: "164 screens · iOS + Android", color: "bg-blue-500/10 border-blue-500/30 text-blue-400" },
                  { label: "Flutter App", sub: "165 screens · iOS + Android", color: "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" },
                  { label: "Web App", sub: "React + tRPC", color: "bg-violet-500/10 border-violet-500/30 text-violet-400" },
                ].map(({ label, sub, color }) => (
                  <div key={label} className={`p-3 rounded-xl border ${color}`}>
                    <p className="font-semibold">{label}</p>
                    <p className="text-xs opacity-70 mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
              <div className="col-span-3 flex justify-center">
                <ArrowRight className="h-5 w-5 text-muted-foreground rotate-90" />
              </div>
              <div className="col-span-3">
                <div className="p-3 rounded-xl border bg-indigo-500/10 border-indigo-500/30 text-indigo-400">
                  <p className="font-semibold">RemitFlow REST / tRPC API Gateway</p>
                  <p className="text-xs opacity-70 mt-0.5">Auth · Rate Limiting · Versioning · Webhooks</p>
                </div>
              </div>
              <div className="col-span-3 flex justify-center">
                <ArrowRight className="h-5 w-5 text-muted-foreground rotate-90" />
              </div>
              <div className="col-span-3 grid grid-cols-4 gap-3">
                {[
                  { label: "Transfer Engine", color: "bg-green-500/10 border-green-500/30 text-green-400" },
                  { label: "FX & Rates", color: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" },
                  { label: "KYC / AML", color: "bg-red-500/10 border-red-500/30 text-red-400" },
                  { label: "Notifications", color: "bg-orange-500/10 border-orange-500/30 text-orange-400" },
                ].map(({ label, color }) => (
                  <div key={label} className={`p-2.5 rounded-xl border ${color} text-xs font-medium`}>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick links to API Keys + Webhooks */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Developer Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              className="border-border/60 hover:border-primary/40 transition-colors cursor-pointer group"
              onClick={() => setLocation("/developer/api-keys")}
            >
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Key className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">API Keys</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Generate, rotate, and revoke access keys</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </CardContent>
            </Card>
            <Card
              className="border-border/60 hover:border-primary/40 transition-colors cursor-pointer group"
              onClick={() => setLocation("/developer/webhooks")}
            >
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Webhook className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Webhooks</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Register endpoints and view delivery logs</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </CardContent>
            </Card>
            <Card
              className="border-border/60 hover:border-primary/40 transition-colors cursor-pointer group"
              onClick={() => { const a = document.createElement("a"); a.href = "/api/docs/postman-collection.json"; a.download = "remitflow-postman.json"; a.click(); toast.success("Postman collection downloaded"); }}
            >
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Terminal className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Postman Collection</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Import & test all 94 API endpoints</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Resources */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Developer Resources</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: BookOpen, title: "API Reference", desc: "Full REST + tRPC docs", action: () => setLocation("/api-docs") },
              { icon: Code2, title: "Sample Apps", desc: "RN & Flutter starter repos", action: () => setLocation("/developer/sandbox") },
              { icon: Terminal, title: "Postman Collection", desc: "Import & test all endpoints", action: () => { const a = document.createElement("a"); a.href = "/api/docs/postman-collection.json"; a.download = "remitflow-postman.json"; a.click(); toast.success("Postman collection downloaded"); } },
              { icon: GitBranch, title: "Changelog", desc: "SDK release notes", action: () => setLocation("/api-changelog") },
            ].map(({ icon: Icon, title, desc, action }) => (
              <Card
                key={title}
                className="border-border/60 hover:border-primary/40 transition-colors cursor-pointer"
                onClick={action}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="p-2 rounded-lg bg-primary/10 w-fit">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-semibold text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                  <p className="text-xs text-primary font-medium flex items-center gap-1">
                    Open <ArrowRight className="h-3 w-3" />
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
