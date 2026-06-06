import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function RevenueSharePage() {
  const { user } = useAuth();
  const { data, isLoading } = (trpc as any)?.["revenueShare"]?.["list"]?.useQuery?.() ?? { data: null, isLoading: false };
  const items: any[] = Array.isArray(data) ? data : (data ? [data] : []);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-bold">Revenue Share</h1>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No data available</CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item: any, idx: number) => (
              <Card key={idx}>
                <CardHeader><CardTitle className="text-sm">{item?.title ?? item?.name ?? `Record ${idx + 1}`}</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-muted-foreground">{item?.description ?? item?.status ?? JSON.stringify(item).slice(0, 100)}</p></CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
