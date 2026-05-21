import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Zap, AlertTriangle, TrendingUp, ArrowRight, Info } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslation } from 'react-i18next';

function SimilarityScore({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "text-red-600 bg-red-50" : pct >= 60 ? "text-orange-600 bg-orange-50" : "text-green-600 bg-green-50";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      <TrendingUp className="w-3 h-3" />
      {pct}% similar
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SimilarTransactionsPage() {
  const { t } = useTranslation();
  const [txId, setTxId] = useState("");
  const [searchedId, setSearchedId] = useState<number | null>(null);

  const { data: recentTxs } = trpc.transactions.list.useQuery({ limit: 10 });

  const {
    data: similarData,
    isLoading,
    isFetching,
    error,
  } = trpc.qdrant.findSimilarTransactions.useQuery(
    { transactionId: searchedId! },
    {
      enabled: searchedId !== null,
      retry: 1,
    }
  );

  const handleSearch = () => {
    const id = parseInt(txId);
    if (!id || id <= 0) {
      toast.error("Please enter a valid transaction ID");
      return;
    }
    setSearchedId(id);
  };

  const handleSelectTx = (id: number) => {
    setTxId(String(id));
    setSearchedId(id);
  };

  const similar = Array.isArray(similarData) ? similarData : [];
  const loading = isLoading || isFetching;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="w-6 h-6 text-teal-500" />
              Transaction Similarity Viewer
            </h1>
            <p className="text-muted-foreground">
              Enter a transaction ID to find semantically similar transactions using Qdrant vector search
            </p>
          </div>
          <Badge variant="outline" className="text-sm px-3 py-1">Qdrant Powered</Badge>
        </div>

        {/* Search */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" /> Find Similar Transactions
            </CardTitle>
            <CardDescription>
              Uses cosine similarity on transaction embeddings (amount, currency, destination, risk score)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input
                type="number"
                placeholder="Transaction ID (e.g. 42)"
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="max-w-xs"
                min="1"
              />
              <Button onClick={handleSearch} disabled={loading || !txId}>
                {loading ? (
                  <><Zap className="w-4 h-4 mr-2 animate-pulse" /> Searching...</>
                ) : (
                  <><Search className="w-4 h-4 mr-2" /> Find Similar</>
                )}
              </Button>
            </div>

            {/* Quick-select from recent transactions */}
            {recentTxs && recentTxs.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Quick select from your recent transactions:</p>
                <div className="flex flex-wrap gap-2">
                  {recentTxs.slice(0, 8).map((tx: any) => (
                    <button
                      key={tx.id}
                      onClick={() => handleSelectTx(tx.id)}
                      className={`text-xs border rounded-full px-3 py-1 hover:bg-accent transition-colors ${searchedId === tx.id ? "bg-primary text-primary-foreground border-primary" : ""}`}
                    >
                      #{tx.id} — {tx.fromCurrency ?? tx.from_currency} {Number(tx.fromAmount ?? tx.from_amount).toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Loading State */}
        {loading && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Zap className="w-4 h-4 animate-pulse text-teal-500" />
              <span>Querying Qdrant vector database for similar transactions...</span>
            </div>
            <LoadingSkeleton />
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <Card className="border-destructive/50">
            <CardContent className="pt-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">Search failed</p>
                <p className="text-sm text-muted-foreground">{error.message}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {!loading && !error && searchedId !== null && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {similar.length > 0
                  ? `${similar.length} similar transaction${similar.length !== 1 ? "s" : ""} found for TX #${searchedId}`
                  : `No similar transactions found for TX #${searchedId}`}
              </h2>
              {similar.length > 0 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Info className="w-3 h-3" />
                  Sorted by similarity score (highest first)
                </div>
              )}
            </div>

            {similar.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No similar transactions found.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This may mean Qdrant is in mock mode or the transaction has no close matches.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {similar.map((tx: any, i: number) => (
                  <Card key={tx.id ?? i} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">TX #{tx.id ?? tx.transactionId}</span>
                            <Badge variant="outline" className="text-xs capitalize">{tx.status ?? "unknown"}</Badge>
                            {tx.type && <Badge variant="secondary" className="text-xs capitalize">{tx.type}</Badge>}
                            <SimilarityScore score={tx.score ?? tx.similarity ?? 0.5} />
                          </div>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                            <span className="font-medium text-foreground">
                              {tx.fromCurrency ?? tx.from_currency ?? "?"} {Number(tx.fromAmount ?? tx.from_amount ?? 0).toLocaleString()}
                            </span>
                            {(tx.toCurrency ?? tx.to_currency) && (
                              <>
                                <ArrowRight className="w-3 h-3" />
                                <span>{tx.toCurrency ?? tx.to_currency}</span>
                              </>
                            )}
                            {(tx.destinationCountry ?? tx.destination_country) && (
                              <span>→ {tx.destinationCountry ?? tx.destination_country}</span>
                            )}
                          </div>
                          {tx.description && (
                            <p className="text-xs text-muted-foreground">{tx.description}</p>
                          )}
                          {tx.createdAt ?? tx.created_at ? (
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(tx.createdAt ?? tx.created_at), "MMM d, yyyy HH:mm")}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right shrink-0">
                          {tx.riskScore !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              Risk: <span className={`font-medium ${tx.riskScore > 0.7 ? "text-red-600" : tx.riskScore > 0.4 ? "text-orange-500" : "text-green-600"}`}>
                                {(tx.riskScore * 100).toFixed(0)}%
                              </span>
                            </div>
                          )}
                          <button
                            onClick={() => handleSelectTx(tx.id ?? tx.transactionId)}
                            className="text-xs text-primary hover:underline mt-1"
                          >
                            Find similar →
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        {!searchedId && (
          <Card className="bg-muted/30">
            <CardContent className="pt-4">
              <h3 className="font-medium text-sm mb-3">How Transaction Similarity Works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground mb-1">1. Embedding Generation</p>
                  <p>Each transaction is converted into a high-dimensional vector capturing amount, currency pair, destination, risk score, and behavioral patterns.</p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">2. Qdrant Vector Search</p>
                  <p>Qdrant performs approximate nearest-neighbor search using HNSW index for sub-millisecond similarity lookups across millions of transactions.</p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">3. Fraud Pattern Detection</p>
                  <p>High similarity clusters may indicate coordinated fraud, money mule networks, or structuring patterns that rule-based systems miss.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
