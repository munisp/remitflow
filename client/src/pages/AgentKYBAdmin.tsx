/**
 * AgentKYBAdmin.tsx
 * Admin page for reviewing, approving, and rejecting agent KYB applications.
 * Route: /admin/agent-kyb
 * Uses: trpc.agentOnboarding.listPending, .approve, .reject
 */
import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, CheckCircle2, XCircle, Clock, Building2,
  Phone, MapPin, CreditCard, FileText, RefreshCw, ShieldCheck
} from "lucide-react";

interface AgentApplication {
  id: number;
  userId: number;
  agentCode: string;
  businessName?: string | null;
  tier: string;
  status: string;
  commissionRate: string;
  dailyLimit: string;
  location?: string | null;
  country?: string | null;
  phone?: string | null;
  metadata?: string | null;
  createdAt?: Date | null;
}

const TIER_COLORS: Record<string, string> = {
  basic: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  silver: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  gold: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  platinum: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export default function AgentKYBAdmin() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [rejectTarget, setRejectTarget] = useState<AgentApplication | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: pending, isLoading, refetch } = trpc.agentOnboarding.listPending.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 30_000,
  });

  const approveMutation = trpc.agentOnboarding.approve.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Agent #${(vars as any)?.agentId} approved successfully`);
      utils.agentOnboarding.listPending.invalidate();
    },
    onError: (err) => toast.error(`Approval failed: ${err.message}`),
  });

  const rejectMutation = trpc.agentOnboarding.reject.useMutation({
    onSuccess: () => {
      toast.success("Application rejected");
      setRejectTarget(null);
      setRejectReason("");
      utils.agentOnboarding.listPending.invalidate();
    },
    onError: (err) => toast.error(`Rejection failed: ${err.message}`),
  });

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-center">
          <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground">Admin access required</p>
        </div>
      </div>
    );
  }

  const parseMeta = (meta: string | null | undefined) => {
    try { return meta ? JSON.parse(meta) : {}; } catch { return {}; }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Agent KYB Review
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and approve agent applications pending KYB verification
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                <p className="text-2xl font-bold text-amber-600">{pending?.length ?? "—"}</p>
              </div>
              <Clock className="h-8 w-8 text-amber-500 opacity-70" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Platinum Tier</p>
                <p className="text-2xl font-bold">{pending?.filter((a: any) => a.tier === "platinum").length ?? 0}</p>
              </div>
              <ShieldCheck className="h-8 w-8 text-purple-500 opacity-70" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Gold Tier</p>
                <p className="text-2xl font-bold">{pending?.filter((a: any) => a.tier === "gold").length ?? 0}</p>
              </div>
              <Building2 className="h-8 w-8 text-yellow-500 opacity-70" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-slate-400">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Basic/Silver</p>
                <p className="text-2xl font-bold">{pending?.filter((a: any) => ["basic", "silver"].includes(a.tier)).length ?? 0}</p>
              </div>
              <Users className="h-8 w-8 text-slate-400 opacity-70" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Applications List */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-4">
                <div className="h-5 bg-muted rounded w-1/3 mb-3" />
                <div className="h-3 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !pending || pending.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-60" />
            <p className="text-lg font-medium">All clear — no pending applications</p>
            <p className="text-sm text-muted-foreground mt-1">New agent applications will appear here for review</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {(pending as AgentApplication[]).map((app) => {
            const meta = parseMeta(app.metadata);
            const isExpanded = expandedId === app.id;
            return (
              <Card key={app.id} className="border-l-4 border-l-amber-400">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Building2 className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <CardTitle className="text-base">
                          {app.businessName ?? `Agent #${app.id}`}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{app.agentCode}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[app.tier] ?? TIER_COLORS.basic}`}>
                        {app.tier}
                      </span>
                      <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">pending_kyb</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                    {app.location && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{app.location}</span>
                      </div>
                    )}
                    {app.country && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{app.country}</span>
                      </div>
                    )}
                    {app.phone && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span>{app.phone}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <CreditCard className="h-3.5 w-3.5 shrink-0" />
                      <span>Daily limit: {Number(app.dailyLimit).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Expandable KYB metadata */}
                  {Object.keys(meta).length > 0 && (
                    <div className="mb-4">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : app.id)}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" />
                        {isExpanded ? "Hide KYB details" : "View KYB details"}
                      </button>
                      {isExpanded && (
                        <div className="mt-2 p-3 bg-muted rounded-md text-xs space-y-1.5">
                          {meta.businessType && <div><span className="font-medium">Business Type:</span> {meta.businessType}</div>}
                          {meta.cacNumber && <div><span className="font-medium">CAC Number:</span> {meta.cacNumber}</div>}
                          {meta.tinNumber && <div><span className="font-medium">TIN:</span> {meta.tinNumber}</div>}
                          {meta.bankName && <div><span className="font-medium">Bank:</span> {meta.bankName} — {meta.bankAccountNumber} ({meta.bankAccountName})</div>}
                          {meta.notes && <div><span className="font-medium">Notes:</span> {meta.notes}</div>}
                          {meta.submittedAt && <div className="text-muted-foreground">Submitted: {new Date(meta.submittedAt).toLocaleString()}</div>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => approveMutation.mutate({ agentId: app.id })}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      onClick={() => { setRejectTarget(app); setRejectReason(""); }}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                    <span className="text-xs text-muted-foreground ml-auto">
                      Commission: {app.commissionRate}%
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Agent Application</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Rejecting <strong>{rejectTarget?.businessName ?? `Agent #${rejectTarget?.id}`}</strong> ({rejectTarget?.agentCode}).
              Please provide a reason for the rejection.
            </p>
            <Textarea
              placeholder="e.g. Incomplete KYB documentation — CAC number not verifiable"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 5 || rejectMutation.isPending}
              onClick={() => rejectTarget && rejectMutation.mutate({ agentId: rejectTarget.id, reason: rejectReason })}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
