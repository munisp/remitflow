import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutDashboard, Wallet, Send, Download, ArrowLeftRight, Bell,
  CreditCard, Target, Users, Shield, FileText, Settings, HelpCircle,
  ChevronDown, ChevronRight, Menu, X, LogOut, User, Phone, Receipt,
  Building2, RefreshCw, QrCode, AlertCircle, MapPin, Zap, Coins,
  ShoppingCart, Globe, BarChart3, Activity, Repeat, Landmark,
  Scale, Lock, Calculator, Smartphone, TrendingUp, Package,
  BookOpen, Fingerprint, Layers, Network, Radio, ChevronLeft,
  MessageSquare, Star, Code2, FileSearch, Gavel, UserCheck,
  DatabaseZap, Banknote, PiggyBank, BadgeCheck, Truck, Wifi,
  ScanEye, BellRing,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href?: string;
  icon: React.ReactNode;
  badge?: string;
  children?: NavItem[];
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  {
    label: "Banking", icon: <Wallet className="h-4 w-4" />,
    children: [
      { label: "My Wallet", href: "/wallet", icon: <Wallet className="h-4 w-4" /> },
      { label: "Send Money", href: "/send", icon: <Send className="h-4 w-4" /> },
      { label: "Receive Money", href: "/receive", icon: <Download className="h-4 w-4" /> },
      { label: "Transactions", href: "/transactions", icon: <Receipt className="h-4 w-4" /> },
      { label: "Exchange Rates", href: "/exchange", icon: <ArrowLeftRight className="h-4 w-4" /> },
      { label: "Virtual Account", href: "/virtual-account", icon: <Building2 className="h-4 w-4" /> },
    ],
  },
  {
    label: "Payments", icon: <CreditCard className="h-4 w-4" />,
    children: [
      { label: "Cards", href: "/cards", icon: <CreditCard className="h-4 w-4" /> },
      { label: "Airtime & Data", href: "/airtime", icon: <Phone className="h-4 w-4" /> },
      { label: "Bill Payment", href: "/bills", icon: <Zap className="h-4 w-4" /> },
      { label: "Batch Payments", href: "/batch-payments", icon: <Layers className="h-4 w-4" /> },
      { label: "Recurring", href: "/recurring", icon: <Repeat className="h-4 w-4" /> },
      { label: "Direct Debit", href: "/direct-debit", icon: <Landmark className="h-4 w-4" /> },
      { label: "QR Code", href: "/qr-code", icon: <QrCode className="h-4 w-4" /> },
      { label: "M-Pesa", href: "/mpesa", icon: <Smartphone className="h-4 w-4" /> },
      { label: "Wise Transfer", href: "/wise", icon: <Globe className="h-4 w-4" /> },
    ],
  },
  {
    label: "Finance", icon: <TrendingUp className="h-4 w-4" />,
    children: [
      { label: "Savings Goals", href: "/savings", icon: <PiggyBank className="h-4 w-4" /> },
      { label: "FX Alerts", href: "/fx-alerts", icon: <AlertCircle className="h-4 w-4" /> },
      { label: "Rate Alerts", href: "/rate-alerts", icon: <BellRing className="h-4 w-4" /> },
      { label: "Rate Lock", href: "/rate-lock", icon: <Lock className="h-4 w-4" /> },
      { label: "Rate Calculator", href: "/calculator", icon: <Calculator className="h-4 w-4" /> },
      { label: "BNPL", href: "/bnpl", icon: <ShoppingCart className="h-4 w-4" /> },
      { label: "Stablecoin", href: "/stablecoin", icon: <Coins className="h-4 w-4" /> },
      { label: "CBDC", href: "/cbdc", icon: <Banknote className="h-4 w-4" /> },
    ],
  },
  {
    label: "Infrastructure", icon: <Network className="h-4 w-4" />,
    children: [
      { label: "Mojaloop", href: "/mojaloop", icon: <Radio className="h-4 w-4" /> },
      { label: "Corridor Pricing", href: "/corridors", icon: <MapPin className="h-4 w-4" /> },
      { label: "Checkout SDK", href: "/checkout-sdk", icon: <Code2 className="h-4 w-4" /> },
      { label: "POS Management", href: "/pos", icon: <Package className="h-4 w-4" /> },
      { label: "Agent Network", href: "/agents", icon: <Users className="h-4 w-4" /> },
      { label: "Transfer Tracking", href: "/tracking", icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    label: "Compliance", icon: <Shield className="h-4 w-4" />,
    children: [
      { label: "KYC Verification", href: "/kyc", icon: <UserCheck className="h-4 w-4" /> },
      { label: "Property KYC", href: "/property-kyc", icon: <Building2 className="h-4 w-4" /> },
      { label: "Travel Rule", href: "/travel-rule", icon: <Truck className="h-4 w-4" /> },
      { label: "FCA Compliance", href: "/fca-compliance", icon: <BadgeCheck className="h-4 w-4" /> },
      { label: "GDPR Data", href: "/gdpr", icon: <DatabaseZap className="h-4 w-4" /> },
      { label: "Consent", href: "/consent", icon: <FileSearch className="h-4 w-4" /> },
      { label: "DPIA", href: "/dpia", icon: <Scale className="h-4 w-4" /> },
      { label: "Travel Rule", href: "/travel-rule", icon: <Gavel className="h-4 w-4" /> },
      { label: "Audit Logs", href: "/audit-logs", icon: <BookOpen className="h-4 w-4" /> },
      { label: "Disputes", href: "/disputes", icon: <Gavel className="h-4 w-4" /> },
      { label: "Fraud Monitor", href: "/fraud-monitor", icon: <ScanEye className="h-4 w-4" /> },
    ],
  },
  {
    label: "Analytics", icon: <BarChart3 className="h-4 w-4" />,
    children: [
      { label: "Account Health", href: "/account-health", icon: <Activity className="h-4 w-4" /> },
      { label: "Payment Performance", href: "/payment-performance", icon: <BarChart3 className="h-4 w-4" /> },
      { label: "API Changelog", href: "/changelog", icon: <BookOpen className="h-4 w-4" /> },
    ],
  },
  {
    label: "Account", icon: <User className="h-4 w-4" />,
    children: [
      { label: "Profile", href: "/profile", icon: <User className="h-4 w-4" /> },
      { label: "Beneficiaries", href: "/beneficiaries", icon: <Users className="h-4 w-4" /> },
      { label: "Payment Methods", href: "/payment-methods", icon: <CreditCard className="h-4 w-4" /> },
      { label: "Security", href: "/security", icon: <Shield className="h-4 w-4" /> },
      { label: "Notifications", href: "/notifications", icon: <Bell className="h-4 w-4" /> },
      { label: "Referral", href: "/referral", icon: <Star className="h-4 w-4" /> },
      { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" /> },
    ],
  },
  {
    label: "Support", icon: <HelpCircle className="h-4 w-4" />,
    children: [
      { label: "Help Center", href: "/help", icon: <HelpCircle className="h-4 w-4" /> },
      { label: "Support Tickets", href: "/support", icon: <MessageSquare className="h-4 w-4" /> },
    ],
  },
];

function NavGroup({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const [location] = useLocation();
  const isActive = item.href ? location === item.href : false;
  const hasActiveChild = item.children?.some(c => c.href && location === c.href);
  const [open, setOpen] = useState(hasActiveChild || false);

  if (item.href) {
    return (
      <Link href={item.href}>
        <div className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer",
          "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
          isActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary"
        )}>
          {item.icon}
          {!collapsed && <span className="truncate">{item.label}</span>}
          {!collapsed && item.badge && <Badge className="ml-auto text-xs h-5">{item.badge}</Badge>}
        </div>
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
          "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
          (open || hasActiveChild) && "text-sidebar-foreground"
        )}
      >
        {item.icon}
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left">{item.label}</span>
            {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
          {item.children?.map((child, i) => (
            <Link key={i} href={child.href ?? "#"}>
              <div className={cn(
                "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer",
                "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                location === child.href && "text-sidebar-primary-foreground bg-sidebar-primary/80"
              )}>
                {child.icon}
                <span className="truncate">{child.label}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, { enabled: isAuthenticated });
  const notifList = Array.isArray(notificationsQuery.data) ? notificationsQuery.data : [];
  const unreadCount = notifList.filter((n: any) => !n.isRead).length;

  const initials = user?.name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) ?? "RF";

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className={cn("flex items-center gap-3 px-4 py-4 border-b border-sidebar-border", sidebarCollapsed && "justify-center")}>
        <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
          <Wifi className="h-4 w-4 text-sidebar-primary-foreground" />
        </div>
        {!sidebarCollapsed && (
          <div>
            <div className="font-bold text-sm text-sidebar-foreground">RemitFlow</div>
            <div className="text-xs text-sidebar-foreground/50">Financial Platform</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 py-3 px-2">
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item, i) => (
            <NavGroup key={i} item={item} collapsed={sidebarCollapsed} />
          ))}
        </div>
      </ScrollArea>

      {/* User */}
      <div className="border-t border-sidebar-border p-3">
        {isAuthenticated ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                "w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent transition-all",
                sidebarCollapsed && "justify-center"
              )}>
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                {!sidebarCollapsed && (
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name ?? "Demo User"}</div>
                    <div className="text-xs text-sidebar-foreground/50 truncate">{user?.email ?? "demo@remitflow.com"}</div>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-48">
              <DropdownMenuItem asChild><Link href="/profile"><span className="flex items-center gap-2 cursor-pointer"><User className="h-4 w-4" /> Profile</span></Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/settings"><span className="flex items-center gap-2 cursor-pointer"><Settings className="h-4 w-4" /> Settings</span></Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" className="w-full" onClick={() => window.location.href = getLoginUrl()}>
            Sign In
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden lg:flex flex-col shrink-0 transition-all duration-300",
        sidebarCollapsed ? "w-16" : "w-60"
      )}>
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 z-10">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-border bg-background/95 backdrop-blur flex items-center px-4 gap-3 shrink-0">
          <button
            className="lg:hidden p-1.5 rounded-md hover:bg-muted"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            className="hidden lg:flex p-1.5 rounded-md hover:bg-muted"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          <div className="flex-1" />

          {/* Notifications */}
          <Link href="/notifications">
            <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
              <Bell className="h-5 w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 w-4 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center font-bold">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </Link>

          {/* User Avatar */}
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 hover:bg-muted rounded-lg px-2 py-1.5 transition-colors">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:block text-sm font-medium">{user?.name?.split(" ")[0] ?? "Demo"}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild><Link href="/profile"><span className="flex items-center gap-2 cursor-pointer"><User className="h-4 w-4" /> Profile</span></Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/settings"><span className="flex items-center gap-2 cursor-pointer"><Settings className="h-4 w-4" /> Settings</span></Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut className="h-4 w-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" onClick={() => window.location.href = getLoginUrl()}>Sign In</Button>
          )}
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
