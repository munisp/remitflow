import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Bot, Send, User } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface Message {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  action?: { type: string; url: string };
}

export default function RemitAIChat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm RemitAI, your financial assistant. I can help you send money, check rates, or manage your account. How can I help?", suggestions: ["Send money", "Check rates", "My balance"] },
  ]);
  const [input, setInput] = useState("");
  const chatMut = trpc.remitAi.chat.useMutation();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = text ?? input;
    if (!msg.trim()) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    try {
      const result = await chatMut.mutateAsync({ message: msg });
      setMessages((prev) => [...prev, { role: "assistant", content: result.text, suggestions: result.suggestions, action: result.action as Message["action"] }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl" role="main" aria-label="RemitAI Chat">
      <h1 className="text-2xl font-bold mb-4">RemitAI Assistant</h1>
      <Card className="h-[600px] flex flex-col">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0"><Bot className="h-4 w-4" /></div>}
              <div className={`rounded-lg px-4 py-2 max-w-[80%] ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <p className="text-sm">{m.content}</p>
                {m.suggestions && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {m.suggestions.map((s, j) => (
                      <Button key={j} variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleSend(s)}>{s}</Button>
                    ))}
                  </div>
                )}
                {m.action && <Button variant="link" size="sm" className="mt-1 p-0 h-auto" onClick={() => window.location.href = m.action!.url}>{m.action.type}</Button>}
              </div>
              {m.role === "user" && <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0"><User className="h-4 w-4" /></div>}
            </div>
          ))}
          <div ref={endRef} />
        </CardContent>
        <div className="border-t p-4 flex gap-2">
          <Input placeholder="Ask RemitAI anything..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()} aria-label="Chat message" />
          <Button onClick={() => handleSend()} disabled={!input.trim() || chatMut.isPending}><Send className="h-4 w-4" /></Button>
        </div>
      </Card>
    </div>
  );
}
