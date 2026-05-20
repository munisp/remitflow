import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Users, Globe, Leaf, BookOpen, Zap, Building2, Plus, ExternalLink, Target, Calendar, DollarSign, Info } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const SECTOR_ICONS: Record<string, React.ReactNode> = {
  Technology: <Zap className="h-4 w-4" />,
  Energy: <Leaf className="h-4 w-4" />,
  Agriculture: <Globe className="h-4 w-4" />,
  Infrastructure: <Building2 className="h-4 w-4" />,
  Education: <BookOpen className="h-4 w-4" />,
};

const SECTOR_COLORS: Record<string, string> = {
  Technology: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  Energy: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  Agriculture: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  Infrastructure: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  Education: "bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300",
};

const STAGE_LABELS: Record<string, string> = {
  seed: "Seed Round",
  growth: "Growth Stage",
  bond: "Diaspora Bond",
};

const STAGE_COLORS: Record<string, string> = {
  seed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  growth: "bg-blue-100 text-blue-700 border-blue-200",
  bond: "bg-amber-100 text-amber-700 border-amber-200",
};

export default function DiasporaInvest() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCollectiveName, setNewCollectiveName] = useState("");
  const [newCollectiveDesc, setNewCollectiveDesc] = useState("");
  const [selectedOpportunity, setSelectedOpportunity] = useState<any>(null);
  const utils = trpc.useUtils();

  const { data: opportunities, isLoading: loadingOpps } = trpc.diaspora.listOpportunities.useQuery();
  const { data: collectives, isLoading: loadingCollectives } = trpc.diaspora.listCollectives.useQuery();

  const createCollective = trpc.diaspora.createCollective.useMutation({
    onSuccess: (data) => {
      toast.success(`Collective "${data.name}" created!`);
      utils.diaspora.listCollectives.invalidate();
      setCreateDialogOpen(false);
      setNewCollectiveName("");
      setNewCollectiveDesc("");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Hero Header */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-emerald-900 via-teal-800 to-blue-900 p-8 text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 right-8 w-32 h-32 rounded-full bg-white/20" />
          <div className="absolute bottom-4 left-16 w-20 h-20 rounded-full bg-white/10" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-6 w-6 text-emerald-300" />
            <span className="text-emerald-300 text-sm font-medium uppercase tracking-wider">DiasporaVest</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Invest in Africa's Future</h1>
          <p className="text-white/70 max-w-2xl text-sm leading-relaxed">
            Go beyond remittances. Pool capital with fellow diaspora members, access curated investment opportunities,
            and build lasting wealth while driving development in your homeland.
          </p>
          <div className="flex items-center gap-6 mt-6 flex-wrap">
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-300">$90B+</div>
              <div className="text-xs text-white/60">Annual diaspora remittances</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-teal-300">5 Countries</div>
              <div className="text-xs text-white/60">Active investment corridors</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-300">$500+</div>
              <div className="text-xs text-white/60">Minimum investment</div>
            </div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
        <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          <strong>Preview mode.</strong> DiasporaVest is in early access. Investment opportunities shown are illustrative.
          Full KYC verification and regulatory compliance checks will be required before any capital commitment.
          Past performance does not guarantee future returns.
        </p>
      </div>

      {/* Investment Opportunities */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Curated Opportunities</h2>
          <Badge variant="outline" className="text-xs">
            {opportunities?.length ?? 0} active
          </Badge>
        </div>
        {loadingOpps ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-64 bg-muted animate-pulse rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(opportunities ?? []).map((opp: any) => {
              const pct = Math.round((opp.raisedAmount / opp.targetAmount) * 100);
              return (
                <DashboardLayout>
                <Card
                  key={opp.id}
                  className="cursor-pointer hover:shadow-md transition-all border hover:border-primary/30"
                  onClick={() => setSelectedOpportunity(opp)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className={`p-2 rounded-lg ${SECTOR_COLORS[opp.sector] ?? "bg-muted"}`}>
                        {SECTOR_ICONS[opp.sector] ?? <TrendingUp className="h-4 w-4" />}
                      </div>
                      <Badge variant="outline" className={`text-xs ${STAGE_COLORS[opp.stage] ?? ""}`}>
                        {STAGE_LABELS[opp.stage] ?? opp.stage}
                      </Badge>
                    </div>
                    <CardTitle className="text-base mt-2 leading-tight">{opp.title}</CardTitle>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Globe className="h-3 w-3" />
                      {opp.country} · {opp.sector}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground line-clamp-2">{opp.description}</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Raised</span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>${Number(opp.raisedAmount ?? 0).toLocaleString()} raised</span>
                        <span>of ${Number(opp.targetAmount ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">${Number(opp.minInvestment ?? 0).toLocaleString()}</span> min
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {new Date(opp.dueDate).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {opp.sdgAlignment.map((sdg: string) => (
                        <Badge key={sdg} variant="secondary" className="text-xs h-4 px-1.5">{sdg}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              
                </DashboardLayout>
              );
            })}
          </div>
        )}
      </section>

      {/* My Collectives */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">My Investment Collectives</h2>
            <p className="text-sm text-muted-foreground">Pool capital with fellow diaspora members</p>
          </div>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Collective
          </Button>
        </div>
        {loadingCollectives ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map(i => <div key={i} className="h-36 bg-muted animate-pulse rounded-xl" />)}
          </div>
        ) : (collectives ?? []).length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-40" />
              <p className="font-medium text-muted-foreground">No collectives yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create or join an investment collective to pool capital with other diaspora members.</p>
              <Button size="sm" className="mt-4" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Create Collective
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(collectives ?? []).map((c: any) => (
              <Card key={c.id} className="hover:shadow-sm transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{c.name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.memberCount} members</span>
                        {c.nextVote && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Vote {new Date(c.nextVote).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-xs">{c.status}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="text-xs text-muted-foreground mb-1">Total Pool</div>
                      <div className="font-bold text-sm">${Number(c.totalContributed ?? 0).toLocaleString()} {c.currency}</div>
                    </div>
                    <div className="rounded-lg bg-primary/5 p-3">
                      <div className="text-xs text-muted-foreground mb-1">My Contribution</div>
                      <div className="font-bold text-sm text-primary">${Number(c.myContribution ?? 0).toLocaleString()} {c.currency}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Create Collective Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-500" />
              Create Investment Collective
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Collective Name</Label>
              <Input
                value={newCollectiveName}
                onChange={e => setNewCollectiveName(e.target.value)}
                placeholder="e.g. Nigeria Tech Investors"
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={newCollectiveDesc}
                onChange={e => setNewCollectiveDesc(e.target.value)}
                placeholder="What is the focus of this collective?"
                className="text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!newCollectiveName.trim() || createCollective.isPending}
              onClick={() => createCollective.mutate({ name: newCollectiveName.trim(), description: newCollectiveDesc || undefined })}
            >
              {createCollective.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Opportunity Detail Dialog */}
      {selectedOpportunity && (
        <Dialog open={!!selectedOpportunity} onOpenChange={() => setSelectedOpportunity(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-lg leading-tight">{selectedOpportunity.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline" className={`text-xs ${STAGE_COLORS[selectedOpportunity.stage] ?? ""}`}>
                  {STAGE_LABELS[selectedOpportunity.stage] ?? selectedOpportunity.stage}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Globe className="h-3 w-3" />{selectedOpportunity.country} · {selectedOpportunity.sector}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{selectedOpportunity.description}</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Funding progress</span>
                  <span className="font-medium">{Math.round((selectedOpportunity.raisedAmount / selectedOpportunity.targetAmount) * 100)}%</span>
                </div>
                <Progress value={Math.round((selectedOpportunity.raisedAmount / selectedOpportunity.targetAmount) * 100)} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>${Number(selectedOpportunity.raisedAmount ?? 0).toLocaleString()} raised</span>
                  <span>Target: ${Number(selectedOpportunity.targetAmount ?? 0).toLocaleString()}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="h-3 w-3" />Min Investment</div>
                  <div className="font-bold">${Number(selectedOpportunity.minInvestment ?? 0).toLocaleString()}</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Target className="h-3 w-3" />Closing Date</div>
                  <div className="font-bold">{new Date(selectedOpportunity.dueDate).toLocaleDateString()}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-2">SDG Alignment</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedOpportunity.sdgAlignment.map((sdg: string) => (
                    <Badge key={sdg} variant="secondary" className="text-xs">{sdg}</Badge>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setSelectedOpportunity(null)}>Close</Button>
              <Button size="sm" onClick={() => {
                setSelectedOpportunity(null);
                window.location.href = `/kyc-verification?returnTo=/diaspora-invest&reason=investment&opportunity=${encodeURIComponent(selectedOpportunity?.name ?? '')}`;  
                toast.success("Redirecting to KYC verification to complete your investment registration.");
              }}>
                Express Interest
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
