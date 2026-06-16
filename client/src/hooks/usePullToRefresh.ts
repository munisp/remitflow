/**
 * usePullToRefresh — native pull-to-refresh for mobile list views.
 * Returns state + a ref to attach to the scrollable container.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { haptics } from "@/lib/haptics";

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  maxPull = 120,
}: PullToRefreshOptions) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (refreshing) return;
      const container = containerRef.current;
      if (!container || container.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      setPulling(true);
    },
    [refreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!pulling || refreshing) return;
      const delta = Math.max(0, e.touches[0].clientY - startY.current);
      const distance = Math.min(delta * 0.5, maxPull);
      setPullDistance(distance);
      if (distance >= threshold) {
        haptics.medium();
      }
    },
    [pulling, refreshing, threshold, maxPull]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!pulling) return;
    setPulling(false);
    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true);
      haptics.medium();
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pulling, pullDistance, threshold, refreshing, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    containerRef,
    pulling,
    refreshing,
    pullDistance,
    isTriggered: pullDistance >= threshold,
  };
}
