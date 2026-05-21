import { ErrorState } from "./ErrorState";
import { ListPageSkeleton, DashboardPageSkeleton, DetailPageSkeleton, ChartPageSkeleton } from "./PageSkeleton";
import { ReactNode, type JSX } from "react";

type SkeletonType = "list" | "dashboard" | "detail" | "chart";

interface QueryWrapperProps {
  isLoading: boolean;
  isError?: boolean;
  error?: { message?: string } | null;
  onRetry?: () => void;
  skeleton?: SkeletonType;
  children: ReactNode;
}

const SKELETON_MAP: Record<SkeletonType, () => JSX.Element> = {
  list: () => <ListPageSkeleton />,
  dashboard: () => <DashboardPageSkeleton />,
  detail: () => <DetailPageSkeleton />,
  chart: () => <ChartPageSkeleton />,
};

export function QueryWrapper({
  isLoading,
  isError,
  error,
  onRetry,
  skeleton = "list",
  children,
}: QueryWrapperProps) {
  if (isLoading) {
    return SKELETON_MAP[skeleton]();
  }
  if (isError) {
    return (
      <ErrorState
        title="Failed to load"
        description={error?.message ?? "An unexpected error occurred."}
        onRetry={onRetry}
        isOffline={!navigator.onLine}
      />
    );
  }
  return <>{children}</>;
}
