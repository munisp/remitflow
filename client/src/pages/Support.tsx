import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MessageSquare, Plus, Search, Phone, Mail, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const FAQ = [
  { q: "How long does a transfer take?", a: "Most transfers complete in minutes. Bank transfers may take 1-3 business days." },
  { q: "What are the transfer fees?", a: "Fees range from 0.5% to 2% depending on corridor and amount." },
  { q: "How do I increase my transfer limits?", a: "Complete KYC verification. Tier 1 allows 500K/day, Tier 2 allows 5M/day." },
  { q: "Is my money safe?", a: "Yes. Funds are held in segregated accounts at tier-1 banks and fully insured." },
  { q: "How do I dispute a transaction?", a: "Go to Transactions, find the transaction, and tap Dispute." },
];

const CATEGORIES = ["payment_issue", "account_access", "kyc_verification", "card_issue", "technical", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const statusColor: Record<string, string> = { open: "bg-blue-500/10 text-blue-400", in_progress: "bg-yellow-500/10 text-yellow-400", resolved: "bg-green-500/10 text-green-400", closed: "bg-gray-500/10 text-gray-400" };

export default function Support() {
  const { t } = useTranslation();
  
  const [search, setSearch] = useState("");
  const [faqSearch, setFaqSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", description: "", category: "payment_issue", priority: "medium" });

  const { data: tickets, refetch } = trpc.support.tickets.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const createMutation = trpc.support.createTicket.useMutation({
    onSuccess: () => { toast.success("Ticket created"); setOpen(false); setForm({ subject: "", description: "", category: "payment_issue", priority: "medium" }); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const closeMutation = trpc.support.closeTicket.useMutation({
    onSuccess: () => { toast.success("Ticket closed"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = (tickets ?? []).filter((t: any) => !search || t.subject?.toLowerCase().includes(search.toLowerCase()));
  const filteredFaq = FAQ.filter(f => !faqSearch || f.q.toLowerCase().includes(faqSearch.toLowerCase()));

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Support</h1><p className="text-muted-foreground text-sm">We are here to help</p></div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" className="gap-2"><Plus className="h-4 w-4" />New Ticket</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Support Ticket</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1"><Label>Subject</Label><Input placeholder="Brief description" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Category</Label>
                    <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="space-y-1"><Label>Priority</Label>
                    <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
                  </div>
                </div>
                <div className="space-y-1"><Label>Description</Label><Textarea placeholder="Describe your issue..." rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
                <Button className="w-full" onClick={() => createMutation.mutate({ subject: form.subject, message: form.description, priority: form.priority as "low" | "medium" | "high" | "critical", category: form.category })} disabled={createMutation.isPending || !form.subject || !form.description}>{createMutation.isPending ? "Submitting..." : "Submit Ticket"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[{ icon: MessageSquare, label: "Live Chat", sub: "Avg 2 min reply" }, { icon: Mail, label: "Email", sub: "support@remitflow.app" }, { icon: Phone, label: "Phone", sub: "+234 1 700 0000" }].map(c => (
            <button key={c.label} className="p-4 rounded-xl border text-center hover:bg-accent/50 transition-all" onClick={() => toast.info(`${c.label}: ${c.sub}`)}>
              <c.icon className="h-5 w-5 mx-auto mb-2 text-primary" />
              <div className="font-medium text-sm">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.sub}</div>
            </button>
          ))}
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">My Tickets</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search tickets..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} /></div>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="resolved">Resolved</SelectItem></SelectContent></Select>
            </div>
            {!filtered.length ? <div className="text-center py-6 text-muted-foreground text-sm">No tickets found</div>
              : filtered.map((t: any) => (
              <div key={t.id} className="flex items-start justify-between p-3 border rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1"><span className="font-medium text-sm truncate">{t.subject}</span><Badge className={"text-xs " + (statusColor[t.status ?? "open"] ?? "")}>{t.status}</Badge></div>
                  <div className="text-xs text-muted-foreground">#{t.id} · {t.category?.replace(/_/g," ")} · {new Date(t.createdAt ?? Date.now()).toLocaleDateString()}</div>
                </div>
                {t.status === "open" && <Button size="sm" variant="outline" className="ml-2 shrink-0" onClick={() => closeMutation.mutate({ id: t.id })}>Close</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">FAQ</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="relative mb-3"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search FAQs..." value={faqSearch} onChange={e => setFaqSearch(e.target.value)} /></div>
            {filteredFaq.map((f, i) => (
              <div key={i} className="border rounded-lg overflow-hidden">
                <button className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30" onClick={() => setExpanded(expanded === i ? null : i)}>
                  <span className="font-medium text-sm">{f.q}</span>
                  {expanded === i ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
                {expanded === i && <div className="px-4 pb-4 text-sm text-muted-foreground">{f.a}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
