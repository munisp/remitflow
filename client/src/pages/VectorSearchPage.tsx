import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Database, Zap, BookOpen, Users } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function VectorSearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"transactions" | "beneficiaries" | "kb">("transactions");
  const [limit, setLimit] = useState("10");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const { data: statusData, isLoading } = trpc.qdrant.status.useQuery();

  const searchTxMutation = trpc.qdrant.searchTransactions.useQuery(
    { query, limit: parseInt(limit) },
    { enabled: false }
  );
  const searchBenefMutation = trpc.qdrant.searchBeneficiaries.useQuery(
    { query, limit: parseInt(limit) },
    { enabled: false }
  );
  const searchKBMutation = trpc.qdrant.searchKnowledgeBase.useQuery(
    { query, limit: parseInt(limit) },
    { enabled: false }
  );

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }
    setSearching(true);
    setResults([]);
    try {
      let data: any[] = [];
      if (searchType === "transactions") {
        const res = await searchTxMutation.refetch();
        data = res.data || [];
      } else if (searchType === "beneficiaries") {
        const res = await searchBenefMutation.refetch();
        data = res.data || [];
      } else {
        const res = await searchKBMutation.refetch();
        data = res.data || [];
      }
      setResults(data);
      toast.success(`Found ${data.length} result${data.length !== 1 ? "s" : ""}`);
    } catch (err: any) {
      toast.error(err.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const collections = statusData?.collections || [];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6 text-blue-500" />
            Vector Search
          </h1>
          <p className="text-muted-foreground mt-1">
            Semantic search powered by Qdrant and Sentence Transformers
          </p>
        </div>
        <Badge variant={statusData?.available ? "default" : "destructive"} className="text-sm px-3 py-1">
          {statusData?.available ? "Qdrant Online" : "Qdrant Offline (Mock Mode)"}
        </Badge>
      </div>

      {/* Collections Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {collections.length > 0 ? collections.map((col: any) => (
          <Card key={col.name} className="border border-blue-100 dark:border-blue-900">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-blue-500" />
                  <span className="font-medium text-sm">{col.name}</span>
                </div>
                <Badge variant="outline">{col.vectorCount.toLocaleString()} vectors</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">dim: {col.vectorDim}</p>
            </CardContent>
          </Card>
        )) : (
          ["transactions", "beneficiaries", "kb_articles"].map((name) => (
            <Card key={name} className="border border-dashed">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm text-muted-foreground">{name}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Not indexed yet</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Search Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Semantic Search
          </CardTitle>
          <CardDescription>
            Search using natural language — embeddings are generated via text-embedding-3-small
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={searchType} onValueChange={(v) => setSearchType(v as any)}>
            <TabsList className="grid grid-cols-3 w-full max-w-md">
              <TabsTrigger value="transactions" className="flex items-center gap-1">
                <Zap className="h-3 w-3" /> Transactions
              </TabsTrigger>
              <TabsTrigger value="beneficiaries" className="flex items-center gap-1">
                <Users className="h-3 w-3" /> Beneficiaries
              </TabsTrigger>
              <TabsTrigger value="kb" className="flex items-center gap-1">
                <BookOpen className="h-3 w-3" /> Knowledge Base
              </TabsTrigger>
            </TabsList>

            <TabsContent value="transactions">
              <p className="text-sm text-muted-foreground">
                Example: "large transfers to Nigeria flagged for review" or "USD to KES high risk"
              </p>
            </TabsContent>
            <TabsContent value="beneficiaries">
              <p className="text-sm text-muted-foreground">
                Example: "John Smith account in Ghana" or "beneficiary with IBAN ending 4521"
              </p>
            </TabsContent>
            <TabsContent value="kb">
              <p className="text-sm text-muted-foreground">
                Example: "how to verify identity" or "AML reporting requirements"
              </p>
            </TabsContent>
          </Tabs>

          <div className="flex gap-3">
            <Input
              placeholder="Enter semantic search query..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {results.length} Result{results.length !== 1 ? "s" : ""} for "{query}"
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {results.map((r: any, i) => (
                <div key={i} className="border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">ID: {r.id}</Badge>
                        <Badge
                          className={`text-xs ${r.score > 0.8 ? "bg-green-500/10 text-green-600" : r.score > 0.5 ? "bg-yellow-500/10 text-yellow-600" : "bg-red-500/10 text-red-600"}`}
                        >
                          Score: {(r.score * 100).toFixed(1)}%
                        </Badge>
                      </div>
                      {r.payload && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                          {Object.entries(r.payload).slice(0, 8).map(([k, v]) => (
                            <div key={k} className="text-xs">
                              <span className="text-muted-foreground">{k}: </span>
                              <span className="font-medium">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {results.length === 0 && !searching && query && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No results found. Try a different query or index some data first.</p>
          </CardContent>
        </Card>
      )}
    </div>
  

    </DashboardLayout>

  );
}
