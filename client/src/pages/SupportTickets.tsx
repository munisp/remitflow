import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, MessageSquare, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = { open: "bg-blue-100 text-blue-700", in_progress: "bg-yellow-100 text-yellow-700", resolved: "bg-green-100 text-green-700", closed: "bg-gray-100 text-gray-700" };
const PRIORITY_COLORS: Record<string, string> = { critical: "destructive", high: "destructive", medium: "default", low: "secondary" };

export default function SupportTickets() {
  const [showCreate, setShowCreate] = useState(false);
  const tickets = trpc.supportTicketing.getMyTickets.useQuery({ status: "all" });

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Support Tickets">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Support Tickets</h1>
        <Button onClick={() => setShowCreate(!showCreate)}><Plus className="h-4 w-4 mr-2" /> New Ticket</Button>
      </div>
      {showCreate && (
        <Card>
          <CardHeader><CardTitle>Create New Ticket</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Subject" aria-label="Subject" />
            <Textarea placeholder="Describe your issue..." aria-label="Description" />
            <div className="flex gap-2">
              <Button>Submit</Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {tickets.data?.tickets?.map((t: { id: string; subject: string; status: string; priority: string; createdAt: string; lastUpdated: string }, i: number) => (
          <Card key={i} className="cursor-pointer hover:bg-accent/50 transition-colors">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t.subject}</p>
                  <p className="text-xs text-muted-foreground">#{t.id} · Created {t.createdAt}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={(PRIORITY_COLORS[t.priority] as "default" | "secondary" | "destructive") ?? "default"}>{t.priority}</Badge>
                <Badge className={STATUS_COLORS[t.status] ?? ""}>{t.status.replace("_", " ")}</Badge>
              </div>
            </CardContent>
          </Card>
        )) ?? <p className="text-muted-foreground">No tickets yet</p>}
      </div>
      {/* FAQ Section */}
      <Card>
        <CardHeader><CardTitle>FAQ</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <details className="border-b pb-2"><summary className="cursor-pointer font-medium">How long does a transfer take?</summary><p className="text-sm text-muted-foreground mt-1">Most transfers complete within 24 hours. Express corridors settle in under 1 hour.</p></details>
          <details className="border-b pb-2"><summary className="cursor-pointer font-medium">What are the transfer limits?</summary><p className="text-sm text-muted-foreground mt-1">Tier 1 users can send up to ₦500,000/day. Complete KYC to unlock higher limits.</p></details>
          <details className="border-b pb-2"><summary className="cursor-pointer font-medium">How do I verify my identity?</summary><p className="text-sm text-muted-foreground mt-1">Go to Settings → KYC Verification to submit your ID document and complete liveness check.</p></details>
          <details><summary className="cursor-pointer font-medium">How do I contact support?</summary><p className="text-sm text-muted-foreground mt-1">Create a ticket above or email support@remitflow.com. Response time is under 4 hours.</p></details>
        </CardContent>
      </Card>
    </div>
  );
}
