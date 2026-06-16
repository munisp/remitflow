/**
 * PageSkeleton — reusable skeleton loading patterns for different page types.
 * Shows content-shaped placeholders instead of blank screens.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Skeleton for a page with a header card + list items */
export function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      {/* Search bar */}
      <Skeleton className="h-10 w-full rounded-lg" />
      {/* List items */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3 flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for a dashboard / overview page with cards */
export function DashboardPageSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-in fade-in duration-300">
      {/* Balance card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-40" />
          <div className="flex gap-3">
            <Skeleton className="h-9 flex-1 rounded-lg" />
            <Skeleton className="h-9 flex-1 rounded-lg" />
            <Skeleton className="h-9 flex-1 rounded-lg" />
          </div>
        </CardContent>
      </Card>
      {/* Quick send */}
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2 min-w-[64px]">
            <Skeleton className="w-14 h-14 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
      {/* Recent transactions */}
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Skeleton for detail / form pages */
export function DetailPageSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <Card>
        <CardContent className="p-4 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-10 w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

/** Skeleton for chart / analytics pages */
export function ChartPageSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-48 w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}
