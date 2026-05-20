import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ShareButton } from "@/components/ShareDialog";
import { LiveVoteCounter } from "@/components/LiveVoteCounter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Heart, Users, Globe, TrendingUp, Vote, Plus, Loader2,
  ChevronDown, ChevronUp, DollarSign, Target, CheckCircle2, Building2
} from "lucide-react";
import { useTranslation } from 'react-i18next';

const THEMES = ["Education", "Healthcare", "Climate", "Infrastructure", "Agriculture", "Technology", "Women & Girls", "Youth"];
const COUNTRIES = ["Nigeria", "Kenya", "Ghana", "Rwanda", "Senegal", "Ethiopia", "Tanzania", "Uganda", "South Africa", "Egypt"];

export default function Community() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [createFundOpen, setCreateFundOpen] = useState(false);
  const [contributeDialog, setContributeDialog] = useState<{ open: boolean; fund: any | null }>({ open: false, fund: null });
  const [proposalDialog, setProposalDialog] = useState<{ open: boolean; fund: any | null }>({ open: false, fund: null });
  const [expandedFund, setExpandedFund] = useState<number | null>(null);
  const [contributeAmount, setContributeAmount] = useState("");
  const [fundForm, setFundForm] = useState({ name: "", description: "", country: "", theme: "", goalAmount: "" });
  const [proposalForm, setProposalForm] = useState({ title: "", description: "", requestedAmount: "", organisationName: "" });
  const [disbursementDialog, setDisbursementDialog] = useState<{ open: boolean; proposalId: number | null }>({ open: false, proposalId: null });
  const [disbursementMethod, setDisbursementMethod] = useState<"wallet" | "bank" | "mobile_money">("wallet");

  const { data: funds = [], isLoading } = trpc.community.listFunds.useQuery();
  const { data: proposals = [] } = trpc.community.listProposals.useQuery(
    { fundId: expandedFund! },
    { enabled: expandedFund !== null }
  );

  const createFund = trpc.community.createFund.useMutation({
    onSuccess: () => {
      toast.success("Community fund created!", { description: "Share it with the diaspora to start raising funds." });
      utils.community.listFunds.invalidate();
      setCreateFundOpen(false);
      setFundForm({ name: "", description: "", country: "", theme: "", goalAmount: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const contribute = trpc.community.contribute.useMutation({
    onSuccess: () => {
      toast.success("Contribution recorded!", { description: "Thank you for supporting this fund." });
      utils.community.listFunds.invalidate();
      setContributeDialog({ open: false, fund: null });
      setContributeAmount("");
    },
    onError: (e) => toast.error(e.message),
  });

  const submitProposal = trpc.community.submitProposal.useMutation({
    onSuccess: () => {
      toast.success("Proposal submitted for community vote.");
      utils.community.listProposals.invalidate({ fundId: expandedFund! });
      setProposalDialog({ open: false, fund: null });
      setProposalForm({ title: "", description: "", requestedAmount: "", organisationName: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const vote = trpc.community.vote.useMutation({
    onSuccess: () => {
      utils.community.listProposals.invalidate({ fundId: expandedFund! });
      toast.success("Vote recorded.");
    },
    onError: (e) => toast.error(e.message),
  });
  const requestDisbursement = trpc.community.requestDisbursement.useMutation({
    onSuccess: () => {
      utils.community.listProposals.invalidate({ fundId: expandedFund! });
      toast.success("Disbursement requested!", { description: "An admin will review and process the payment." });
    },
    onError: (e) => toast.error(e.message),
  });

  const totalRaised = (funds as any[]).reduce((s: number, f: any) => s + Number(f.totalRaised), 0);
  const totalContributors = (funds as any[]).reduce((s: number, f: any) => s + Number(f.contributorCount), 0);

  const themeColors: Record<string, string> = {
    Education: "bg-blue-100 text-blue-700",
    Healthcare: "bg-red-100 text-red-700",
    Climate: "bg-emerald-100 text-emerald-700",
    Infrastructure: "bg-amber-100 text-amber-700",
    Agriculture: "bg-lime-100 text-lime-700",
    Technology: "bg-purple-100 text-purple-700",
    "Women & Girls": "bg-pink-100 text-pink-700",
    Youth: "bg-cyan-100 text-cyan-700",
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Heart className="w-6 h-6 text-rose-500" />
              DiasporaDAO — Community Funds
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Pool diaspora capital for community-governed philanthropy. Vote on grant proposals. Track real impact.
            </p>
          </div>
          <Button onClick={() => setCreateFundOpen(true)} className="bg-rose-600 hover:bg-rose-700 text-white">
            <Plus className="w-4 h-4 mr-2" /> Create Fund
          </Button>
        </div>

        {/* Impact stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Raised", value: `$${totalRaised.toLocaleString()}`, icon: DollarSign, color: "text-emerald-600" },
            { label: "Active Funds", value: funds.length, icon: Target, color: "text-blue-600" },
            { label: "Contributors", value: totalContributors, icon: Users, color: "text-purple-600" },
            { label: "Countries", value: new Set((funds as any[]).map((f: any) => f.country).filter(Boolean)).size, icon: Globe, color: "text-teal-600" },
          ].map(s => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                  <div>
                    <div className="text-xl font-bold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Fund cards */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading funds…
          </div>
        ) : (funds as any[]).length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Heart className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
            <p>No community funds yet. Be the first to create one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {(funds as any[]).map((fund: any) => {
              const pct = Math.min(100, (Number(fund.totalRaised) / Number(fund.goalAmount)) * 100);
              const isExpanded = expandedFund === fund.id;
              return (
                <Card key={fund.id} className="border-border/50">
                  <CardContent className="pt-5 pb-4 space-y-4">
                    {/* Fund header */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {fund.theme && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${themeColors[fund.theme] ?? "bg-gray-100 text-gray-700"}`}>
                              {fund.theme}
                            </span>
                          )}
                          {fund.country && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Globe className="w-3 h-3" /> {fund.country}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" /> {fund.contributorCount} contributors
                          </span>
                        </div>
                        <h3 className="font-semibold text-foreground">{fund.name}</h3>
                        {fund.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{fund.description}</p>}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setExpandedFund(isExpanded ? null : fund.id); }}
                          className="flex items-center gap-1"
                        >
                          <Vote className="w-3.5 h-3.5" />
                          Proposals
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </Button>
                        <ShareButton
                          target={{
                            resourceType: "fund",
                            resourceId: String(fund.id),
                            title: fund.name,
                            description: fund.description ?? `Help fund ${fund.name} — a community initiative by the diaspora.`,
                            targetUrl: `${window.location.origin}/community`,
                          }}
                          variant="outline"
                          size="sm"
                          label="Share"
                        />
                        <Button
                          size="sm"
                          className="bg-rose-600 hover:bg-rose-700 text-white"
                          onClick={() => { setContributeDialog({ open: true, fund }); setContributeAmount(""); }}
                        >
                          <Heart className="w-3.5 h-3.5 mr-1" /> Contribute
                        </Button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-emerald-600">${Number(fund.totalRaised).toLocaleString()} raised</span>
                        <span className="text-muted-foreground">Goal: ${Number(fund.goalAmount).toLocaleString()}</span>
                      </div>
                      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{pct.toFixed(1)}% of goal reached</p>
                    </div>

                    {/* Expanded proposals */}
                    {isExpanded && (
                      <div className="border-t pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm">Grant Proposals</h4>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setProposalDialog({ open: true, fund })}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" /> Submit Proposal
                          </Button>
                        </div>
                        {proposals.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">No proposals yet. Submit the first one.</p>
                        ) : (
                          (proposals as any[]).map((p: any) => {
                            const totalVotes = (p.votesFor ?? 0) + (p.votesAgainst ?? 0);
                            const forPct = totalVotes > 0 ? Math.round((p.votesFor / totalVotes) * 100) : 0;
                            return (
                              <div key={p.id} className="bg-muted/40 rounded-xl p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="font-medium text-sm">{p.title}</p>
                                    {p.organisationName && (
                                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                        <Building2 className="w-3 h-3" /> {p.organisationName}
                                      </p>
                                    )}
                                    {p.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="font-bold text-sm text-emerald-600">${Number(p.requestedAmount).toLocaleString()}</p>
                                    <Badge
                                      className={
                                        p.status === "approved" ? "bg-emerald-100 text-emerald-700 text-xs" :
                                        p.status === "rejected" ? "bg-red-100 text-red-700 text-xs" :
                                        "bg-amber-100 text-amber-700 text-xs"
                                      }
                                    >
                                      {p.status}
                                    </Badge>
                                  </div>
                                </div>
                                {/* Live vote counter — real-time SSE + polling */}
                                <LiveVoteCounter
                                  proposalId={p.id}
                                  initialFor={p.votesFor ?? 0}
                                  initialAgainst={p.votesAgainst ?? 0}
                                />
                                {/* Disbursement button for approved proposals */}
                                {(p.status === "approved" || (p.status === "voting" && (p.votesFor ?? 0) >= 10)) && (
                                  <Button
                                    size="sm"
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                                    onClick={() => { setDisbursementDialog({ open: true, proposalId: p.id }); setDisbursementMethod("wallet"); }}
                                    disabled={requestDisbursement.isPending}
                                  >
                                    {requestDisbursement.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <DollarSign className="w-3.5 h-3.5 mr-1" />}
                                    Request Disbursement
                                  </Button>
                                )}
                                {/* Vote buttons */}
                                {p.status === "voting" && (
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant={p.myVote === "for" ? "default" : "outline"}
                                      className={p.myVote === "for" ? "bg-emerald-600 hover:bg-emerald-700 text-white flex-1" : "flex-1"}
                                      onClick={() => vote.mutate({ proposalId: p.id, vote: "for" })}
                                      disabled={vote.isPending}
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Vote For
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={p.myVote === "against" ? "destructive" : "outline"}
                                      className="flex-1"
                                      onClick={() => vote.mutate({ proposalId: p.id, vote: "against" })}
                                      disabled={vote.isPending}
                                    >
                                      Vote Against
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Disbursement Method Dialog */}
      <Dialog open={disbursementDialog.open} onOpenChange={o => setDisbursementDialog({ open: o, proposalId: disbursementDialog.proposalId })}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request Disbursement</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Select how the approved funds should be disbursed to the grant recipient.</p>
            <div className="space-y-2">
              <Label>Disbursement Method</Label>
              <Select value={disbursementMethod} onValueChange={v => setDisbursementMethod(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wallet">RemitFlow Wallet</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisbursementDialog({ open: false, proposalId: null })}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={requestDisbursement.isPending}
              onClick={() => {
                if (disbursementDialog.proposalId) {
                  requestDisbursement.mutate({ proposalId: disbursementDialog.proposalId, disbursementMethod });
                  setDisbursementDialog({ open: false, proposalId: null });
                }
              }}
            >
              {requestDisbursement.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Processing…</> : "Confirm Disbursement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Fund Dialog */}
      <Dialog open={createFundOpen} onOpenChange={setCreateFundOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Community Fund</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fund Name *</Label>
              <Input placeholder="e.g. Nigeria Education Fund" value={fundForm.name} onChange={e => setFundForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="What is this fund for? Who will benefit?" rows={3} value={fundForm.description} onChange={e => setFundForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Country</Label>
                <Select value={fundForm.country} onValueChange={v => setFundForm(f => ({ ...f, country: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Theme</Label>
                <Select value={fundForm.theme} onValueChange={v => setFundForm(f => ({ ...f, theme: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{THEMES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fundraising Goal (USD) *</Label>
              <Input type="number" placeholder="e.g. 50000" value={fundForm.goalAmount} onChange={e => setFundForm(f => ({ ...f, goalAmount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFundOpen(false)}>Cancel</Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              disabled={!fundForm.name || !fundForm.goalAmount || createFund.isPending}
              onClick={() => createFund.mutate({ name: fundForm.name, description: fundForm.description || undefined, country: fundForm.country || undefined, theme: fundForm.theme || undefined, goalAmount: parseFloat(fundForm.goalAmount) })}
            >
              {createFund.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Creating…</> : "Create Fund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contribute Dialog */}
      <Dialog open={contributeDialog.open} onOpenChange={o => setContributeDialog({ open: o, fund: contributeDialog.fund })}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Contribute to Fund</DialogTitle></DialogHeader>
          {contributeDialog.fund && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <p className="font-medium">{contributeDialog.fund.name}</p>
                <p className="text-muted-foreground">{contributeDialog.fund.country} · {contributeDialog.fund.theme}</p>
              </div>
              <div className="space-y-2">
                <Label>Amount (USD) *</Label>
                <Input type="number" placeholder="e.g. 100" value={contributeAmount} onChange={e => setContributeAmount(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setContributeDialog({ open: false, fund: null })}>Cancel</Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              disabled={!contributeAmount || contribute.isPending}
              onClick={() => contribute.mutate({ fundId: contributeDialog.fund!.id, amount: parseFloat(contributeAmount) })}
            >
              {contribute.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Contributing…</> : "Contribute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit Proposal Dialog */}
      <Dialog open={proposalDialog.open} onOpenChange={o => setProposalDialog({ open: o, fund: proposalDialog.fund })}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Submit Grant Proposal</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Proposal Title *</Label>
              <Input placeholder="e.g. Build 3 Libraries in Kano State" value={proposalForm.title} onChange={e => setProposalForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Organisation Name</Label>
              <Input placeholder="e.g. Kano Education Foundation" value={proposalForm.organisationName} onChange={e => setProposalForm(f => ({ ...f, organisationName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Describe the project, beneficiaries, and expected impact…" rows={3} value={proposalForm.description} onChange={e => setProposalForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Requested Amount (USD) *</Label>
              <Input type="number" placeholder="e.g. 25000" value={proposalForm.requestedAmount} onChange={e => setProposalForm(f => ({ ...f, requestedAmount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposalDialog({ open: false, fund: null })}>Cancel</Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              disabled={!proposalForm.title || !proposalForm.requestedAmount || submitProposal.isPending}
              onClick={() => submitProposal.mutate({ fundId: proposalDialog.fund!.id, title: proposalForm.title, description: proposalForm.description || undefined, requestedAmount: parseFloat(proposalForm.requestedAmount), beneficiaryName: proposalForm.organisationName || undefined })}
            >
              {submitProposal.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Submitting…</> : "Submit Proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
