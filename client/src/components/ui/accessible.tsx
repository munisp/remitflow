/**
 * Accessible UI primitives — WCAG 2.1 AA compliant wrappers.
 * Provides skip-nav, live regions, focus management, and screen reader utilities.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/** Skip-to-content link — visible only on focus */
export function SkipToContent({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:z-[9999] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none"
    >
      Skip to main content
    </a>
  );
}

/** Live region for dynamic announcements (screen readers) */
export function LiveRegion({
  message,
  assertive = false,
}: {
  message: string;
  assertive?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

/** Focus trap for modals/dialogs */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  React.useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    el.addEventListener("keydown", handleTab);
    first?.focus();
    return () => el.removeEventListener("keydown", handleTab);
  }, [ref, active]);
}

/** Visually hidden label for icon-only buttons */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/** Accessible loading skeleton with aria-busy */
export function AccessibleSkeleton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy="true"
      className={cn("animate-pulse bg-muted rounded-md", className)}
    />
  );
}

/** Empty state component with meaningful messaging */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
    >
      {icon && (
        <div className="mb-4 text-muted-foreground opacity-50" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>
      {action}
    </div>
  );
}

/** Keyboard shortcut handler */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
) {
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (modifiers.ctrl && !e.ctrlKey && !e.metaKey) return;
      if (modifiers.shift && !e.shiftKey) return;
      if (modifiers.alt && !e.altKey) return;
      if (e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        callback();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key, callback, modifiers]);
}

/** Announce route changes for screen readers */
export function RouteAnnouncer({ title }: { title: string }) {
  const [announced, setAnnounced] = React.useState("");
  React.useEffect(() => {
    setAnnounced(`Navigated to ${title}`);
    document.title = `${title} — RemitFlow`;
  }, [title]);
  return <LiveRegion message={announced} />;
}
