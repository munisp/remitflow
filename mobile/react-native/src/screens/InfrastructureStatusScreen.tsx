/**
 * RemitFlow — React Native Infrastructure Status Screen
 * Live health of the platform's infrastructure components, consuming the
 * same health contracts as the PWA Platform Status dashboard.
 * Auto-refreshes every 30s and supports pull-to-refresh.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  ComponentStatus,
  PlatformComponent,
  PlatformHealthSnapshot,
  getPlatformHealthSnapshot,
} from "../services/healthService";

const REFRESH_INTERVAL_MS = 30_000;

const STATUS_COLORS: Record<ComponentStatus, string> = {
  healthy: "#10b981",
  degraded: "#f59e0b",
  down: "#ef4444",
  unreachable: "#94a3b8",
};

const STATUS_LABELS: Record<ComponentStatus, string> = {
  healthy: "Operational",
  degraded: "Degraded",
  down: "Down",
  unreachable: "No signal",
};

const OVERALL_HEADLINES: Record<ComponentStatus, string> = {
  healthy: "All systems operational",
  degraded: "Some systems are degraded",
  down: "Platform disruption detected",
  unreachable: "Status unavailable",
};

function formatLatency(latencyMs?: number): string | null {
  if (latencyMs === undefined || latencyMs === null) return null;
  if (latencyMs < 1000) return `${Math.round(latencyMs)} ms`;
  return `${(latencyMs / 1000).toFixed(2)} s`;
}

function ComponentRow({ component }: { component: PlatformComponent }) {
  const latency = formatLatency(component.latencyMs);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[styles.statusDot, { backgroundColor: STATUS_COLORS[component.status] }]}
        />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {component.name}
        </Text>
        {component.critical && (
          <View style={styles.criticalBadge}>
            <Text style={styles.criticalBadgeText}>CRITICAL</Text>
          </View>
        )}
        <Text style={[styles.statusLabel, { color: STATUS_COLORS[component.status] }]}>
          {STATUS_LABELS[component.status]}
        </Text>
      </View>
      <Text style={styles.cardDescription}>{component.description}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.cardDetail} numberOfLines={1}>
          {component.detail ??
            (component.status === "unreachable" ? "No public health signal" : component.source)}
        </Text>
        {latency && <Text style={styles.cardLatency}>{latency}</Text>}
      </View>
    </View>
  );
}

export function InfrastructureStatusScreen() {
  const [snapshot, setSnapshot] = useState<PlatformHealthSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await getPlatformHealthSnapshot();
      if (!mountedRef.current) return;
      setSnapshot(result);
      setError(null);
    } catch (err) {
      // getPlatformHealthSnapshot is designed not to throw; if it ever
      // does, surface it instead of showing stale success.
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load platform status.");
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  const overall = snapshot?.overall ?? "unreachable";
  const healthyCount = snapshot?.components.filter((c) => c.status === "healthy").length ?? 0;
  const totalCount = snapshot?.components.length ?? 0;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
      }
    >
      <Text style={styles.title}>Platform Status</Text>
      <Text style={styles.subtitle}>
        Live health of the RemitFlow infrastructure. Auto-refreshes every 30s.
      </Text>

      {error && (
        <View style={[styles.banner, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
          <Text style={[styles.bannerText, { color: "#b91c1c" }]}>{error}</Text>
        </View>
      )}

      <View
        style={[
          styles.banner,
          {
            backgroundColor: `${STATUS_COLORS[overall]}1a`,
            borderColor: `${STATUS_COLORS[overall]}55`,
          },
        ]}
      >
        <Text style={[styles.bannerHeadline, { color: STATUS_COLORS[overall] }]}>
          {OVERALL_HEADLINES[overall]}
        </Text>
        <Text style={styles.bannerText}>
          {healthyCount} of {totalCount} components healthy
          {snapshot?.api.version ? ` · API v${snapshot.api.version}` : ""}
          {snapshot?.api.latencyMs !== undefined
            ? ` · ${formatLatency(snapshot.api.latencyMs)}`
            : ""}
        </Text>
      </View>

      {snapshot?.notes.map((note) => (
        <Text key={note} style={styles.note}>
          {note}
        </Text>
      ))}

      {snapshot?.components.map((component) => (
        <ComponentRow key={component.id} component={component} />
      ))}

      {!snapshot && !error && (
        <Text style={styles.note}>Checking platform status…</Text>
      )}

      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => void refresh()}
        disabled={refreshing}
      >
        <Text style={styles.refreshButtonText}>
          {refreshing ? "Refreshing…" : "Refresh now"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4, marginBottom: 16 },
  banner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  bannerHeadline: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  bannerText: { fontSize: 12, color: "#475569" },
  note: { fontSize: 11, color: "#94a3b8", marginBottom: 8 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#0f172a", flexShrink: 1 },
  criticalBadge: {
    backgroundColor: "#f1f5f9",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 6,
  },
  criticalBadgeText: { fontSize: 9, fontWeight: "600", color: "#64748b" },
  statusLabel: { fontSize: 12, fontWeight: "600", marginLeft: "auto" },
  cardDescription: { fontSize: 12, color: "#64748b", marginTop: 4 },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  cardDetail: { fontSize: 11, color: "#94a3b8", flexShrink: 1, paddingRight: 8 },
  cardLatency: { fontSize: 11, fontWeight: "600", color: "#475569" },
  refreshButton: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 24,
  },
  refreshButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
});

export default InfrastructureStatusScreen;
