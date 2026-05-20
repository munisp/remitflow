import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, AlertTriangle, CheckCircle, Search } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

type SanctionsList = "OFAC_SDN" | "EU_CONSOLIDATED" | "UN_CONSOLIDATED" | "HMT_OFSI";
type EntityType = "individual" | "company" | "vessel" | "aircraft";

export default function SanctionsScreeningPage() {
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("individual");
  const [result, setResult] = useState<any>(null);
  const [list, setList] = useState<SanctionsList>("OFAC_SDN");

  const screenMutation = trpc.v90.sanctionsScreening.screenEntity.useMutation({
    onSuccess: (d) => {
      setResult(d);
      if (d.result === "hit") toast.error(`SANCTIONS HIT: ${d.matches.length} match(es) found`);
      else toast.success("Clear — no sanctions matches");
    },
    onError: () => toast.error("Screening failed"),
  });
  const { data: sanctionsList } = trpc.v90.sanctionsScreening.getSanctionsList.useQuery({ list, limit: 10 });

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sanctions Screening</h1>
        <p className="text-muted-foreground text-sm">OFAC SDN · EU Consolidated · UN Consolidated · HMT OFSI</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" />Screen Entity</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <label className="text-sm font-medium">Full Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Enter full legal name..." />
            </div>
            <div>
              <label className="text-sm font-medium">Entity Type</label>
              <Select value={entityType} onValueChange={v => setEntityType(v as EntityType)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["individual","company","vessel","aircraft"] as EntityType[]).map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => screenMutation.mutate({ fullName: name, entityType })} disabled={!name || screenMutation.isPending}>
              <Search className="w-4 h-4 mr-2" />{screenMutation.isPending ? "Screening..." : "Screen Now"}
            </Button>
          </div>
          {result && (
            <div className={`mt-4 p-4 rounded-lg border ${result.result === "hit" ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.result === "hit"
                  ? <AlertTriangle className="w-5 h-5 text-red-600" />
                  : <CheckCircle className="w-5 h-5 text-green-600" />}
                <span className="font-bold text-lg">{result.result === "hit" ? "SANCTIONS HIT" : "CLEAR"}</span>
                <Badge className={result.riskLevel === "critical" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}>{result.riskLevel}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Lists checked: {result.listsChecked.join(", ")}</p>
              {result.matches.length > 0 && (
                <div className="mt-3 space-y-2">
                  {result.matches.map((m: any, i: number) => (
                    <div key={i} className="bg-white rounded p-3 border border-red-200">
                      <div className="flex justify-between">
                        <span className="font-medium">{m.list}</span>
                        <Badge>Score: {(m.matchScore * 100).toFixed(0)}%</Badge>
                      </div>
                      <p className="text-sm mt-1">{m.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Sanctions List Browser</CardTitle>
            <Select value={list} onValueChange={v => setList(v as SanctionsList)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["OFAC_SDN","EU_CONSOLIDATED","UN_CONSOLIDATED","HMT_OFSI"] as SanctionsList[]).map(l => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {sanctionsList && (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                Total entries: {sanctionsList.totalEntries.toLocaleString()} · Last updated: {new Date(sanctionsList.lastUpdated).toLocaleDateString()}
              </p>
              <div className="space-y-2">
                {sanctionsList.entries.map(e => (
                  <div key={e.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{e.name}</p>
                      <p className="text-xs text-muted-foreground">{e.reason}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{e.country}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">{e.addedDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
