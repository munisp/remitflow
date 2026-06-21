/**
 * Insider Threat Controls — React Native Screen
 *
 * Mobile-optimized interface for:
 * - Maker-Checker approval notifications + quick actions
 * - JIT access request (biometric-gated)
 * - Security alerts feed
 * - WebAuthn passkey management (via platform authenticator)
 * - Geo/time fence awareness
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from "react-native";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PendingApproval {
  id: string;
  operationType: string;
  amount: string;
  requestedBy: string;
  riskScore: number;
  timeAgo: string;
  approvalsNeeded: number;
  currentApprovals: number;
}

interface SecurityAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  time: string;
}

interface SecurityKey {
  id: string;
  name: string;
  type: string;
  lastUsed: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = ["Approvals", "JIT Access", "Alerts", "Keys"] as const;
type Tab = (typeof TABS)[number];

// ─── Main Component ──────────────────────────────────────────────────────────

export default function InsiderThreatScreen() {
  const [activeTab, setActiveTab] = useState<Tab>("Approvals");
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Security Controls</Text>
        <Text style={styles.headerSubtitle}>
          Insider threat prevention & monitoring
        </Text>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.activeTabText,
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {activeTab === "Approvals" && <ApprovalsTab />}
        {activeTab === "JIT Access" && <JITAccessTab />}
        {activeTab === "Alerts" && <AlertsTab />}
        {activeTab === "Keys" && <SecurityKeysTab />}
      </ScrollView>
    </View>
  );
}

// ─── Approvals Tab ───────────────────────────────────────────────────────────

function ApprovalsTab() {
  const approvals: PendingApproval[] = [
    {
      id: "mc_001",
      operationType: "Transfer Reversal",
      amount: "$75,000",
      requestedBy: "User #42",
      riskScore: 65,
      timeAgo: "1h ago",
      approvalsNeeded: 2,
      currentApprovals: 1,
    },
    {
      id: "mc_002",
      operationType: "FX Rate Override",
      amount: "USD/NGN → 1550",
      requestedBy: "User #15",
      riskScore: 85,
      timeAgo: "2h ago",
      approvalsNeeded: 2,
      currentApprovals: 0,
    },
  ];

  const handleApprove = (id: string) => {
    Alert.alert(
      "Confirm Approval",
      "This action requires biometric verification. Proceed?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", style: "default", onPress: () => {} },
      ]
    );
  };

  const handleReject = (id: string) => {
    Alert.alert("Reject Request", "Provide a reason for rejection.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reject", style: "destructive", onPress: () => {} },
    ]);
  };

  return (
    <View>
      <InfoBanner
        text="Operations above threshold require approval from a different admin (maker ≠ checker)."
        color="#3B82F6"
      />
      {approvals.map((approval) => (
        <View key={approval.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{approval.operationType}</Text>
            <RiskBadge score={approval.riskScore} />
          </View>
          <Text style={styles.cardAmount}>{approval.amount}</Text>
          <Text style={styles.cardMeta}>
            {approval.requestedBy} • {approval.timeAgo} • Approvals:{" "}
            {approval.currentApprovals}/{approval.approvalsNeeded}
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.approveButton]}
              onPress={() => handleApprove(approval.id)}
            >
              <Text style={styles.buttonText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={() => handleReject(approval.id)}
            >
              <Text style={[styles.buttonText, { color: "#DC2626" }]}>
                Reject
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── JIT Access Tab ──────────────────────────────────────────────────────────

function JITAccessTab() {
  const [selectedPrivilege, setSelectedPrivilege] = useState<string | null>(
    null
  );

  const privileges = [
    { id: "admin_panel", label: "Admin Panel", icon: "⚙️" },
    { id: "bulk_export", label: "Bulk Export", icon: "📊" },
    { id: "user_management", label: "User Management", icon: "👥" },
    { id: "fx_override", label: "FX Override", icon: "💱" },
    { id: "system_config", label: "System Config", icon: "🔧" },
  ];

  return (
    <View>
      <InfoBanner
        text="Request temporary elevated access (max 2 hours, 3 grants per day). All actions are logged."
        color="#7C3AED"
      />
      <Text style={styles.sectionTitle}>Select Privilege</Text>
      {privileges.map((priv) => (
        <TouchableOpacity
          key={priv.id}
          style={[
            styles.privilegeItem,
            selectedPrivilege === priv.id && styles.privilegeSelected,
          ]}
          onPress={() => setSelectedPrivilege(priv.id)}
        >
          <Text style={styles.privilegeIcon}>{priv.icon}</Text>
          <Text style={styles.privilegeLabel}>{priv.label}</Text>
          {selectedPrivilege === priv.id && (
            <Text style={styles.checkmark}>✓</Text>
          )}
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={[
          styles.requestButton,
          !selectedPrivilege && styles.requestButtonDisabled,
        ]}
        disabled={!selectedPrivilege}
        onPress={() =>
          Alert.alert(
            "JIT Access",
            "Requesting elevated access requires biometric verification."
          )
        }
      >
        <Text style={styles.requestButtonText}>
          Request Access (Biometric Required)
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Alerts Tab ──────────────────────────────────────────────────────────────

function AlertsTab() {
  const alerts: SecurityAlert[] = [
    {
      id: "1",
      severity: "warning",
      title: "DLP Block: Bulk PII Access",
      detail: "User #23 attempted 500 records from users table",
      time: "10m ago",
    },
    {
      id: "2",
      severity: "info",
      title: "Admin Anomaly Detected",
      detail: "User #8: 15 bulk queries/hour (baseline: 2)",
      time: "25m ago",
    },
  ];

  const canaryTables = [
    "users",
    "wallets",
    "transactions",
    "kyc_documents",
    "agent_network",
  ];

  return (
    <View>
      <InfoBanner
        text="Monitors for canary token trips, DLP violations, and anomalous admin behavior."
        color="#F59E0B"
      />
      {alerts.map((alert) => (
        <View key={alert.id} style={styles.alertCard}>
          <View style={styles.alertHeader}>
            <SeverityDot severity={alert.severity} />
            <Text style={styles.alertTitle}>{alert.title}</Text>
          </View>
          <Text style={styles.alertDetail}>{alert.detail}</Text>
          <Text style={styles.alertTime}>{alert.time}</Text>
        </View>
      ))}

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>
        Canary Token Status
      </Text>
      {canaryTables.map((table) => (
        <View key={table} style={styles.canaryRow}>
          <View style={styles.canaryDot} />
          <Text style={styles.canaryTable}>{table}</Text>
          <Text style={styles.canaryStatus}>Active • 0 trips</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Security Keys Tab ───────────────────────────────────────────────────────

function SecurityKeysTab() {
  const keys: SecurityKey[] = [
    { id: "1", name: "Platform Biometric", type: "Face ID / Touch ID", lastUsed: "2h ago" },
    { id: "2", name: "YubiKey 5 NFC", type: "USB-A / NFC", lastUsed: "5 days ago" },
  ];

  return (
    <View>
      <InfoBanner
        text="Hardware keys protect against phishing and SIM-swap attacks. Required for high-risk admin operations."
        color="#0D9488"
      />
      {keys.map((key) => (
        <View key={key.id} style={styles.keyCard}>
          <View style={styles.keyIcon}>
            <Text style={{ fontSize: 24 }}>🔑</Text>
          </View>
          <View style={styles.keyInfo}>
            <Text style={styles.keyName}>{key.name}</Text>
            <Text style={styles.keyMeta}>
              {key.type} • Last used: {key.lastUsed}
            </Text>
          </View>
        </View>
      ))}
      <TouchableOpacity style={styles.addKeyButton}>
        <Text style={styles.addKeyButtonText}>+ Register New Key</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function InfoBanner({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.banner, { borderLeftColor: color }]}>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

function RiskBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#DC2626" : score >= 40 ? "#F59E0B" : "#10B981";
  const label = score >= 70 ? "Critical" : score >= 40 ? "High" : "Standard";
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>
        {label} ({score})
      </Text>
    </View>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "critical"
      ? "#DC2626"
      : severity === "warning"
      ? "#F59E0B"
      : "#3B82F6";
  return <View style={[styles.severityDot, { backgroundColor: color }]} />;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: { padding: 20, paddingTop: 60, backgroundColor: "#1F2937" },
  headerTitle: { fontSize: 24, fontWeight: "bold", color: "#FFFFFF" },
  headerSubtitle: { fontSize: 14, color: "#9CA3AF", marginTop: 4 },
  tabBar: { flexDirection: "row", backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  activeTab: { borderBottomWidth: 2, borderBottomColor: "#3B82F6" },
  tabText: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  activeTabText: { color: "#3B82F6" },
  content: { flex: 1, padding: 16 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#1F2937" },
  cardAmount: { fontSize: 14, color: "#374151", marginTop: 8 },
  cardMeta: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  buttonRow: { flexDirection: "row", marginTop: 16, gap: 12 },
  button: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  approveButton: { backgroundColor: "#059669" },
  rejectButton: { backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FECACA" },
  buttonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  banner: { backgroundColor: "#F0F9FF", borderLeftWidth: 4, borderRadius: 8, padding: 12, marginBottom: 16 },
  bannerText: { fontSize: 12, color: "#374151", lineHeight: 18 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#1F2937", marginBottom: 12, marginTop: 8 },
  privilegeItem: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", padding: 14, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  privilegeSelected: { borderColor: "#3B82F6", backgroundColor: "#EFF6FF" },
  privilegeIcon: { fontSize: 20, marginRight: 12 },
  privilegeLabel: { fontSize: 14, color: "#1F2937", flex: 1 },
  checkmark: { color: "#3B82F6", fontWeight: "bold", fontSize: 18 },
  requestButton: { backgroundColor: "#3B82F6", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 16 },
  requestButtonDisabled: { backgroundColor: "#93C5FD" },
  requestButtonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },
  alertCard: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  alertHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertTitle: { fontSize: 14, fontWeight: "600", color: "#1F2937" },
  alertDetail: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  alertTime: { fontSize: 11, color: "#9CA3AF", marginTop: 4 },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  canaryRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  canaryDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981", marginRight: 12 },
  canaryTable: { fontSize: 13, fontFamily: "monospace", color: "#1F2937", flex: 1 },
  canaryStatus: { fontSize: 11, color: "#6B7280" },
  keyCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", padding: 16, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  keyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#E8F5E9", alignItems: "center", justifyContent: "center", marginRight: 14 },
  keyInfo: { flex: 1 },
  keyName: { fontSize: 15, fontWeight: "600", color: "#1F2937" },
  keyMeta: { fontSize: 12, color: "#6B7280", marginTop: 3 },
  addKeyButton: { backgroundColor: "#1F2937", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 16 },
  addKeyButtonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },
});
