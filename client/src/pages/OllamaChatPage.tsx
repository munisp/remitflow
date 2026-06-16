import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Bot, User, Cpu, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  durationMs?: number;
  usedFallback?: boolean;
}

const SYSTEM_PRESETS = [
  { label: "Compliance Analyst", value: "You are a financial compliance analyst specializing in cross-border remittances. Provide concise, accurate compliance guidance." },
  { label: "Risk Officer", value: "You are a risk officer at a fintech company. Assess transaction risks and provide clear risk ratings with explanations." },
  { label: "Customer Support", value: "You are a helpful customer support agent for RemitFlow, a cross-border remittance platform. Be friendly and helpful." },
  { label: "AML Specialist", value: "You are an AML (Anti-Money Laundering) specialist. Identify suspicious patterns and provide SAR guidance." },
];

export default function OllamaChatPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PRESETS[0].value);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: statusData } = trpc.ollama.status.useQuery();
  const { data: modelsData } = trpc.ollama.listModels.useQuery();

  const chatMutation = trpc.ollama.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.content,
          model: data.model,
          durationMs: data.durationMs,
          usedFallback: data.usedFallback,
        },
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: Message = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");

    const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...newMessages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
    ];

    chatMutation.mutate({ messages: apiMessages, model: selectedModel });
  };

  const clearChat = () => {
    setMessages([]);
    toast.success("Chat cleared");
  };

  const models = modelsData?.models || [];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-6 w-6 text-green-500" />
            Ollama Local LLM
          </h1>
          <p className="text-muted-foreground mt-1">
            Privacy-preserving local inference — sensitive data never leaves your server
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusData?.available ? "default" : "secondary"} className="text-sm px-3 py-1">
            {statusData?.available ? `Ollama Online (${statusData.models?.length || 0} models)` : "Fallback: Manus LLM"}
          </Badge>
        </div>
      </div>

      {/* Config Row */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">System Persona</label>
          <Select value={systemPrompt} onValueChange={setSystemPrompt}>
            <SelectTrigger>
              <SelectValue placeholder="Select persona" />
            </SelectTrigger>
            <SelectContent>
              {SYSTEM_PRESETS.map((p) => (
                <SelectItem key={p.label} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {models.length > 0 && (
          <div className="w-48">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Model</label>
            <Select value={selectedModel || "auto"} onValueChange={(v) => setSelectedModel(v === "auto" ? undefined : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (best available)</SelectItem>
                {models.map((m: string) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-end">
          <Button variant="outline" size="sm" onClick={clearChat} className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Clear
          </Button>
        </div>
      </div>

      {/* Chat Window */}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bot className="h-4 w-4 text-green-500" />
            Chat Session
            {messages.length > 0 && (
              <Badge variant="outline" className="text-xs">{messages.length} messages</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0" style={{ maxHeight: "400px" }}>
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Bot className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Start a conversation. Ask about compliance, risk assessment, or remittance regulations.</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {[
                  "What are the AML requirements for transfers over $10,000?",
                  "Explain the risk factors for Nigeria corridor",
                  "How do I file a SAR for structuring?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="text-xs border rounded-full px-3 py-1 hover:bg-accent transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-green-500" />
                </div>
              )}
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.role === "assistant" && (
                  <div className="flex gap-2 mt-2">
                    {msg.model && <Badge variant="outline" className="text-xs">{msg.model}</Badge>}
                    {msg.durationMs && <Badge variant="outline" className="text-xs">{msg.durationMs}ms</Badge>}
                    {msg.usedFallback && <Badge variant="secondary" className="text-xs">Fallback LLM</Badge>}
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex gap-3 justify-start">
              <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-green-500" />
              </div>
              <div className="bg-muted rounded-2xl px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              placeholder="Ask about compliance, risk, regulations..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              disabled={chatMutation.isPending}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={chatMutation.isPending || !input.trim()}>
              {chatMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
