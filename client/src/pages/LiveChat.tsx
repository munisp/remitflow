import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MessageCircle, Plus, Trash2, ChevronLeft, ChevronRight, Search,
  CreditCard, Banknote, Smartphone, HelpCircle, ArrowRight, Zap,
  Clock, ShieldCheck, TrendingUp, BookOpen
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "👋 Hi! I'm the RemitFlow Support Agent. I can help you with:\n\n" +
    "- **Wallet top-up** — add funds via card, bank transfer, or mobile money\n" +
    "- **Transfer status** — track any transaction in real time\n" +
    "- **Exchange rates & fees** — get current rates and fee breakdowns\n" +
    "- **KYC verification** — understand your tier and limits\n" +
    "- **Account issues** — disputes, limits, security\n\n" +
    "What can I help you with today?",
};

const SUGGESTED_PROMPTS = [
  "How do I top up my wallet?",
  "What payment methods are supported for top-up?",
  "How long does a transfer take?",
  "What are the transfer fees?",
  "How do I increase my limits?",
  "How do I dispute a transaction?",
];

// Wallet top-up quick FAQ — instant local answers before hitting LLM
const TOPUP_FAQ: Record<string, string> = {
  "how do i top up my wallet": "You can top up your wallet in 3 ways:\n\n1. **Stripe card payment** — Go to *Wallet → Top Up* and pay with any Visa/Mastercard/Amex. Funds appear instantly.\n2. **Bank transfer** — Use your virtual account details (IBAN/sort code) to send from any bank. Arrives in 1–2 business days.\n3. **Mobile money** — M-Pesa, MTN MoMo, Airtel Money supported in select corridors.\n\nNeed help navigating to the top-up page?",
  "what payment methods are supported for top-up": "RemitFlow supports:\n\n- 💳 **Debit/Credit cards** (Visa, Mastercard, Amex) via Stripe\n- 🏦 **Bank transfer** (SEPA, SWIFT, Faster Payments)\n- 📱 **Mobile money** (M-Pesa, MTN MoMo, Airtel Money)\n- 🔄 **Wallet-to-wallet** transfer from another RemitFlow user\n\nAll top-ups are processed securely with 256-bit encryption.",
  "how long does a transfer take": "Transfer times vary by corridor:\n\n- 🇬🇧→🇳🇬 UK to Nigeria: **30 seconds – 2 hours** (bank-to-bank)\n- 🇺🇸→🇰🇪 US to Kenya: **Instant – 24 hours** (M-Pesa)\n- 🇪🇺→🇬🇭 EU to Ghana: **1–2 business days** (bank transfer)\n\nMost transfers complete within **2 hours** during business hours.",
  "what are the transfer fees": "RemitFlow fees are transparent:\n\n- **Standard transfers**: 0.5% – 1.5% depending on corridor\n- **Express transfers**: +0.5% for priority processing\n- **Minimum fee**: $0.99 per transfer\n- **No hidden fees** — the rate you see is the rate you get\n\nUse the *Rate Calculator* to see exact fees before sending.",
  "how do i increase my limits": "To increase your transfer limits:\n\n1. **Tier 1** (default): Up to $500/day — just email verification\n2. **Tier 2**: Up to $5,000/day — requires government ID + selfie\n3. **Tier 3**: Up to $50,000/day — requires proof of address + source of funds\n\nGo to *Settings → KYC Verification* to upload your documents. Verification typically takes 1–2 business days.",
  "how do i dispute a transaction": "To dispute a transaction:\n\n1. Go to *Transactions* and find the transaction\n2. Click the three-dot menu → **Dispute**\n3. Select the reason (wrong amount, unauthorized, not received)\n4. Add any supporting evidence\n\nOur team reviews disputes within **48 hours**. For urgent cases, reply here with your transaction reference number.",
};

