import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  isOffline?: boolean;
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Please try again.",
  onRetry,
  className,
  isOffline,
}: ErrorStateProps) {
  const Icon = isOffline ? WifiOff : AlertCircle;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className
      )}
      role="alert"
    >
      <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">
        {isOffline ? "You're offline" : title}
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-4">
        {isOffline
          ? "Check your internet connection and try again."
          : description}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          onClick={onRetry}
          className="gap-2 active:scale-95 transition-transform"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  );
}
