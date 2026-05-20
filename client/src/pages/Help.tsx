import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HelpCircle, MessageCircle, Search, BookOpen, Phone, Mail, CheckCircle, Clock, AlertCircle, ExternalLink, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';

const FAQS = [
  { q: "How long do international transfers take?", a: "Most transfers complete within 1-2 business days. Express transfers to major corridors (UK→Nigeria, US→Kenya) can arrive in minutes.", category: "Transfers" },
  { q: "What are the transfer fees?", a: "RemitFlow charges 0.5% of the transfer amount, with a minimum of $1 and maximum of $25. There are no hidden fees — the rate you see is the rate you get.", category: "Fees" },
  { q: "How do I verify my identity (KYC)?", a: "Go to Profile → KYC Verification. You'll need a government-issued ID and a selfie. Tier 1 verification takes 1-2 hours; Tier 2 (for higher limits) takes 1-2 business days.", category: "Account" },
  { q: "What is the maximum transfer limit?", a: "Unverified accounts: $500/month. Tier 1 KYC: $5,000/month. Tier 2 KYC: $50,000/month. Business accounts have higher limits.", category: "Limits" },
  { q: "How do I add a beneficiary?", a: "Go to Beneficiaries → Add Beneficiary. Enter the recipient's name, bank account details, and country. Saved beneficiaries make future transfers faster.", category: "Transfers" },
  { q: "Is my money safe?", a: "Yes. RemitFlow is FCA-regulated and holds customer funds in segregated accounts. We use 256-bit encryption and 2FA to protect your account.", category: "Security" },
  { q: "Can I cancel a transfer?", a: "Transfers can be cancelled within 30 minutes of initiation if they haven't been processed. Go to Transactions → select the transfer → Cancel.", category: "Transfers" },
  { q: "How do I set up a recurring transfer?", a: "In the Send Money flow, select 'Schedule' and choose your frequency (weekly, monthly). You can manage scheduled transfers in the Scheduled Payments section.", category: "Transfers" },
  { q: "What currencies do you support?", a: "We support 50+ currencies including USD, GBP, EUR, NGN, KES, GHS, ZAR, TZS, UGX, RWF, XOF, EGP, SAR, AED, and more. Check the Rate Calculator for the full list.", category: "Currencies" },
  { q: "How do M-Pesa transfers work?", a: "Enter the recipient's M-Pesa number. They receive an STK push notification and confirm with their PIN. Funds arrive instantly in their M-Pesa wallet.", category: "Transfers" },
  { q: "How do I report a fraudulent transaction?", a: "Contact us immediately via live chat or call +44 20 1234 5678. We will freeze your account and investigate within 24 hours. You can also submit a dispute from the Transactions page.", category: "Security" },
  { q: "How do I change my password or 2FA?", a: "Go to Settings → Security. You can update your password, enable/disable 2FA, and manage trusted devices from there.", category: "Account" },
];

const TICKET_CATEGORIES = [
  "Transfer Issue",
  "Account Access",
  "KYC Verification",
  "Payment Failed",
  "Refund Request",
  "Fraud / Suspicious Activity",
  "Technical Problem",
  "Other",
];

