import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, Users, Copy, CheckCircle2, XCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

interface Participant {
  name: string;
  email: string;
  shareAmount: string;
}

export default function SplitBill() {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [participants, setParticipants] = useState<Participant[]>([
    { name: "", email: "", shareAmount: "" },
    { name: "", email: "", shareAmount: "" },
  ]);
  const [createdGroup, setCreatedGroup] = useState<{ groupId: string; participants: { id: number; token: string; name: string; email?: string; amount: number }[] } | null>(null);

  const { data: groups, refetch } = trpc.splitBill.list.useQuery();

  const createMutation = trpc.splitBill.create.useMutation({
    onSuccess: (data) => {
      setCreatedGroup(data);
      refetch();
      toast.success("Split bill created", { description: `${data.participants.length} participants notified.` });
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const cancelMutation = trpc.splitBill.cancel.useMutation({
    onSuccess: () => { refetch(); toast.success("Split bill cancelled"); },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const addParticipant = () => setParticipants([...participants, { name: "", email: "", shareAmount: "" }]);
  const removeParticipant = (i: number) => setParticipants(participants.filter((_, idx) => idx !== i));
  const updateParticipant = (i: number, field: keyof Participant, value: string) => {
    const updated = [...participants];
    updated[i] = { ...updated[i], [field]: value };
    setParticipants(updated);
  };

  const totalAmount = participants.reduce((sum, p) => sum + (parseFloat(p.shareAmount) || 0), 0);

  const handleCreate = () => {
    if (!title.trim()) return void toast.error("Title required");
    const valid = participants.filter((p) => p.name.trim() && parseFloat(p.shareAmount) > 0);
    if (valid.length < 2) return void toast.error("At least 2 participants required");
    createMutation.mutate({
      title: title.trim(),
      totalAmount,
      currency,
      participants: valid.map((p) => ({
        name: p.name.trim(),
        email: p.email.trim() || undefined,
        shareAmount: parseFloat(p.shareAmount),
      })),
      expiresInDays,
      note: note.trim() || undefined,
    });
  };

  const copyLink = (token: string) => {
    const link = `${window.location.origin}/pay-request?token=${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Link copied!");
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Split Bill</h1>
          <p className="text-muted-foreground">Divide a payment among multiple people. Each participant gets their own payment link.</p>
        </div>

        {/* Create Form */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> New Split Bill</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input placeholder="Dinner at Nobu" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {["USD", "GBP", "EUR", "NGN", "GHS", "KES", "ZAR", "CAD", "AUD"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Note (optional)</Label>
                <Input placeholder="Add a note..." value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Expires in (days)</Label>
                <Input type="number" min={1} max={30} value={expiresInDays} onChange={(e) => setExpiresInDays(parseInt(e.target.value) || 7)} />
              </div>
            </div>

            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Participants</Label>
                <Button variant="outline" size="sm" onClick={addParticipant}><Plus className="h-4 w-4 mr-1" /> Add</Button>
              </div>
              {participants.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_120px_40px] gap-2 items-end">
                  <div>
                    {i === 0 && <Label className="text-xs text-muted-foreground">Name</Label>}
                    <Input placeholder="Name" value={p.name} onChange={(e) => updateParticipant(i, "name", e.target.value)} />
                  </div>
                  <div>
                    {i === 0 && <Label className="text-xs text-muted-foreground">Email (optional)</Label>}
                    <Input placeholder="email@example.com" value={p.email} onChange={(e) => updateParticipant(i, "email", e.target.value)} />
                  </div>
                  <div>
                    {i === 0 && <Label className="text-xs text-muted-foreground">Amount</Label>}
                    <Input type="number" placeholder="0.00" value={p.shareAmount} onChange={(e) => updateParticipant(i, "shareAmount", e.target.value)} />
                  </div>
                  <div className={i === 0 ? "mt-5" : ""}>
                    <Button variant="ghost" size="icon" onClick={() => removeParticipant(i)} disabled={participants.length <= 2}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="text-right text-sm font-medium">
                Total: <span className="text-primary">{currency} {totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <Button className="w-full" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</> : "Create Split Bill"}
            </Button>
          </CardContent>
        </Card>

        {/* Created Group Result */}
        {createdGroup && (
          <Card className="border-green-500/50 bg-green-500/5">
            <CardHeader><CardTitle className="text-green-600 flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> Split Bill Created</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {createdGroup.participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border bg-background">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{currency} {p.amount.toFixed(2)}{p.email && ` · ${p.email}`}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => copyLink(p.token)}>
                    <Copy className="h-4 w-4 mr-1" /> Copy Link
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Existing Groups */}
        {groups && groups.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Previous Split Bills</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {groups.map((g) => (
                <div key={g.groupId} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium">{g.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {g.currency} {Number(g.totalAmount).toFixed(2)} · {g.paid}/{g.participants} paid · {new Date(g.createdAt!).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={g.paid === g.participants ? "default" : "secondary"}>
                      {g.paid === g.participants ? "Complete" : "Pending"}
                    </Badge>
                    {g.paid < g.participants && (
                      <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate({ groupId: g.groupId })}>
                        <XCircle className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
