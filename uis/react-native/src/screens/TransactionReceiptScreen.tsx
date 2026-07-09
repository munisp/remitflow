/**
 * TransactionReceiptScreen — React Native
 * Displays a formatted receipt for a completed transaction.
 * Can be opened from TransactionHistoryScreen or via deep link.
 * Mirrors the PWA TransactionReceipt.tsx feature.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Share,
  Alert,
  ActivityIndicator,
} from "react-native";
import { ApiService } from "../services/trpc";

interface Transaction {
  id: number;
  referenceNumber: string;
  fromAmount: string;
  fromCurrency: string;
  toAmount: string;
  toCurrency: string;
  fxRate: string;
  fee: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  recipientName: string | null;
  recipientAccount: string | null;
  paymentRail: string | null;
  description: string | null;
}

interface Props {
  route?: { params?: { transactionId?: number } };
  transactionId?: number;
}

export default function TransactionReceiptScreen({ route, transactionId: propId }: Props) {
  const txId = propId || route?.params?.transactionId;
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txId) {
      setError("No transaction ID provided");
      setLoading(false);
      return;
    }
    loadTransaction();
  }, [txId]);

  const loadTransaction = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ApiService.get(`/api/trpc/transactions.getById?input=${JSON.stringify({ id: txId })}`);
      setTransaction(data.result?.data);
    } catch (err: any) {
      setError(err.message || "Failed to load transaction");
    } finally {
      setLoading(false);
    }
  }, [txId]);

  const handleShare = useCallback(async () => {
    if (!transaction) return;
    const text = [
      "RemitFlow Transaction Receipt",
      "─────────────────────────",
      `Reference: ${transaction.referenceNumber}`,
      `Date: ${new Date(transaction.createdAt).toLocaleString()}`,
      `Amount Sent: ${transaction.fromCurrency} ${transaction.fromAmount}`,
      `Amount Received: ${transaction.toCurrency} ${transaction.toAmount}`,
      `Exchange Rate: 1 ${transaction.fromCurrency} = ${transaction.fxRate} ${transaction.toCurrency}`,
      `Fee: ${transaction.fromCurrency} ${transaction.fee}`,
      `Status: ${transaction.status.toUpperCase()}`,
      transaction.recipientName ? `Recipient: ${transaction.recipientName}` : null,
    ].filter(Boolean).join("\n");

    try {
      await Share.share({ message: text, title: "Transaction Receipt" });
    } catch (_) {}
  }, [transaction]);

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "#4ade80";
      case "pending": return "#fbbf24";
      case "failed": return "#f87171";
      case "cancelled": return "#94a3b8";
      default: return "#94a3b8";
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading receipt...</Text>
      </View>
    );
  }

  if (error || !transaction) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error || "Transaction not found"}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadTransaction}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.statusDot, { backgroundColor: statusColor(transaction.status) }]} />
        <Text style={styles.statusLabel}>{transaction.status.toUpperCase()}</Text>
        <Text style={styles.amount}>
          {transaction.fromCurrency} {transaction.fromAmount}
        </Text>
        <Text style={styles.amountSubtitle}>
          → {transaction.toCurrency} {transaction.toAmount}
        </Text>
      </View>

      {/* Receipt Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Transaction Details</Text>

        <ReceiptRow label="Reference" value={transaction.referenceNumber} mono />
        <ReceiptRow label="Date" value={new Date(transaction.createdAt).toLocaleString()} />
        {transaction.completedAt && (
          <ReceiptRow label="Completed" value={new Date(transaction.completedAt).toLocaleString()} />
        )}
        <ReceiptRow label="You Sent" value={`${transaction.fromCurrency} ${transaction.fromAmount}`} />
        <ReceiptRow label="They Receive" value={`${transaction.toCurrency} ${transaction.toAmount}`} highlight />
        <ReceiptRow
          label="Exchange Rate"
          value={`1 ${transaction.fromCurrency} = ${transaction.fxRate} ${transaction.toCurrency}`}
        />
        <ReceiptRow label="Transfer Fee" value={`${transaction.fromCurrency} ${transaction.fee}`} />

        {transaction.recipientName && (
          <ReceiptRow label="Recipient" value={transaction.recipientName} />
        )}
        {transaction.recipientAccount && (
          <ReceiptRow label="Account" value={transaction.recipientAccount} mono />
        )}
        {transaction.paymentRail && (
          <ReceiptRow label="Payment Rail" value={transaction.paymentRail.toUpperCase()} />
        )}
        {transaction.description && (
          <ReceiptRow label="Note" value={transaction.description} />
        )}
      </View>

      {/* Actions */}
      <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
        <Text style={styles.shareButtonText}>Share Receipt</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        RemitFlow · Powered by a regulated payment infrastructure
      </Text>
    </ScrollView>
  );
}

function ReceiptRow({
  label,
  value,
  mono = false,
  highlight = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text
        style={[
          rowStyles.value,
          mono && rowStyles.mono,
          highlight && rowStyles.highlight,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  label: { fontSize: 13, color: "#64748b", flex: 1 },
  value: { fontSize: 13, color: "#cbd5e1", flex: 2, textAlign: "right" },
  mono: { fontFamily: "monospace", fontSize: 12 },
  highlight: { color: "#6366f1", fontWeight: "700", fontSize: 15 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a", padding: 20 },
  loadingText: { color: "#94a3b8", marginTop: 12, fontSize: 15 },
  errorIcon: { fontSize: 40, marginBottom: 12 },
  errorText: { color: "#f87171", fontSize: 15, textAlign: "center", marginBottom: 20 },
  retryButton: { backgroundColor: "#6366f1", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retryButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  header: { alignItems: "center", paddingVertical: 32 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginBottom: 8 },
  statusLabel: { fontSize: 12, fontWeight: "700", color: "#64748b", letterSpacing: 1.5, marginBottom: 16 },
  amount: { fontSize: 36, fontWeight: "800", color: "#f1f5f9", marginBottom: 4 },
  amountSubtitle: { fontSize: 16, color: "#6366f1", fontWeight: "600" },
  card: {
    backgroundColor: "#1e293b", borderRadius: 20, padding: 20,
    marginBottom: 20, borderWidth: 1, borderColor: "#334155",
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#f1f5f9", marginBottom: 16 },
  shareButton: {
    backgroundColor: "#6366f1", borderRadius: 14, padding: 16,
    alignItems: "center", marginBottom: 24,
  },
  shareButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  footer: { textAlign: "center", color: "#334155", fontSize: 12 },
});
