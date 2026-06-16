import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowRight, User, CreditCard, Users } from "lucide-react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  const timeoutRef = useState<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback((v: string) => {
    if (timeoutRef[0]) clearTimeout(timeoutRef[0]);
    timeoutRef[1](setTimeout(() => setDebounced(v), delay));
  }, [delay]);
  return [debounced, update] as const;
}

export default function GlobalSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useDebounce("", 400);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setDebouncedQuery(v);
  }

  const { data: results, isLoading, isError } = trpc.globalSearch.search.useQuery(
    { query: debouncedQuery, types: ["transactions", "beneficiaries", "users"] },
    { enabled: debouncedQuery.length >= 2 }
  );

  const hasResults = results && (results.transactions.length > 0 || results.beneficiaries.length > 0 || results.users.length > 0);

  return (

    <DashboardLayout>
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Search className="w-6 h-6 text-blue-500" /> Global Search</h1>
        <p className="text-muted-foreground text-sm mt-1">Search across transactions, beneficiaries, and users</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          className="pl-10 h-12 text-base"
          placeholder="Search by reference, name, account number..."
          value={query}
          onChange={handleChange}
          autoFocus
        />
        {isLoading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
      </div>

      {query.length >= 2 && !isLoading && !hasResults && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No results found for "{query}"</CardContent></Card>
      )}

      {hasResults && (
        <div className="space-y-6">
          {/* Transactions */}
          {results.transactions.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <CreditCard className="w-4 h-4" /> Transactions ({results.transactions.length})
              </h2>
              <div className="space-y-2">
                {results.transactions.map((tx: any) => (
                  <Card key={tx.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{tx.reference ?? `TX #${tx.id}`}</span>
                            <Badge variant="outline" className="text-xs capitalize">{tx.status}</Badge>
                            <Badge variant="secondary" className="text-xs capitalize">{tx.type}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {tx.recipientName && <span>{tx.recipientName} · </span>}
                            {tx.fromAmount} {tx.fromCurrency} {tx.toCurrency && `→ ${tx.toCurrency}`} · {new Date(tx.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Beneficiaries */}
          {results.beneficiaries.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <User className="w-4 h-4" /> Beneficiaries ({results.beneficiaries.length})
              </h2>
              <div className="space-y-2">
                {results.beneficiaries.map((b: any) => (
                  <Card key={b.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">{b.name?.[0]?.toUpperCase()}</div>
                        <div>
                          <p className="font-medium text-sm">{b.name}</p>
                          <p className="text-xs text-muted-foreground">{b.bankName} · {b.accountNumber} · {b.currency}</p>
                        </div>
                        {b.isFavorite && <Badge className="ml-auto text-xs bg-yellow-100 text-yellow-700">⭐ Favorite</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Users (admin only) */}
          {results.users.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Users className="w-4 h-4" /> Users ({results.users.length})
              </h2>
              <div className="space-y-2">
                {results.users.map((u: any) => (
                  <Card key={u.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-sm font-semibold text-purple-700">{u.name?.[0]?.toUpperCase() ?? "?"}</div>
                        <div>
                          <p className="font-medium text-sm">{u.name ?? "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{u.email} · KYC: {u.kycTier}</p>
                        </div>
                        <Badge className={`ml-auto text-xs ${u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>{u.role}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {query.length < 2 && (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">Start typing to search</p>
          <p className="text-sm mt-1">Search by transaction reference, recipient name, account number, or user email</p>
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
