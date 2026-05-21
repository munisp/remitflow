import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "@/hooks/use-toast";
import { MessageCircle, Plus, CheckCircle, Clock, AlertCircle, HelpCircle, ChevronRight } from "lucide-react";
import { useTranslation } from 'react-i18next';

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  open: <Clock className="h-3 w-3 text-blue-500" />,
  in_progress: <AlertCircle className="h-3 w-3 text-orange-500" />,
  resolved: <CheckCircle className="h-3 w-3 text-green-500" />,
  closed: <CheckCircle className="h-3 w-3 text-slate-400" />,
};

const CATEGORIES = [
  { value: "general", label: "General Enquiry" },
  { value: "transfers", label: "Transfer Issue" },
  { value: "kyc", label: "KYC / Verification" },
  { value: "payment", label: "Payment Problem" },
  { value: "account", label: "Account Access" },
  { value: "dispute", label: "Transaction Dispute" },
  { value: "agent", label: "Agent Network" },
  { value: "technical", label: "Technical Issue" },
];

export default function SupportTickets() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [category, setCategory] = useState("general");
  const [activeTab, setActiveTab] = useState("tickets");

  const { data: tickets = [], refetch } = trpc.support.tickets.useQuery({ limit: 50 });
  const { data: faqs = [] } = trpc.support.faqs.useQuery();

  const createMutation = trpc.support.createTicket.useMutation({
    onSuccess: (data) => {
      toast("Ticket submitted", { description: `Reference: ${data.ticketId}` });
      setOpen(false);
      setSubject("");
      setMessage("");
      setPriority("medium");
      setCategory("general");
      refetch();
    },
    onError: (err) => toast.error("Error"),
  });

  const closeMutation = trpc.support.closeTicket.useMutation({
    onSuccess: () => {
      toast("Ticket closed");
      refetch();
    },
  });

  const openTickets = tickets.filter((t: any) => t.status !== "closed" && t.status !== "resolved");
  const closedTickets = tickets.filter((t: any) => t.status === "closed" || t.status === "resolved");

  if (!user) return null;

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-primary" />
            Support Tickets
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Get help with transfers, account issues, and more.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Ticket
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Submit a Support Ticket</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-sm font-medium mb-1 block">Category</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Priority</label>
                <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low — General question</SelectItem>
                    <SelectItem value="medium">Medium — Issue affecting usage</SelectItem>
                    <SelectItem value="high">High — Money stuck or delayed</SelectItem>
                    <SelectItem value="critical">Critical — Fraud or security concern</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Subject</label>
                <Input
                  placeholder="Brief description of your issue"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Details</label>
                <Textarea
                  placeholder="Describe your issue in detail. Include transaction IDs, amounts, and dates if relevant."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={2000}
                />
                <p className="text-xs text-muted-foreground mt-1">{message.length}/2000</p>
              </div>
              <Button
                className="w-full"
                disabled={!subject.trim() || !message.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate({ subject, message, priority, category })}
              >
                {createMutation.isPending ? "Submitting..." : "Submit Ticket"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="text-center py-4">
          <p className="text-2xl font-bold text-blue-600">{openTickets.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Open Tickets</p>
        </Card>
        <Card className="text-center py-4">
          <p className="text-2xl font-bold text-green-600">{closedTickets.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Resolved</p>
        </Card>
        <Card className="text-center py-4">
          <p className="text-2xl font-bold text-slate-600">{tickets.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total</p>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="tickets">My Tickets</TabsTrigger>
          <TabsTrigger value="faqs">FAQs</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-3 mt-4">
          {tickets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <MessageCircle className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="font-medium text-muted-foreground">No tickets yet</p>
                <p className="text-sm text-muted-foreground mt-1">Submit a ticket if you need help with anything.</p>
                <Button className="mt-4 gap-2" onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New Ticket
                </Button>
              </CardContent>
            </Card>
          ) : (
            tickets.map((ticket: any) => (
              <Card key={ticket.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {STATUS_ICONS[ticket.status] ?? STATUS_ICONS.open}
                        <span className="font-medium text-sm truncate">{ticket.subject}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{ticket.message || ticket.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-xs capitalize">{ticket.status?.replace("_", " ") ?? "open"}</Badge>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[ticket.priority] ?? PRIORITY_COLORS.medium}`}>
                          {ticket.priority ?? "medium"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ticket.category ?? "general"}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : ""}
                        </span>
                      </div>
                    </div>
                    {ticket.status !== "closed" && ticket.status !== "resolved" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-xs"
                        disabled={closeMutation.isPending}
                        onClick={() => closeMutation.mutate({ id: ticket.id })}
                      >
                        Close
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="faqs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HelpCircle className="h-5 w-5 text-primary" />
                Frequently Asked Questions
              </CardTitle>
              <CardDescription>Quick answers to common questions</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq: any) => (
                  <AccordionItem key={faq.id} value={String(faq.id)}>
                    <AccordionTrigger className="text-sm text-left">{faq.q}</AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground">{faq.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              <div className="mt-6 p-4 bg-muted/50 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Can't find what you're looking for?</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Our support team responds within 24 hours.</p>
                </div>
                <Button size="sm" className="gap-1" onClick={() => { setActiveTab("tickets"); setOpen(true); }}>
                  Contact Support
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
