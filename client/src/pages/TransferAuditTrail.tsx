import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Search, Clock, User, Cpu, Calendar, Webhook } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-600",
  reversed: "bg-purple-100 text-purple-700",
};

import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';
const TRIGGER_ICONS: Record<string, React.ReactElement> = {
  user: <User className="w-3.5 h-3.5" />,
  system: <Cpu className="w-3.5 h-3.5" />,
  scheduler: <Calendar className="w-3.5 h-3.5" />,
  webhook: <Webhook className="w-3.5 h-3.5" />,
};

export default function TransferAuditTrail() {
  const { t } = useTranslation();
  const [transferId, setTransferId] = useState("");
  const [searchId, setSearchId] = useState<number | null>(null);

  const { data: trail, isLoading, isError } = trpc.transferAudit.getTrail.useQuery(
    { transferId: searchId! },
    { enabled: searchId !== null }
  );

  const logMut = trpc.transferAudit.logTransition.useMutation({
    onSuccess: () => {
      if (searchId) trpc.useUtils().transferAudit.getTrail.invalidate({ transferId: searchId });
    },
  });

  function handleSearch() {
    const id = parseInt(transferId);
    if (!isNaN(id)) setSearchId(id);
  }

  return (

    <DashboardLayout>
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><GitBranch className="w-6 h-6 text-blue-500" /> Transfer Audit Trail</h1>
        <p className="text-muted-foreground text-sm mt-1">View the complete lifecycle state machine for any transfer</p>
      </div>

      <div className="flex gap-3">
        <Input
          className="max-w-xs"
          placeholder="Enter Transfer ID..."
          value={transferId}
          onChange={e => setTransferId(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          type="number"
        />
        <Button onClick={handleSearch} className="gap-2"><Search className="w-4 h-4" /> View Trail</Button>
      </div>

      {isLoading && <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>}

      {searchId && !isLoading && !trail?.length && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No audit trail found for Transfer #{searchId}</CardContent></Card>
      )}

      {trail && trail.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">Transfer #{searchId} — {trail.length} state transitions</h2>
          <div className="relative">
            <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />
            <div className="space-y-4">
              {trail.map((entry: any, idx: any) => (
                <div key={entry.id} className="relative flex gap-4 pl-12">
                  <div className={`absolute left-3.5 w-3 h-3 rounded-full border-2 border-background ${idx === trail.length - 1 ? "bg-primary" : "bg-muted-foreground"}`} style={{ top: "14px" }} />
                  <Card className="flex-1">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.fromStatus && (
                            <>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[entry.fromStatus] ?? "bg-gray-100 text-gray-600"}`}>{entry.fromStatus}</span>
                              <span className="text-muted-foreground text-xs">→</span>
                            </>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[entry.toStatus] ?? "bg-gray-100 text-gray-600"}`}>{entry.toStatus}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">{TRIGGER_ICONS[entry.triggeredBy] ?? <Cpu className="w-3.5 h-3.5" />}{entry.triggeredBy}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      {entry.reason && <p className="text-xs text-muted-foreground mt-1">{entry.reason}</p>}
                      {entry.metadata && (() => { try { const m = JSON.parse(entry.metadata!); return <pre className="text-xs text-muted-foreground mt-1 font-mono bg-muted rounded p-1">{JSON.stringify(m, null, 2)}</pre>; } catch { return null; } })()}
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!searchId && (
        <div className="text-center py-16 text-muted-foreground">
          <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">Enter a Transfer ID</p>
          <p className="text-sm mt-1">View the complete state machine history for any transfer</p>
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
