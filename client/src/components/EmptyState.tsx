/**
 * EmptyState — consistent empty state pattern for all list/data pages.
 * Shows an icon, title, description, and optional CTA button.
 */
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: "default" | "outline" | "secondary";
  className?: string;
  iconClassName?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionVariant = "default",
  className,
  iconClassName,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className
      )}
      role="status"
    >
      <div
        className={cn(
          "h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4",
          iconClassName
        )}
      >
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-4">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button
          variant={actionVariant}
          onClick={onAction}
          className="active:scale-95 transition-transform"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
