/**
 * RequestMoneyScreen — React Native
 * Generates a payment request link + QR code that can be shared with payers.
 * Mirrors the PWA RequestMoney.tsx feature.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Share,
  Alert,
  ActivityIndicator,
  Clipboard,
} from "react-native";
import { ApiService } from "../services/trpc";

interface PaymentRequest {
  id: number;
  token: string;
  amount: string | null;
  currency: string;
  description: string | null;
  status: string;
  expiresAt: string | null;
  payLink: string;
}

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX"];

export default function RequestMoneyScreen() {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [tab, setTab] = useState<"create" | "list">("create");

  const handleCreate = useCallback(async () => {
    if (!description.trim()) {
      Alert.alert("Validation", "Please enter a description for the request.");
      return;
    }
    setLoading(true);
    try {
      const data = await ApiService.post("/api/trpc/requestMoney.create", {
        amount: amount ? parseFloat(amount) : undefined,
        currency,
        description: description.trim(),
        expiresInHours: 72,
      });
      setCreated(data.result?.data);
      setAmount("");
      setDescription("");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to create payment request");
    } finally {
      setLoading(false);
    }
  }, [amount, currency, description]);

  const loadRequests = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await ApiService.get("/api/trpc/requestMoney.list");
      setRequests(data.result?.data?.items || []);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to load requests");
    } finally {
      setListLoading(false);
    }
  }, []);

  const handleShare = useCallback(async (link: string) => {
    try {
      await Share.share({
        message: `Pay me via RemitFlow: ${link}`,
        url: link,
        title: "Payment Request",
      });
    } catch (_) {}
  }, []);

  const handleCopy = useCallback((link: string) => {
    Clipboard.setString(link);
    Alert.alert("Copied", "Payment link copied to clipboard");
  }, []);

  const handleCancel = useCallback(async (id: number) => {
    Alert.alert("Cancel Request", "Are you sure you want to cancel this payment request?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, Cancel",
        style: "destructive",
        onPress: async () => {
          try {
            await ApiService.post("/api/trpc/requestMoney.cancel", { id });
            setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "cancelled" } : r));
          } catch (err: any) {
            Alert.alert("Error", err.message || "Failed to cancel request");
          }
        },
      },
    ]);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === "create" && styles.activeTab]}
          onPress={() => setTab("create")}
        >
          <Text style={[styles.tabText, tab === "create" && styles.activeTabText]}>
            Create Request
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "list" && styles.activeTab]}
          onPress={() => { setTab("list"); loadRequests(); }}
        >
          <Text style={[styles.tabText, tab === "list" && styles.activeTabText]}>
            My Requests
          </Text>
        </TouchableOpacity>
      </View>

      {tab === "create" ? (
        <View>
          <Text style={styles.sectionTitle}>Request Money</Text>
          <Text style={styles.subtitle}>
            Generate a payment link to share with anyone — they can pay without an account.
          </Text>

          {/* Amount */}
          <Text style={styles.label}>Amount (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Leave blank to accept any amount"
            placeholderTextColor="#9ca3af"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />

          {/* Currency */}
          <Text style={styles.label}>Currency</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyRow}>
            {CURRENCIES.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.currencyChip, currency === c && styles.activeCurrencyChip]}
                onPress={() => setCurrency(c)}
              >
                <Text style={[styles.currencyChipText, currency === c && styles.activeCurrencyChipText]}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Description */}
          <Text style={styles.label}>Description *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="e.g. Monthly rent, Dinner split, School fees"
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={3}
            value={description}
            onChangeText={setDescription}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Generate Payment Link</Text>
            )}
          </TouchableOpacity>

          {/* Created request */}
          {created && (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>✅ Payment Link Created!</Text>
              <Text style={styles.successLink} numberOfLines={2}>{created.payLink}</Text>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleShare(created.payLink)}
                >
                  <Text style={styles.actionButtonText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.copyButton]}
                  onPress={() => handleCopy(created.payLink)}
                >
                  <Text style={styles.actionButtonText}>Copy Link</Text>
                </TouchableOpacity>
              </View>
              {created.amount && (
                <Text style={styles.successMeta}>
                  Amount: {created.currency} {created.amount}
                </Text>
              )}
              <Text style={styles.successMeta}>
                Expires: {created.expiresAt ? new Date(created.expiresAt).toLocaleDateString() : "72 hours"}
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View>
          <Text style={styles.sectionTitle}>My Payment Requests</Text>
          {listLoading ? (
            <ActivityIndicator color="#6366f1" style={styles.loader} />
          ) : requests.length === 0 ? (
            <Text style={styles.emptyText}>No payment requests yet. Create one above!</Text>
          ) : (
            requests.map(req => (
              <View key={req.id} style={styles.requestCard}>
                <View style={styles.requestHeader}>
                  <Text style={styles.requestDescription}>{req.description || "Payment Request"}</Text>
                  <View style={[styles.statusBadge, styles[`status_${req.status}` as keyof typeof styles] as any]}>
                    <Text style={styles.statusText}>{req.status}</Text>
                  </View>
                </View>
                {req.amount && (
                  <Text style={styles.requestAmount}>
                    {req.currency} {req.amount}
                  </Text>
                )}
                {req.expiresAt && (
                  <Text style={styles.requestMeta}>
                    Expires: {new Date(req.expiresAt).toLocaleDateString()}
                  </Text>
                )}
                {req.status === "pending" && (
                  <View style={styles.requestActions}>
                    <TouchableOpacity
                      style={styles.shareSmallBtn}
                      onPress={() => handleShare(req.payLink)}
                    >
                      <Text style={styles.shareSmallBtnText}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.cancelSmallBtn}
                      onPress={() => handleCancel(req.id)}
                    >
                      <Text style={styles.cancelSmallBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 20, paddingBottom: 40 },
  tabBar: { flexDirection: "row", backgroundColor: "#1e293b", borderRadius: 12, marginBottom: 24, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  activeTab: { backgroundColor: "#6366f1" },
  tabText: { color: "#94a3b8", fontWeight: "600", fontSize: 14 },
  activeTabText: { color: "#fff" },
  sectionTitle: { fontSize: 22, fontWeight: "700", color: "#f1f5f9", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#94a3b8", marginBottom: 24, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "600", color: "#cbd5e1", marginBottom: 8, marginTop: 16 },
  input: {
    backgroundColor: "#1e293b", borderRadius: 12, padding: 14,
    color: "#f1f5f9", fontSize: 16, borderWidth: 1, borderColor: "#334155",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  currencyRow: { flexDirection: "row", marginBottom: 8 },
  currencyChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "#1e293b", marginRight: 8, borderWidth: 1, borderColor: "#334155",
  },
  activeCurrencyChip: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
  currencyChipText: { color: "#94a3b8", fontWeight: "600", fontSize: 13 },
  activeCurrencyChipText: { color: "#fff" },
  button: {
    backgroundColor: "#6366f1", borderRadius: 14, padding: 16,
    alignItems: "center", marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  successCard: {
    backgroundColor: "#0f2d1a", borderRadius: 16, padding: 20,
    marginTop: 24, borderWidth: 1, borderColor: "#16a34a",
  },
  successTitle: { fontSize: 16, fontWeight: "700", color: "#4ade80", marginBottom: 12 },
  successLink: { fontSize: 12, color: "#94a3b8", marginBottom: 16, fontFamily: "monospace" },
  actionRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  actionButton: {
    flex: 1, backgroundColor: "#6366f1", borderRadius: 10,
    paddingVertical: 12, alignItems: "center",
  },
  copyButton: { backgroundColor: "#0ea5e9" },
  actionButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  successMeta: { fontSize: 13, color: "#94a3b8", marginTop: 4 },
  loader: { marginTop: 40 },
  emptyText: { color: "#64748b", textAlign: "center", marginTop: 40, fontSize: 15 },
  requestCard: {
    backgroundColor: "#1e293b", borderRadius: 16, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: "#334155",
  },
  requestHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  requestDescription: { fontSize: 15, fontWeight: "600", color: "#f1f5f9", flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  status_pending: { backgroundColor: "#fef3c7" },
  status_paid: { backgroundColor: "#d1fae5" },
  status_expired: { backgroundColor: "#fee2e2" },
  status_cancelled: { backgroundColor: "#f1f5f9" },
  statusText: { fontSize: 11, fontWeight: "700", color: "#1e293b" },
  requestAmount: { fontSize: 18, fontWeight: "700", color: "#6366f1", marginBottom: 4 },
  requestMeta: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  requestActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  shareSmallBtn: {
    flex: 1, backgroundColor: "#6366f1", borderRadius: 8,
    paddingVertical: 8, alignItems: "center",
  },
  shareSmallBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  cancelSmallBtn: {
    flex: 1, backgroundColor: "transparent", borderRadius: 8,
    paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#ef4444",
  },
  cancelSmallBtnText: { color: "#ef4444", fontWeight: "600", fontSize: 13 },
});
