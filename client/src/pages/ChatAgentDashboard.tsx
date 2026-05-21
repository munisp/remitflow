import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {  MessageSquare, Users, Clock, CheckCircle, AlertCircle, Send, User,
  Zap, Tag, MoreVertical, PhoneOff, ArrowRight, Search, RefreshCw
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const priorityColors: Record<string, string> = {
  low: "bg-gray-500/20 text-gray-300",
  normal: "bg-blue-500/20 text-blue-300",
  high: "bg-orange-500/20 text-orange-300",
  urgent: "bg-red-500/20 text-red-300",
};

const statusColors: Record<string, string> = {
  bot: "bg-gray-500/20 text-gray-300",
  queued: "bg-yellow-500/20 text-yellow-300",
  active: "bg-green-500/20 text-green-300",
  resolved: "bg-blue-500/20 text-blue-300",
  abandoned: "bg-red-500/20 text-red-300",
};

const CANNED_RESPONSES = [
  { shortcut: "/greet", content: "Hello! Welcome to RemitFlow support. How can I assist you today?" },
  { shortcut: "/kyc", content: "To complete your KYC verification, please go to Settings → Identity Verification and upload a valid government-issued ID and proof of address." },
  { shortcut: "/topup", content: "To top up your wallet, navigate to Wallet → Top Up and select your preferred payment method (card, bank transfer, or mobile money)." },
  { shortcut: "/rate", content: "You can check live exchange rates on the FX Rates page. Rates are updated every 5 seconds in real-time." },
  { shortcut: "/limit", content: "Transfer limits depend on your KYC tier. Tier 1: $500/day, Tier 2: $5,000/day, Tier 3: $50,000/day. Complete KYC to unlock higher limits." },
  { shortcut: "/resolve", content: "Thank you for contacting RemitFlow support. Your issue has been resolved. Please don't hesitate to reach out if you need further assistance. Have a great day!" },
];

export default function ChatAgentDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCanned, setShowCanned] = useState(false);
  const [statusFilter, setStatusFilter] = useState("queued");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Queries
  const { data: sessions, refetch: refetchSessions } = trpc.support.listSessions.useQuery();
  const { data: chatMessages, refetch: refetchMessages } = trpc.support.getMessages.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: !!selectedSessionId, refetchInterval: 3000 }
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Auto-refresh sessions
  useEffect(() => {
    const interval = setInterval(() => refetchSessions(), 5000);
    return () => clearInterval(interval);
  }, []);

  // Mutations
  const sendMessage = trpc.support.chat.useMutation({
    onSuccess: () => { setMessage(""); refetchMessages(); },
    onError: (e) => toast.error(`Failed to send: ${e.message}`),
  });
  const resolveSession = trpc.support.deleteSession.useMutation({
    onSuccess: () => {
      toast.success("Session resolved");
      setSelectedSessionId(null);
      refetchSessions();
    },
  });

  const handleSend = () => {
    if (!message.trim() || !selectedSessionId) return;
    sendMessage.mutate({ message: message.trim() });
  };

  const handleCanned = (content: string) => {
    setMessage(content);
    setShowCanned(false);
  };

  const filteredSessions = (sessions?.sessions || []).filter((s: any) =>
    !searchQuery || s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.userEmail?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedSession = filteredSessions.find((s: any) => s.id === selectedSessionId);

  // Stats
  const allSessions = sessions?.sessions || [];
  const queuedCount = allSessions.filter((s: any) => s.status === "queued" || !s.status).length;
  const activeCount = allSessions.filter((s: any) => s.status === "active").length;
  const resolvedToday = allSessions.filter((s: any) => {
    if (s.status !== "resolved") return false;
    const d = new Date(s.updatedAt);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;

  return (

    <DashboardLayout>
    <div className="h-[calc(100vh-64px)] flex flex-col p-4 gap-4">
      {/* Header Stats */}
      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg"><Clock className="w-4 h-4 text-yellow-400" /></div>
            <div><p className="text-gray-400 text-xs">In Queue</p><p className="text-white font-bold">{queuedCount}</p></div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg"><MessageSquare className="w-4 h-4 text-green-400" /></div>
            <div><p className="text-gray-400 text-xs">Active Chats</p><p className="text-white font-bold">{activeCount}</p></div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg"><CheckCircle className="w-4 h-4 text-blue-400" /></div>
            <div><p className="text-gray-400 text-xs">Resolved Today</p><p className="text-white font-bold">{resolvedToday}</p></div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 bg-violet-500/20 rounded-lg"><Users className="w-4 h-4 text-violet-400" /></div>
            <div><p className="text-gray-400 text-xs">Agent</p><p className="text-white font-bold text-xs truncate">{user?.name || "You"}</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Main Chat Interface */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Session List */}
        <Card className="bg-gray-900 border-gray-800 w-80 flex-shrink-0 flex flex-col">
          <CardHeader className="pb-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-sm">Conversations</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => refetchSessions()} className="h-7 w-7 p-0 text-gray-400">
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-2 w-3 h-3 text-gray-500" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="pl-7 h-7 text-xs bg-gray-800 border-gray-700 text-white" />
            </div>
            <div className="flex gap-1 mt-2">
              {["queued", "active", "resolved", "all"].map(s => (
                <Button key={s} size="sm" variant={statusFilter === s ? "default" : "ghost"}
                  onClick={() => setStatusFilter(s)}
                  className={`h-6 px-2 text-xs capitalize ${statusFilter === s ? "bg-violet-600" : "text-gray-400"}`}>
                  {s}
                </Button>
              ))}
            </div>
          </CardHeader>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredSessions.length === 0 && (
                <div className="text-center text-gray-500 text-xs py-8">No conversations</div>
              )}
              {filteredSessions.map((s: any) => (
                <div key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${selectedSessionId === s.id ? "bg-violet-600/20 border border-violet-500/30" : "hover:bg-gray-800 border border-transparent"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="w-7 h-7 flex-shrink-0">
                        <AvatarFallback className="bg-gray-700 text-gray-300 text-xs">
                          {(s.userEmail || s.title || "U").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-white text-xs font-medium truncate">{s.userEmail || s.title || `Session #${s.id}`}</p>
                        <p className="text-gray-400 text-xs truncate">{s.lastMessage || s.title || "No messages yet"}</p>
                      </div>
                    </div>
                    <Badge className={`text-xs flex-shrink-0 ${statusColors[s.status || "queued"]}`}>
                      {s.status || "queued"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-gray-500 text-xs">
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>

        {/* Chat Window */}
        <Card className="bg-gray-900 border-gray-800 flex-1 flex flex-col min-w-0">
          {!selectedSessionId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">Select a conversation to start chatting</p>
                <p className="text-gray-500 text-sm mt-1">{queuedCount} conversations waiting in queue</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-violet-600 text-white text-sm">
                      {(selectedSession?.userEmail || "U").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-white font-medium text-sm">{selectedSession?.userEmail || `Session #${selectedSessionId}`}</p>
                    <p className="text-gray-400 text-xs">Session #{selectedSessionId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="text-green-400 hover:text-green-300 h-8"
                    onClick={() => resolveSession.mutate({ sessionId: selectedSessionId })}>
                    <CheckCircle className="w-4 h-4 mr-1" /> Resolve
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                  {(chatMessages?.messages || []).map((msg: any, i: number) => (
                    <div key={i} className={`flex ${msg.role === "assistant" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                        msg.role === "assistant"
                          ? "bg-violet-600 text-white"
                          : msg.role === "system"
                          ? "bg-gray-700/50 text-gray-400 text-xs italic"
                          : "bg-gray-800 text-gray-100"
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className={`text-xs mt-1 ${msg.role === "assistant" ? "text-violet-200" : "text-gray-500"}`}>
                          {msg.role === "assistant" ? "Agent" : msg.role === "system" ? "System" : "User"} · {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Canned Responses */}
              {showCanned && (
                <div className="border-t border-gray-800 p-3 bg-gray-800/50">
                  <p className="text-gray-400 text-xs mb-2">Quick Responses</p>
                  <div className="grid grid-cols-2 gap-2">
                    {CANNED_RESPONSES.map((r, i) => (
                      <button key={i} onClick={() => handleCanned(r.content)}
                        className="text-left p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors">
                        <p className="text-violet-400 text-xs font-mono">{r.shortcut}</p>
                        <p className="text-gray-300 text-xs truncate">{r.content.slice(0, 60)}...</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message Input */}
              <div className="p-4 border-t border-gray-800 flex-shrink-0">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowCanned(!showCanned)}
                    className={`h-9 px-3 ${showCanned ? "text-violet-400 bg-violet-500/10" : "text-gray-400"}`}>
                    <Zap className="w-4 h-4" />
                  </Button>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                    className="flex-1 bg-gray-800 border-gray-700 text-white resize-none h-9 min-h-[36px] py-2 text-sm"
                    rows={1}
                  />
                  <Button onClick={handleSend} disabled={!message.trim() || sendMessage.isPending}
                    className="bg-violet-600 hover:bg-violet-700 h-9 px-3">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  

    </DashboardLayout>

  );
}
