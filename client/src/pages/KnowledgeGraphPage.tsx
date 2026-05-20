import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Network, AlertTriangle, Search, GitBranch, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

export default function KnowledgeGraphPage() {
  const [cypherQuery, setCypherQuery] = useState("MATCH (u:User)-[:SENT]->(t:Transaction) RETURN u.name, count(t) AS txCount ORDER BY txCount DESC LIMIT 10");
  const [fraudUserId, setFraudUserId] = useState("1");
  const [txPathFrom, setTxPathFrom] = useState("1");
  const [txPathTo, setTxPathTo] = useState("2");
  const [queryResult, setQueryResult] = useState<any>(null);
  const [fraudResult, setFraudResult] = useState<any>(null);
  const [pathResult, setPathResult] = useState<any>(null);

  const { data: statusData } = trpc.falkordb.status.useQuery();
  const { data: graphStats } = trpc.falkordb.getCorridorGraph.useQuery({ fromCurrency: "USD" });

  const queryMutation = trpc.falkordb.query.useMutation({
    onSuccess: (data) => {
      setQueryResult(data);
      toast.success("Query executed successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: fraudData, refetch: refetchFraud, isFetching: fraudFetching } = trpc.falkordb.getUserRiskNetwork.useQuery(
    { userId: parseInt(fraudUserId) || 1 },
    { enabled: false }
  );

  const { data: pathData, refetch: refetchPath, isFetching: pathFetching } = trpc.falkordb.getTransactionNetwork.useQuery(
    { transactionId: parseInt(txPathFrom) || 1 },
    { enabled: false }
  );

  const handleFraudDetect = async () => {
    const res = await refetchFraud();
    if (res.data) setFraudResult(res.data);
  };

  const handlePathFind = async () => {
    const res = await refetchPath();
    if (res.data) setPathResult(res.data);
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="h-6 w-6 text-purple-500" />
            Knowledge Graph
          </h1>
          <p className="text-muted-foreground mt-1">
            FalkorDB graph database — entity relationships, fraud rings, transaction paths
          </p>
        </div>
        <Badge variant={statusData?.available ? "default" : "destructive"} className="text-sm px-3 py-1">
          {statusData?.available ? "FalkorDB Online" : "FalkorDB Offline (Mock Mode)"}
        </Badge>
      </div>

      {/* Graph Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Nodes", value: statusData?.stats?.nodeCount ?? "—", icon: Network, color: "text-purple-500" },
          { label: "Edges", value: statusData?.stats?.edgeCount ?? "—", icon: GitBranch, color: "text-blue-500" },
          { label: "User Nodes", value: statusData?.stats?.userCount ?? "—", icon: BarChart3, color: "text-green-500" },
          { label: "Tx Nodes", value: statusData?.stats?.transactionCount ?? "—", icon: BarChart3, color: "text-orange-500" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{String(stat.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="cypher">
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          <TabsTrigger value="cypher">Cypher Query</TabsTrigger>
          <TabsTrigger value="fraud">Fraud Ring Detection</TabsTrigger>
          <TabsTrigger value="path">Transaction Path</TabsTrigger>
        </TabsList>

        {/* Cypher Query */}
        <TabsContent value="cypher">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-purple-500" />
                Cypher Query Interface
              </CardTitle>
              <CardDescription>
                Execute Cypher queries against the FalkorDB knowledge graph
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Cypher Query</label>
                <textarea
                  className="w-full h-28 p-3 rounded-md border bg-background font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  value={cypherQuery}
                  onChange={(e) => setCypherQuery(e.target.value)}
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {[
                  "MATCH (u:User)-[:SENT]->(t:Transaction) RETURN u.name, count(t) AS txCount ORDER BY txCount DESC LIMIT 10",
                  "MATCH (t:Transaction {status: 'flagged'}) RETURN t.reference, t.amount, t.currency LIMIT 20",
                  "MATCH (u:User)-[:SENT]->(t:Transaction)-[:TO]->(b:Beneficiary) WHERE t.amount > 5000 RETURN u.name, b.name, t.amount LIMIT 10",
                ].map((q, i) => (
                  <Button key={i} variant="outline" size="sm" onClick={() => setCypherQuery(q)} className="text-xs">
                    Example {i + 1}
                  </Button>
                ))}
              </div>
              <Button
                onClick={() => queryMutation.mutate({ cypher: cypherQuery })}
                disabled={queryMutation.isPending}
              >
                {queryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Execute Query
              </Button>

              {queryResult && (
                <div className="mt-4 border rounded-lg overflow-auto max-h-80">
                  <pre className="p-4 text-xs font-mono">{JSON.stringify(queryResult, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fraud Ring Detection */}
        <TabsContent value="fraud">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Fraud Ring Detection
              </CardTitle>
              <CardDescription>
                GNN-based analysis to detect coordinated fraud networks around a user
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  placeholder="User ID"
                  value={fraudUserId}
                  onChange={(e) => setFraudUserId(e.target.value)}
                  className="w-40"
                  type="number"
                />
                <Button onClick={handleFraudDetect} disabled={fraudFetching}>
                  {fraudFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
                  Detect Fraud Ring
                </Button>
              </div>

              {fraudResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={fraudResult.riskLevel === "high" ? "destructive" : fraudResult.riskLevel === "medium" ? "secondary" : "default"}>
                      Risk: {fraudResult.riskLevel || "low"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {fraudResult.connectedAccounts?.length || 0} connected accounts found
                    </span>
                  </div>
                  {fraudResult.connectedAccounts?.length > 0 && (
                    <div className="border rounded-lg overflow-auto max-h-60">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="text-left p-2">Account</th>
                            <th className="text-left p-2">Shared Transactions</th>
                            <th className="text-left p-2">Risk Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fraudResult.connectedAccounts.map((acc: any, i: number) => (
                            <tr key={i} className="border-t">
                              <td className="p-2 font-mono text-xs">{acc.accountNumber || acc.id}</td>
                              <td className="p-2">{acc.sharedTransactions}</td>
                              <td className="p-2">
                                <Badge variant={acc.riskScore > 0.7 ? "destructive" : "outline"}>
                                  {(acc.riskScore * 100).toFixed(0)}%
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {fraudResult.explanation && (
                    <p className="text-sm text-muted-foreground border-l-4 border-purple-500 pl-3">
                      {fraudResult.explanation}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transaction Path */}
        <TabsContent value="path">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-blue-500" />
                Transaction Path Analysis
              </CardTitle>
              <CardDescription>
                Find shortest path between users in the transaction network
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Transaction ID:</label>
                  <Input
                    placeholder="TX ID"
                    value={txPathFrom}
                    onChange={(e) => setTxPathFrom(e.target.value)}
                    className="w-32"
                    type="number"
                  />
                </div>
                <Button onClick={handlePathFind} disabled={pathFetching}>
                  {pathFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <GitBranch className="h-4 w-4 mr-2" />}
                  Find Path
                </Button>
              </div>

              {pathResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">Path Length: {pathResult.pathLength}</Badge>
                    <Badge variant={pathResult.available ? "default" : "secondary"}>
                      {pathResult.available ? "Path Found" : "No Path"}
                    </Badge>
                  </div>
                  {pathResult.path?.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {pathResult.path.map((node: string, i: number) => (
                        <div key={i} className="flex items-center gap-1">
                          <Badge variant="outline" className="font-mono text-xs">{node}</Badge>
                          {i < pathResult.path.length - 1 && <span className="text-muted-foreground">→</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