export default function Help() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [ticketSubmitted, setTicketSubmitted] = useState(false);

  const notifyMutation = trpc.system.notifyOwner.useMutation({
    onSuccess: () => {
      setTicketSubmitted(true);
      toast.success("Support ticket submitted! We'll respond within 24 hours.");
      setSubject("");
      setMessage("");
      setCategory("");
    },
    onError: (e) => toast.error(e.message),
  });

  const allCategories = ["All", ...Array.from(new Set(FAQS.map(f => f.category)))];
  const filtered = FAQS.filter(f => {
    const matchSearch = !search || f.q.toLowerCase().includes(search.toLowerCase()) || f.a.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "All" || f.category === categoryFilter;
    return matchSearch && matchCat;
  });

  const scrollToTicket = () => {
    document.getElementById("support-ticket")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" />Help & Support
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Find answers, contact our team, or submit a support ticket</p>
        </div>

        {/* Contact Channels */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="bg-blue-50 dark:bg-blue-950/30 border-0 hover:shadow-md transition-shadow cursor-pointer" onClick={scrollToTicket}>
            <CardContent className="pt-4 flex flex-col items-center text-center gap-2">
              <MessageCircle className="w-6 h-6 text-blue-500" />
              <p className="font-semibold text-sm">Live Chat</p>
              <p className="text-xs text-muted-foreground">Available 9am–6pm GMT, Mon–Fri</p>
              <Badge variant="outline" className="text-xs text-green-600 border-green-300 bg-green-50">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 inline-block" />
                Online Now
              </Badge>
              <Button variant="outline" size="sm" className="mt-1 bg-background w-full" onClick={(e) => { e.stopPropagation(); scrollToTicket(); }}>
                Start Chat
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-purple-50 dark:bg-purple-950/30 border-0 hover:shadow-md transition-shadow">
            <CardContent className="pt-4 flex flex-col items-center text-center gap-2">
              <Mail className="w-6 h-6 text-purple-500" />
              <p className="font-semibold text-sm">Email Support</p>
              <p className="text-xs text-muted-foreground">support@remitflow.app</p>
              <p className="text-xs text-muted-foreground">Response within 24 hours</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 bg-background w-full"
                onClick={() => window.location.href = "mailto:support@remitflow.app?subject=Support Request"}
              >
                <Mail className="w-3 h-3 mr-1" />Send Email
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-green-50 dark:bg-green-950/30 border-0 hover:shadow-md transition-shadow">
            <CardContent className="pt-4 flex flex-col items-center text-center gap-2">
              <Phone className="w-6 h-6 text-green-500" />
              <p className="font-semibold text-sm">Phone Support</p>
              <p className="text-xs text-muted-foreground">+44 20 1234 5678</p>
              <p className="text-xs text-muted-foreground">Mon–Fri, 9am–5pm GMT</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 bg-background w-full"
                onClick={() => window.location.href = "tel:+442012345678"}
              >
                <Phone className="w-3 h-3 mr-1" />Call Now
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Quick Links */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ChevronRight className="w-4 h-4" />Quick Links</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Track a Transfer", href: "/transactions" },
                { label: "KYC Verification", href: "/kyc-verification" },
                { label: "Add Beneficiary", href: "/beneficiaries" },
                { label: "Rate Calculator", href: "/rate-calculator" },
                { label: "Dispute a Transaction", href: "/disputes" },
                { label: "Security Settings", href: "/security-settings" },
                { label: "Account Profile", href: "/profile" },
                { label: "API Documentation", href: "/api-changelog" },
              ].map((link, i) => (
                <Button key={i} variant="outline" size="sm" className="justify-start text-xs h-8" asChild>
                  <a href={link.href}><ExternalLink className="w-3 h-3 mr-1.5" />{link.label}</a>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* FAQ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5" />Frequently Asked Questions</CardTitle>
            <div className="flex gap-2 mt-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search FAQs..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="flex gap-1 flex-wrap">
                {allCategories.map(cat => (
                  <Button
                    key={cat}
                    variant={categoryFilter === cat ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <div className="text-center py-8">
                <HelpCircle className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No results found for "{search}"</p>
                <Button variant="link" size="sm" onClick={scrollToTicket}>Submit a support ticket instead</Button>
              </div>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {filtered.map((faq, i) => (
                  <AccordionItem key={i} value={`faq-${i}`}>
                    <AccordionTrigger className="text-left text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs shrink-0">{faq.category}</Badge>
                        {faq.q}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground pl-2">{faq.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>

        {/* Support Ticket */}
        <Card id="support-ticket">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageCircle className="w-5 h-5" />Submit a Support Ticket</CardTitle>
            <p className="text-sm text-muted-foreground">Can't find your answer? Our team responds within 24 hours.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {ticketSubmitted ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
                <p className="font-semibold text-lg">Ticket Submitted!</p>
                <p className="text-sm text-muted-foreground max-w-sm">Our support team will review your request and respond via email within 24 hours. Your ticket reference is <strong>RF-{Date.now().toString(36).toUpperCase()}</strong>.</p>
                <Button variant="outline" onClick={() => setTicketSubmitted(false)}>Submit Another Ticket</Button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Subject <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Transfer not received after 3 days" />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {TICKET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low — General inquiry</SelectItem>
                      <SelectItem value="normal">Normal — Issue affecting me</SelectItem>
                      <SelectItem value="high">High — Money stuck / urgent</SelectItem>
                      <SelectItem value="critical">Critical — Fraud / security breach</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label>Message <span className="text-red-500">*</span></Label>
                  <Textarea
                    className="mt-1"
                    rows={5}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Please describe your issue in detail. Include transaction IDs, dates, and amounts where relevant."
                  />
                  <p className="text-xs text-muted-foreground mt-1">{message.length}/2000 characters</p>
                </div>
                <div className="sm:col-span-2">
                  <Button
                    disabled={!subject || !message || notifyMutation.isPending}
                    onClick={() => notifyMutation.mutate({
                      title: `[${priority.toUpperCase()}] Support: ${subject}`,
                      content: `Category: ${category || "Unspecified"}\nPriority: ${priority}\n\n${message}`,
                    })}
                    className="w-full sm:w-auto"
                  >
                    {notifyMutation.isPending ? "Submitting..." : "Submit Support Ticket"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Status */}
        <Card>
          <CardHeader><CardTitle className="text-base">System Status</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { name: "Transfer Processing", status: "operational" },
                { name: "FX Rate Engine", status: "operational" },
                { name: "KYC Verification", status: "operational" },
                { name: "M-Pesa Integration", status: "degraded" },
                { name: "Card Payments", status: "operational" },
                { name: "Notifications", status: "operational" },
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <span className="text-sm">{s.name}</span>
                  <Badge
                    variant={s.status === "operational" ? "default" : s.status === "degraded" ? "secondary" : "destructive"}
                    className="text-xs"
                  >
                    {s.status === "operational" ? (
                      <><CheckCircle className="w-3 h-3 mr-1" />Operational</>
                    ) : s.status === "degraded" ? (
                      <><Clock className="w-3 h-3 mr-1" />Degraded</>
                    ) : (
                      <><AlertCircle className="w-3 h-3 mr-1" />Down</>
                    )}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Last updated: {new Date().toLocaleString()} ·{" "}
              <a href="https://status.remitflow.app" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Full status page <ExternalLink className="w-3 h-3 inline" />
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