// Quick action cards for wallet top-up
import DashboardLayout from "@/components/DashboardLayout";
const QUICK_ACTIONS = [
  { icon: CreditCard, label: "Top Up via Card", prompt: "How do I top up my wallet with a credit or debit card?", color: "text-blue-500" },
  { icon: Banknote, label: "Bank Transfer", prompt: "How do I top up via bank transfer?", color: "text-green-500" },
  { icon: Smartphone, label: "Mobile Money", prompt: "Which mobile money providers are supported for top-up?", color: "text-orange-500" },
  { icon: Clock, label: "Transfer Times", prompt: "How long does a transfer take?", color: "text-purple-500" },
  { icon: TrendingUp, label: "Check Rates", prompt: "What are the current exchange rates and fees?", color: "text-amber-500" },
  { icon: ShieldCheck, label: "Increase Limits", prompt: "How do I increase my transfer limits?", color: "text-teal-500" },
];

export default function LiveChat() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(true);

  const { data: sessions = [], isLoading: sessionsLoading } = trpc.support.listSessions.useQuery();
  const { data: sessionMessages, isError } = trpc.support.getMessages.useQuery(
    { sessionId: activeSessionId! },
    { enabled: !!activeSessionId }
  );

  useEffect(() => {
    if (activeSessionId && sessionMessages) {
      if (sessionMessages.length === 0) {
        setMessages([WELCOME_MESSAGE]);
      } else {
        setMessages(sessionMessages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })));
        setShowQuickActions(false);
      }
    } else if (!activeSessionId) {
      setMessages([WELCOME_MESSAGE]);
      setShowQuickActions(true);
    }
  }, [activeSessionId, sessionMessages]);

  const chatMutation = trpc.support.chat.useMutation({
    onSuccess: (data) => {
      if (data.sessionId && !activeSessionId) {
        setActiveSessionId(data.sessionId);
        utils.support.listSessions.invalidate();
      }
    },
  });

  const deleteSessionMutation = trpc.support.deleteSession.useMutation({
    onSuccess: () => {
      utils.support.listSessions.invalidate();
      setActiveSessionId(null);
      setMessages([WELCOME_MESSAGE]);
      setShowQuickActions(true);
      toast.success("Conversation deleted");
    },
  });

  const handleSend = useCallback(
    async (content: string) => {
      setShowQuickActions(false);
      const userMsg: Message = { role: "user", content };
      setMessages((prev) => [...prev, userMsg]);

      // Check local FAQ first for instant answers
      const key = content.toLowerCase().trim().replace(/[?!.]+$/, "");
      const faqAnswer = TOPUP_FAQ[key];
      if (faqAnswer) {
        setMessages((prev) => [...prev, { role: "assistant", content: faqAnswer }]);
        // Still persist to DB via mutation but don't wait
        chatMutation.mutateAsync({ message: content, sessionId: activeSessionId ?? undefined }).then((result) => {
          if (result.sessionId && !activeSessionId) {
            setActiveSessionId(result.sessionId);
            utils.support.listSessions.invalidate();
          }
        }).catch(() => {});
        return;
      }

      try {
        const result = await chatMutation.mutateAsync({
          message: content,
          sessionId: activeSessionId ?? undefined,
        });
        const replyContent = typeof result.reply === "string" ? result.reply : "I'm here to help!";
        setMessages((prev) => [...prev, { role: "assistant", content: replyContent }]);
        utils.support.listSessions.invalidate();
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "I'm sorry, I'm having trouble connecting right now. Please try again or submit a support ticket." },
        ]);
      }
    },
    [chatMutation, activeSessionId, utils]
  );

  const handleQuickAction = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-border bg-card">
      {/* Sidebar */}
      <div className={`flex flex-col border-r border-border bg-muted/30 transition-all duration-200 ${sidebarOpen ? "w-64 min-w-[16rem]" : "w-0 min-w-0 overflow-hidden"}`}>
        <div className="flex items-center justify-between p-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <MessageCircle className="w-4 h-4 text-primary" />
            Conversations
          </span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setActiveSessionId(null); setMessages([WELCOME_MESSAGE]); setShowQuickActions(true); }} title="New chat">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Quick Topics */}
        <div className="px-2 py-2 border-b border-border">
          <p className="text-xs text-muted-foreground font-medium mb-1.5 px-1">Quick Topics</p>
          <div className="flex flex-col gap-0.5">
            {[
              { icon: CreditCard, label: "Wallet Top-Up", prompt: "How do I top up my wallet?" },
              { icon: BookOpen, label: "Transfer Guide", prompt: "How do I send money internationally?" },
              { icon: HelpCircle, label: "KYC & Limits", prompt: "How do I increase my transfer limits?" },
            ].map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                onClick={() => { setActiveSessionId(null); setMessages([WELCOME_MESSAGE]); setShowQuickActions(false); handleSend(prompt); }}
                className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                <Icon className="w-3 h-3 flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Search input */}
        <div className="px-2 py-1.5 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search conversations…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-6 pr-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {sessionsLoading ? (
            <div className="p-3 text-xs text-muted-foreground">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No conversations yet. Start chatting!</div>
          ) : (() => {
            const q = searchQuery.trim().toLowerCase();
            const filtered = q ? sessions.filter((s: any) => s.title.toLowerCase().includes(q)) : sessions;
            if (filtered.length === 0) return (
              <div className="p-3 text-xs text-muted-foreground">No conversations match "{searchQuery}"</div>
            );
            return (
              <div className="flex flex-col gap-0.5 p-2">
                {filtered.map((s: any) => {
                  const title = s.title;
                  const idx = q ? title.toLowerCase().indexOf(q) : -1;
                  return (
                    <DashboardLayout>
                    <button
                      key={s.id}
                      onClick={() => setActiveSessionId(s.id)}
                      className={`group w-full text-left rounded-md px-2 py-2 text-xs transition-colors flex items-center justify-between gap-1 ${
                        activeSessionId === s.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <span className="truncate flex-1">
                        {idx >= 0 ? (
                          <>
                            {title.slice(0, idx)}
                            <mark className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{title.slice(idx, idx + q.length)}</mark>
                            {title.slice(idx + q.length)}
                          </>
                        ) : title}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSessionMutation.mutate({ sessionId: s.id }); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-opacity"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </button>
                  
                    </DashboardLayout>
                  );
                })}
              </div>
            );
          })()}
        </ScrollArea>
        <div className="p-2 border-t border-border">
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => { setActiveSessionId(null); setMessages([WELCOME_MESSAGE]); setShowQuickActions(true); }}>
            <Plus className="w-3 h-3 mr-1" /> New Conversation
          </Button>
        </div>
      </div>

      {/* Toggle sidebar */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        className="flex items-center justify-center w-5 bg-muted/20 hover:bg-muted/50 border-r border-border transition-colors"
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {sidebarOpen ? <ChevronLeft className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
      </button>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
          <MessageCircle className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            {activeSessionId ? sessions.find((s: any) => s.id === activeSessionId)?.title ?? "Conversation" : "New Conversation"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-green-600">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              AI Support Online
            </span>
            {activeSessionId && (
              <Badge variant="outline" className="text-xs">Session #{activeSessionId}</Badge>
            )}
          </div>
        </div>

        {/* Quick action cards — shown only on new conversation */}
        {showQuickActions && (
          <div className="px-4 pt-3 pb-2 border-b border-border bg-muted/10">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Zap className="h-3 w-3 text-amber-500" /> Quick Help Topics
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {QUICK_ACTIONS.map(({ icon: Icon, label, prompt, color }) => (
                <button
                  key={label}
                  onClick={() => handleQuickAction(prompt)}
                  className="flex items-center gap-2 p-2 rounded-md border border-border bg-card hover:bg-muted/50 text-left transition-colors group"
                >
                  <Icon className={`h-4 w-4 flex-shrink-0 ${color}`} />
                  <span className="text-xs text-foreground font-medium leading-tight">{label}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        )}

        <AIChatBox
          messages={messages}
          onSendMessage={handleSend}
          isLoading={chatMutation.isPending}
          emptyStateMessage="Ask me anything about wallet top-up, transfers, rates, KYC, or your account."
          suggestedPrompts={SUGGESTED_PROMPTS}
          className="flex-1"
        />
      </div>
    </div>
  );
}
