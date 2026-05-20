#!/usr/bin/env python3
"""Generate pages - Part 3: Compliance, Settings, Account, Operations pages"""
import os

D = "/home/ubuntu/remitflow/client/src/pages"
os.makedirs(D, exist_ok=True)

pages = {}

# ── Profile ──────────────────────────────────────────────────────────────────
pages["Profile"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Mail, Phone, MapPin, Shield, Edit2 } from "lucide-react";
import { toast } from "sonner";

export default function Profile() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name ?? "Demo User", email: user?.email ?? "demo@remitflow.com", phone: "+234 801 234 5678", country: "Nigeria", city: "Lagos" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">My Profile</h1><p className="text-muted-foreground text-sm">Manage your personal information</p></div>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-5 mb-6">
              <Avatar className="h-20 w-20"><AvatarFallback className="text-2xl bg-primary/10 text-primary">{(user?.name ?? "D")[0]}</AvatarFallback></Avatar>
              <div>
                <div className="text-xl font-bold">{form.name}</div>
                <div className="text-muted-foreground text-sm">{form.email}</div>
                <div className="flex gap-2 mt-2">
                  <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">Verified</Badge>
                  <Badge variant="secondary" className="text-xs">Tier 2</Badge>
                </div>
              </div>
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditing(!editing)}>
                <Edit2 className="h-4 w-4 mr-1" />{editing ? "Cancel" : "Edit"}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { label: "Full Name", key: "name", icon: User },
                { label: "Email", key: "email", icon: Mail },
                { label: "Phone", key: "phone", icon: Phone },
                { label: "Country", key: "country", icon: MapPin },
                { label: "City", key: "city", icon: MapPin },
              ].map(({ label, key, icon: Icon }) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" />{label}</label>
                  {editing
                    ? <Input value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
                    : <div className="px-3 py-2 bg-muted/30 rounded-md text-sm">{(form as any)[key]}</div>
                  }
                </div>
              ))}
            </div>
            {editing && (
              <Button className="mt-4 w-full" onClick={() => { setEditing(false); toast.success("Profile updated!"); }}>Save Changes</Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Account Statistics</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 text-center">
            {[{ label: "Transactions", value: "247" }, { label: "Countries Sent", value: "12" }, { label: "Member Since", value: "2022" }].map(s => (
              <div key={s.label}><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── SecuritySettings ──────────────────────────────────────────────────────────
pages["SecuritySettings"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Shield, Key, Smartphone, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";

export default function SecuritySettings() {
  const [twoFA, setTwoFA] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [txAlerts, setTxAlerts] = useState(true);

  const sessions = [
    { id: 1, device: "Chrome on MacOS", location: "Lagos, Nigeria", lastSeen: "Active now", current: true },
    { id: 2, device: "Mobile App (iOS)", location: "Abuja, Nigeria", lastSeen: "2 hours ago", current: false },
    { id: 3, device: "Firefox on Windows", location: "London, UK", lastSeen: "3 days ago", current: false },
  ];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">Security Settings</h1><p className="text-muted-foreground text-sm">Protect your account</p></div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" />Authentication</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Two-Factor Authentication", desc: "Extra security via authenticator app", icon: Smartphone, value: twoFA, set: setTwoFA },
              { label: "Biometric Login", desc: "Use fingerprint or face ID", icon: Key, value: biometric, set: setBiometric },
              { label: "Login Alerts", desc: "Email me on new device login", icon: AlertTriangle, value: loginAlerts, set: setLoginAlerts },
              { label: "Transaction Alerts", desc: "Notify on every transaction", icon: CheckCircle2, value: txAlerts, set: setTxAlerts },
            ].map(item => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <div><div className="text-sm font-medium">{item.label}</div><div className="text-xs text-muted-foreground">{item.desc}</div></div>
                  </div>
                  <Switch checked={item.value} onCheckedChange={v => { item.set(v); toast.success(item.label + " " + (v ? "enabled" : "disabled")); }} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" />Change Password</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input type="password" placeholder="Current password" />
            <Input type="password" placeholder="New password" />
            <Input type="password" placeholder="Confirm new password" />
            <Button className="w-full" onClick={() => toast.success("Password updated!")}>Update Password</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Active Sessions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">{s.device}{s.current && <Badge className="text-xs bg-emerald-100 text-emerald-700 border-0">Current</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{s.location} · {s.lastSeen}</div>
                </div>
                {!s.current && <Button size="sm" variant="outline" className="text-destructive" onClick={() => toast.success("Session revoked")}>Revoke</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── Notifications ─────────────────────────────────────────────────────────────
pages["Notifications"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Mail, Smartphone, MessageSquare, CheckCircle2, ArrowRightLeft, Shield, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function Notifications() {
  const [prefs, setPrefs] = useState({
    emailTx: true, emailSecurity: true, emailMarketing: false,
    pushTx: true, pushSecurity: true, pushMarketing: true,
    smsTx: false, smsOTP: true,
  });

  const recent = [
    { id: 1, type: "transaction", title: "Transfer Completed", body: "₦50,000 sent to Emeka Okafor", time: "2 min ago", read: false },
    { id: 2, type: "security", title: "New Login Detected", body: "New login from Chrome on MacOS", time: "1 hour ago", read: false },
    { id: 3, type: "rate", title: "Rate Alert Triggered", body: "USD/NGN reached your target of 1,580", time: "3 hours ago", read: true },
    { id: 4, type: "transaction", title: "Transfer Received", body: "₦25,000 received from Adaeze Obi", time: "Yesterday", read: true },
    { id: 5, type: "kyc", title: "KYC Approved", body: "Your Tier 2 verification was approved", time: "2 days ago", read: true },
  ];

  const ICONS: Record<string, any> = { transaction: ArrowRightLeft, security: Shield, rate: TrendingUp, kyc: CheckCircle2 };
  const COLORS: Record<string, string> = { transaction: "bg-blue-100 text-blue-600", security: "bg-red-100 text-red-600", rate: "bg-emerald-100 text-emerald-600", kyc: "bg-purple-100 text-purple-600" };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">Notifications</h1><p className="text-muted-foreground text-sm">Manage your notification preferences</p></div>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent Notifications</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recent.map(n => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <div key={n.id} className={"flex gap-3 p-3 rounded-lg " + (n.read ? "opacity-60" : "bg-primary/5")}>
                  <div className={"w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 " + (COLORS[n.type] ?? "bg-gray-100 text-gray-600")}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">{n.title}</div>
                      {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                    </div>
                    <div className="text-xs text-muted-foreground">{n.body}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{n.time}</div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Email Notifications</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "emailTx", label: "Transaction updates" },
              { key: "emailSecurity", label: "Security alerts" },
              { key: "emailMarketing", label: "Promotions & offers" },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="text-sm">{item.label}</span>
                <Switch checked={(prefs as any)[item.key]} onCheckedChange={v => { setPrefs(p => ({ ...p, [item.key]: v })); toast.success("Preference saved"); }} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Smartphone className="h-4 w-4" />Push Notifications</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "pushTx", label: "Transaction updates" },
              { key: "pushSecurity", label: "Security alerts" },
              { key: "pushMarketing", label: "Promotions & offers" },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="text-sm">{item.label}</span>
                <Switch checked={(prefs as any)[item.key]} onCheckedChange={v => { setPrefs(p => ({ ...p, [item.key]: v })); toast.success("Preference saved"); }} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── Settings ──────────────────────────────────────────────────────────────────
pages["Settings"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Settings2, Globe, Bell, Shield, CreditCard, Trash2, Download, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Settings() {
  const { logout } = useAuth();
  const [currency, setCurrency] = useState("NGN");
  const [language, setLanguage] = useState("en");
  const [darkMode, setDarkMode] = useState(false);
  const [compactView, setCompactView] = useState(false);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">Settings</h1><p className="text-muted-foreground text-sm">Customize your experience</p></div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />Preferences</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Default Currency</div><div className="text-xs text-muted-foreground">Used for display and calculations</div></div>
              <Select value={currency} onValueChange={v => { setCurrency(v); toast.success("Currency updated"); }}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{["NGN","USD","GBP","EUR","KES","GHS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Language</div><div className="text-xs text-muted-foreground">App display language</div></div>
              <Select value={language} onValueChange={v => { setLanguage(v); toast.success("Language updated"); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="yo">Yorùbá</SelectItem>
                  <SelectItem value="ha">Hausa</SelectItem>
                  <SelectItem value="sw">Kiswahili</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Compact View</div><div className="text-xs text-muted-foreground">Show more content on screen</div></div>
              <Switch checked={compactView} onCheckedChange={v => { setCompactView(v); toast.success("View updated"); }} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Account Actions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => toast.success("Data export requested — check your email")}>
              <Download className="h-4 w-4" />Export My Data
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={logout}>
              <LogOut className="h-4 w-4" />Sign Out
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => toast.error("Please contact support to close your account")}>
              <Trash2 className="h-4 w-4" />Close Account
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">App Version</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">RemitFlow v2.4.1</div>
              <Badge variant="secondary" className="text-xs">Up to date</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── Support ───────────────────────────────────────────────────────────────────
pages["Support"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Phone, Mail, ChevronDown, ChevronUp, Search, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const FAQ = [
  { q: "How long does a transfer take?", a: "Most transfers are completed within minutes. Bank transfers may take 1-3 business days depending on the destination country and bank." },
  { q: "What are the transfer fees?", a: "Fees vary by corridor and amount. You can always see the exact fee before confirming any transfer. Fees typically range from 0.5% to 2%." },
  { q: "How do I increase my transfer limits?", a: "Complete KYC verification to unlock higher limits. Tier 1 allows ₦500K/day, Tier 2 allows ₦5M/day, and Tier 3 is unlimited." },
  { q: "Is my money safe?", a: "Yes. RemitFlow is licensed and regulated. Customer funds are held in segregated accounts at tier-1 banks and are fully insured." },
  { q: "How do I dispute a transaction?", a: "Go to Transactions, find the transaction, and tap 'Dispute'. Our team will investigate within 24-48 hours." },
];

export default function Support() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ subject: "", message: "" });

  const filtered = FAQ.filter(f => f.q.toLowerCase().includes(search.toLowerCase()));

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">Support</h1><p className="text-muted-foreground text-sm">We're here to help</p></div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: MessageSquare, label: "Live Chat", sub: "Avg 2 min reply", color: "bg-blue-100 text-blue-600" },
            { icon: Mail, label: "Email", sub: "support@remitflow.com", color: "bg-purple-100 text-purple-600" },
            { icon: Phone, label: "Phone", sub: "+234 1 700 0000", color: "bg-emerald-100 text-emerald-600" },
          ].map(c => {
            const Icon = c.icon;
            return (
              <button key={c.label} className="p-4 rounded-xl border text-center hover:shadow-md transition-all" onClick={() => toast.success(`Opening ${c.label}...`)}>
                <div className={"w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center " + c.color}><Icon className="h-5 w-5" /></div>
                <div className="font-medium text-sm">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.sub}</div>
              </button>
            );
          })}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Frequently Asked Questions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search FAQs..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {filtered.map((f, i) => (
              <div key={i} className="border rounded-lg overflow-hidden">
                <button className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30" onClick={() => setExpanded(expanded === i ? null : i)}>
                  <span className="font-medium text-sm">{f.q}</span>
                  {expanded === i ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                </button>
                {expanded === i && <div className="px-4 pb-4 text-sm text-muted-foreground">{f.a}</div>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Submit a Ticket</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Subject" value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
            <textarea className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[100px] resize-none" placeholder="Describe your issue..." value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
            <Button className="w-full" disabled={!form.subject || !form.message} onClick={() => { toast.success("Ticket submitted! We'll reply within 24 hours."); setForm({ subject: "", message: "" }); }}>Submit Ticket</Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── Help ──────────────────────────────────────────────────────────────────────
pages["Help"] = '''import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, Video, FileText, ExternalLink, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";

const GUIDES = [
  { category: "Getting Started", items: ["How to create an account", "Completing KYC verification", "Adding a bank account", "Making your first transfer"] },
  { category: "Sending Money", items: ["Supported countries and corridors", "Transfer fees explained", "How to track a transfer", "Cancelling a transfer"] },
  { category: "Wallet & Cards", items: ["Adding funds to your wallet", "Creating a virtual card", "Card spending limits", "Freezing and unfreezing cards"] },
  { category: "Compliance & Security", items: ["Two-factor authentication setup", "Understanding transfer limits", "KYC tier requirements", "Reporting fraud"] },
];

export default function Help() {
  const [search, setSearch] = useState("");
  const filtered = GUIDES.map(g => ({ ...g, items: g.items.filter(i => i.toLowerCase().includes(search.toLowerCase())) })).filter(g => g.items.length > 0);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div><h1 className="text-2xl font-bold">Help Center</h1><p className="text-muted-foreground text-sm">Guides, tutorials, and documentation</p></div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search help articles..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: BookOpen, label: "Guides", count: "48 articles", color: "bg-blue-100 text-blue-600" },
            { icon: Video, label: "Video Tutorials", count: "12 videos", color: "bg-red-100 text-red-600" },
            { icon: FileText, label: "API Docs", count: "Full reference", color: "bg-emerald-100 text-emerald-600" },
          ].map(c => {
            const Icon = c.icon;
            return (
              <button key={c.label} className="p-4 rounded-xl border text-center hover:shadow-md transition-all" onClick={() => toast.success(`Opening ${c.label}...`)}>
                <div className={"w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center " + c.color}><Icon className="h-5 w-5" /></div>
                <div className="font-medium text-sm">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.count}</div>
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          {filtered.map(g => (
            <Card key={g.category}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{g.category}</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {g.items.map(item => (
                  <button key={item} className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 text-left" onClick={() => toast.success("Opening: " + item)}>
                    <span className="text-sm">{item}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── PaymentMethods ─────────────────────────────────────────────────────────────
pages["PaymentMethods"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Building2, Plus, Trash2, Star, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function PaymentMethods() {
  const { data: methods, refetch } = trpc.paymentMethods.list.useQuery();
  const addMutation = trpc.paymentMethods.add.useMutation({ onSuccess: () => { toast.success("Payment method added!"); refetch(); setOpen(false); } });
  const removeMutation = trpc.paymentMethods.remove.useMutation({ onSuccess: () => { toast.success("Removed"); refetch(); } });
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"bank" | "card">("bank");
  const [form, setForm] = useState({ accountNumber: "", bankName: "", bankCode: "", accountName: "", cardNumber: "", expiryMonth: "", expiryYear: "", cvv: "" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Payment Methods</h1><p className="text-muted-foreground text-sm">Manage linked banks and cards</p></div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>

        <div className="space-y-3">
          {(methods ?? []).map((m: any) => (
            <Card key={m.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + (m.type === "bank" ? "bg-blue-100" : "bg-purple-100")}>
                  {m.type === "bank" ? <Building2 className="h-5 w-5 text-blue-600" /> : <CreditCard className="h-5 w-5 text-purple-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2">{m.bankName ?? m.cardBrand}
                    {m.isDefault && <Badge className="text-xs bg-emerald-100 text-emerald-700 border-0">Default</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.type === "bank" ? `${m.accountNumber} · ${m.accountName}` : `•••• ${m.last4} · ${m.expiryMonth}/${m.expiryYear}`}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeMutation.mutate({ id: m.id })}><Trash2 className="h-4 w-4" /></Button>
              </CardContent>
            </Card>
          ))}
          {(!methods || methods.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No payment methods added yet</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Payment Method</DialogTitle></DialogHeader>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setType("bank")} className={"flex-1 py-2 rounded-lg border text-sm font-medium " + (type === "bank" ? "border-primary bg-primary text-primary-foreground" : "border-border")}>Bank Account</button>
            <button onClick={() => setType("card")} className={"flex-1 py-2 rounded-lg border text-sm font-medium " + (type === "card" ? "border-primary bg-primary text-primary-foreground" : "border-border")}>Debit Card</button>
          </div>
          {type === "bank" ? (
            <div className="space-y-3">
              <Input placeholder="Account number" value={form.accountNumber} onChange={e => setForm(p => ({ ...p, accountNumber: e.target.value }))} />
              <Input placeholder="Bank name" value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} />
              <Input placeholder="Account name" value={form.accountName} onChange={e => setForm(p => ({ ...p, accountName: e.target.value }))} />
            </div>
          ) : (
            <div className="space-y-3">
              <Input placeholder="Card number" value={form.cardNumber} onChange={e => setForm(p => ({ ...p, cardNumber: e.target.value }))} />
              <div className="flex gap-2">
                <Input placeholder="MM" value={form.expiryMonth} onChange={e => setForm(p => ({ ...p, expiryMonth: e.target.value }))} />
                <Input placeholder="YY" value={form.expiryYear} onChange={e => setForm(p => ({ ...p, expiryYear: e.target.value }))} />
                <Input placeholder="CVV" value={form.cvv} onChange={e => setForm(p => ({ ...p, cvv: e.target.value }))} />
              </div>
            </div>
          )}
          <Button className="w-full mt-2" disabled={addMutation.isPending}
            onClick={() => addMutation.mutate({ type, ...form })}>
            {addMutation.isPending ? "Adding..." : "Add Payment Method"}
          </Button>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

# ── AuditLogs ─────────────────────────────────────────────────────────────────
pages["AuditLogs"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Search, Download, Shield, User, CreditCard, Settings } from "lucide-react";

const CATEGORY_ICONS: Record<string, any> = { auth: Shield, transaction: CreditCard, profile: User, settings: Settings };
const CATEGORY_COLORS: Record<string, string> = { auth: "bg-blue-100 text-blue-600", transaction: "bg-emerald-100 text-emerald-600", profile: "bg-purple-100 text-purple-600", settings: "bg-orange-100 text-orange-600" };

export default function AuditLogs() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const { data: logs } = trpc.audit.logs.useQuery({ search, category });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center"><ClipboardList className="h-5 w-5 text-slate-600" /></div>
            <div><h1 className="text-2xl font-bold">Audit Logs</h1><p className="text-muted-foreground text-sm">Complete activity history</p></div>
          </div>
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-1" />Export</Button>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search logs..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="auth">Authentication</SelectItem>
              <SelectItem value="transaction">Transactions</SelectItem>
              <SelectItem value="profile">Profile</SelectItem>
              <SelectItem value="settings">Settings</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {(logs ?? []).map((log: any) => {
            const Icon = CATEGORY_ICONS[log.category] ?? Shield;
            return (
              <div key={log.id} className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                <div className={"w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 " + (CATEGORY_COLORS[log.category] ?? "bg-gray-100 text-gray-600")}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{log.action}</div>
                    <div className="text-xs text-muted-foreground flex-shrink-0">{log.timestamp}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{log.description}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">{log.ipAddress}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{log.userAgent}</span>
                  </div>
                </div>
                <Badge variant={log.status === "success" ? "default" : "destructive"} className="text-xs capitalize flex-shrink-0">{log.status}</Badge>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
'''

# ── QRCode ────────────────────────────────────────────────────────────────────
pages["QRCode"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { QrCode, Download, Share2, Scan, Copy } from "lucide-react";
import { toast } from "sonner";

export default function QRCode() {
  const { data: qrData } = trpc.qr.generate.useQuery({ amount: 0, currency: "NGN", note: "" });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`remitflow://pay?account=0123456789&amount=${amount}&note=${note}`)}`;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-sm mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center"><QrCode className="h-5 w-5 text-indigo-600" /></div>
          <div><h1 className="text-2xl font-bold">QR Code</h1><p className="text-muted-foreground text-sm">Receive payments via QR</p></div>
        </div>

        <Card>
          <CardContent className="p-6 text-center">
            <div className="bg-white p-4 rounded-xl inline-block mb-4 shadow-sm border">
              <img src={qrUrl} alt="Payment QR Code" className="w-48 h-48" />
            </div>
            <div className="font-bold text-lg mb-1">Scan to Pay Me</div>
            <div className="text-sm text-muted-foreground mb-4">0123456789 · GTBank</div>
            {amount && <div className="text-2xl font-bold text-primary mb-4">₦{parseFloat(amount).toLocaleString()}</div>}
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => toast.success("QR code downloaded!")}><Download className="h-4 w-4 mr-1" />Save</Button>
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText("remitflow://pay?account=0123456789"); toast.success("Link copied!"); }}><Copy className="h-4 w-4 mr-1" />Copy Link</Button>
              <Button variant="outline" size="sm" onClick={() => toast.success("Share sheet opened!")}><Share2 className="h-4 w-4 mr-1" />Share</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Request Specific Amount</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input type="number" placeholder="Amount (optional)" value={amount} onChange={e => setAmount(e.target.value)} />
            <Input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
            <Button className="w-full" onClick={() => toast.success("QR code updated!")}>Generate QR</Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── VirtualAccount ─────────────────────────────────────────────────────────────
pages["VirtualAccount"] = '''import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Copy, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function VirtualAccount() {
  const { data: accounts } = trpc.wallet.virtualAccounts.useQuery();

  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} copied!`); };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Building2 className="h-5 w-5 text-blue-600" /></div>
          <div><h1 className="text-2xl font-bold">Virtual Accounts</h1><p className="text-muted-foreground text-sm">Dedicated account numbers for receiving funds</p></div>
        </div>

        <div className="space-y-4">
          {(accounts ?? []).map((acc: any) => (
            <Card key={acc.id} className="overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-4 text-white">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-bold">{acc.bankName}</div>
                  <Badge className="bg-white/20 text-white border-0 text-xs">{acc.currency}</Badge>
                </div>
                <div className="text-3xl font-mono font-bold tracking-wider mb-1">{acc.accountNumber}</div>
                <div className="text-sm opacity-80">{acc.accountName}</div>
              </div>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
                  <div><div className="text-muted-foreground text-xs">Bank Code</div><div className="font-medium">{acc.bankCode}</div></div>
                  <div><div className="text-muted-foreground text-xs">Status</div><div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /><span className="font-medium capitalize">{acc.status}</span></div></div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => copy(acc.accountNumber, "Account number")}><Copy className="h-4 w-4 mr-1" />Copy Number</Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => toast.success("Account details shared!")}><RefreshCw className="h-4 w-4 mr-1" />Share Details</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-muted/30">
          <CardContent className="p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">How it works</p>
            <p>Send any amount to your virtual account number and it will be credited to your RemitFlow wallet instantly. Transfers from any Nigerian bank are supported.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── DirectDebit ───────────────────────────────────────────────────────────────
pages["DirectDebit"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Building2, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const MANDATES = [
  { id: 1, merchant: "Netflix", amount: 4400, currency: "NGN", frequency: "Monthly", nextDate: "Apr 20", status: "active" },
  { id: 2, merchant: "Spotify", amount: 2900, currency: "NGN", frequency: "Monthly", nextDate: "Apr 25", status: "active" },
  { id: 3, merchant: "Gym Membership", amount: 15000, currency: "NGN", frequency: "Monthly", nextDate: "May 1", status: "paused" },
];

export default function DirectDebit() {
  const [mandates, setMandates] = useState(MANDATES);

  const toggle = (id: number) => setMandates(p => p.map(m => m.id === id ? { ...m, status: m.status === "active" ? "paused" : "active" } : m));

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center"><RefreshCw className="h-5 w-5 text-cyan-600" /></div>
            <div><h1 className="text-2xl font-bold">Direct Debit</h1><p className="text-muted-foreground text-sm">Manage automatic payment mandates</p></div>
          </div>
          <Button size="sm" onClick={() => toast.success("Feature coming soon")}><Plus className="h-4 w-4 mr-1" />New Mandate</Button>
        </div>

        <div className="space-y-3">
          {mandates.map(m => (
            <Card key={m.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center font-bold text-cyan-700 text-sm">{m.merchant[0]}</div>
                <div className="flex-1">
                  <div className="font-medium">{m.merchant}</div>
                  <div className="text-xs text-muted-foreground">{m.frequency} · Next: {m.nextDate}</div>
                </div>
                <div className="text-right mr-2">
                  <div className="font-semibold">{m.currency} {m.amount.toLocaleString()}</div>
                  <Badge variant={m.status === "active" ? "default" : "secondary"} className="text-xs capitalize">{m.status}</Badge>
                </div>
                <Switch checked={m.status === "active"} onCheckedChange={() => toggle(m.id)} />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { setMandates(p => p.filter(x => x.id !== m.id)); toast.success("Mandate cancelled"); }}><Trash2 className="h-4 w-4" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-muted/30">
          <CardContent className="p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">About Direct Debit</p>
            <p>Direct debit mandates allow merchants to automatically collect payments from your account on a schedule. You can pause or cancel any mandate at any time.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
'''

# ── Disputes ──────────────────────────────────────────────────────────────────
pages["Disputes"] = '''import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Plus, Clock, CheckCircle2, XCircle, MessageSquare } from "lucide-react";
import { toast } from "sonner";

const DISPUTES = [
  { id: "DSP001", txRef: "RF2024031601", amount: 50000, currency: "NGN", reason: "Amount charged incorrectly", status: "under_review", createdAt: "Mar 16, 2024", updatedAt: "Mar 17, 2024" },
  { id: "DSP002", txRef: "RF2024030501", amount: 25000, currency: "NGN", reason: "Transfer not received by beneficiary", status: "resolved", createdAt: "Mar 5, 2024", updatedAt: "Mar 8, 2024" },
];

const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  under_review: { color: "bg-yellow-100 text-yellow-700", icon: Clock, label: "Under Review" },
  resolved: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, label: "Resolved" },
  rejected: { color: "bg-red-100 text-red-700", icon: XCircle, label: "Rejected" },
};

export default function Disputes() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ txRef: "", reason: "", description: "" });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
            <div><h1 className="text-2xl font-bold">Disputes</h1><p className="text-muted-foreground text-sm">Report and track transaction disputes</p></div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New Dispute</Button>
        </div>

        <div className="space-y-3">
          {DISPUTES.map(d => {
            const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.under_review;
            const Icon = cfg.icon;
            return (
              <Card key={d.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-mono text-sm font-bold">{d.id}</div>
                      <div className="text-xs text-muted-foreground">Ref: {d.txRef}</div>
                    </div>
                    <Badge className={"text-xs border-0 " + cfg.color}><Icon className="h-3 w-3 mr-1" />{cfg.label}</Badge>
                  </div>
                  <div className="text-sm mb-2">{d.reason}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{d.currency} {d.amount.toLocaleString()}</span>
                    <span>Filed: {d.createdAt}</span>
                  </div>
                  <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => toast.success("Opening dispute chat...")}><MessageSquare className="h-4 w-4 mr-1" />View Messages</Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>File a Dispute</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Transaction reference (e.g. RF2024...)" value={form.txRef} onChange={e => setForm(p => ({ ...p, txRef: e.target.value }))} />
            <select className="w-full border rounded-md px-3 py-2 bg-background text-sm" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}>
              <option value="">Select reason...</option>
              <option>Amount charged incorrectly</option>
              <option>Transfer not received</option>
              <option>Duplicate transaction</option>
              <option>Unauthorized transaction</option>
              <option>Other</option>
            </select>
            <textarea className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[80px] resize-none" placeholder="Additional details..." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            <Button className="w-full" disabled={!form.txRef || !form.reason} onClick={() => { toast.success("Dispute filed! We'll respond within 24 hours."); setOpen(false); setForm({ txRef: "", reason: "", description: "" }); }}>Submit Dispute</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
'''

for name, content in pages.items():
    path = os.path.join(D, f"{name}.tsx")
    with open(path, "w") as f:
        f.write(content)
    print(f"Written: {name}.tsx")

print(f"\nDone! Written {len(pages)} pages.")
