import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

/**
 * wave12 (SPEC §6.2): customer-facing BDC agent pickup authorizations.
 * Backend: server/routers/bdc/pickup.ts
 *   - bdc.pickup.authorizePickup   (mutation, TOTP step-up, idempotency key)
 *   - bdc.pickup.listAuthorizations (query, customer/status filter)
 *   - bdc.pickup.revokeAuthorization (admin mutation, TOTP step-up)
 *   - bdc.rescreening.getCustomerScreeningStatus (blocked banner)
 *
 * The app has no uuid dependency and wave12 forbids new deps, so the
 * idempotency key uses the same Math.random-based approach as
 * src/services/offlineQueue.ts, shaped as a UUID v4 string.
 */
function generateIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const AGENT_ID_TYPES = ['nin', 'bvn', 'passport', 'drivers_license', 'voters_card'] as const;
const STATUS_FILTERS = ['pending', 'used', 'expired', 'revoked'] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  used: '#10b981',
  expired: '#64748b',
  revoked: '#ef4444',
};

function formatCountdown(expiresAt: unknown, now: number): string {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(String(expiresAt)).getTime();
  if (Number.isNaN(t)) return '—';
  const ms = t - now;
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `expires in ${h}h ${m}m` : `expires in ${m}m`;
}

export default function BdcPickupAuthorizationScreen() {
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);

  // ── create form state ──────────────────────────────────────────────────
  const [customerIdStr, setCustomerIdStr] = useState('');
  const [agentFullName, setAgentFullName] = useState('');
  const [agentIdType, setAgentIdType] = useState<(typeof AGENT_ID_TYPES)[number]>('nin');
  const [agentIdNumber, setAgentIdNumber] = useState('');
  const [relationship, setRelationship] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [expiresInHoursStr, setExpiresInHoursStr] = useState('24');
  const [totpCode, setTotpCode] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(generateIdempotencyKey);

  // ── list state ─────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number] | null>(null);
  const [now, setNow] = useState(Date.now());

  // ── revoke confirm state ───────────────────────────────────────────────
  const [revokeTarget, setRevokeTarget] = useState<number | null>(null);
  const [revokeTotp, setRevokeTotp] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const customerId = useMemo(() => {
    const n = Number(customerIdStr);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }, [customerIdStr]);

  const listInput = useMemo(
    () => ({
      ...(customerId ? { customerId } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      limit: 50,
    }),
    [customerId, statusFilter],
  );

  const { data, isLoading, error, refetch } = trpc.bdc.pickup.listAuthorizations.useQuery(
    listInput,
    { retry: 2, staleTime: 15_000 },
  );

  const screening = trpc.bdc.rescreening.getCustomerScreeningStatus.useQuery(
    { customerId: customerId ?? 0 },
    { enabled: customerId !== undefined, retry: 1, staleTime: 30_000 },
  );

  const authorizeMutation = trpc.bdc.pickup.authorizePickup.useMutation({
    onSuccess: (result) => {
      Alert.alert(
        'Authorization created',
        `Authorization #${result.authorizationId} for ${result.agentFullName} is pending.`,
      );
      setAgentFullName('');
      setAgentIdNumber('');
      setRelationship('');
      setMaxAmount('');
      setTotpCode('');
      setIdempotencyKey(generateIdempotencyKey());
      refetch();
    },
    onError: (e) => Alert.alert('Authorization failed', e.message),
  });

  const revokeMutation = trpc.bdc.pickup.revokeAuthorization.useMutation({
    onSuccess: (result) => {
      Alert.alert('Revoked', `Authorization #${result.authorizationId} has been revoked.`);
      setRevokeTarget(null);
      setRevokeTotp('');
      refetch();
    },
    onError: (e) => Alert.alert('Revoke failed', e.message),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const validate = (): string | null => {
    if (!customerId) return 'Enter a valid customer ID (positive integer).';
    if (agentFullName.trim().length < 2) return 'Agent full name is required (min 2 chars).';
    if (agentIdNumber.trim().length < 4) return 'Agent ID number is required (min 4 chars).';
    if (relationship.trim().length < 2) return 'Relationship is required (min 2 chars).';
    if (maxAmount.trim() && !/^\d+(\.\d{1,2})?$/.test(maxAmount.trim())) {
      return 'Max amount must be a major-unit amount (e.g. 50000 or 50000.00).';
    }
    const hours = Number(expiresInHoursStr);
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
      return 'Expiry must be a whole number of hours between 1 and 72.';
    }
    return null;
  };

  const submit = () => {
    const problem = validate();
    if (problem) {
      Alert.alert('Check the form', problem);
      return;
    }
    authorizeMutation.mutate({
      customerId: customerId as number,
      agentFullName: agentFullName.trim(),
      agentIdType,
      agentIdNumber: agentIdNumber.trim(),
      relationship: relationship.trim(),
      ...(maxAmount.trim() ? { maxAmount: maxAmount.trim() } : {}),
      expiresInHours: Number(expiresInHoursStr),
      idempotencyKey,
      ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
    });
  };

  const confirmRevoke = () => {
    if (revokeTarget === null) return;
    revokeMutation.mutate({
      authorizationId: revokeTarget,
      ...(revokeTotp.trim() ? { totpCode: revokeTotp.trim() } : {}),
    });
  };

  const rows = data?.rows ?? [];
  const screeningBlocked = screening.data?.blocked === true;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Agent Pickup Authorization</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {customerId !== undefined && screeningBlocked && (
          <View style={styles.blockedBanner}>
            <Text style={styles.blockedText}>
              This customer is blocked by rescreening — pickup authorization will be rejected until
              an MLRO review clears them.
            </Text>
          </View>
        )}

        {/* ── create form ─────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Authorize an agent</Text>

          <Text style={styles.label}>Customer ID</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 1234"
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
            value={customerIdStr}
            onChangeText={setCustomerIdStr}
          />

          <Text style={styles.label}>Agent full name</Text>
          <TextInput
            style={styles.input}
            placeholder="Full legal name"
            placeholderTextColor="#64748b"
            value={agentFullName}
            onChangeText={setAgentFullName}
          />

          <Text style={styles.label}>Agent ID type</Text>
          <View style={styles.chipRow}>
            {AGENT_ID_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, agentIdType === t && styles.chipActive]}
                onPress={() => setAgentIdType(t)}
              >
                <Text style={[styles.chipText, agentIdType === t && styles.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Agent ID number</Text>
          <TextInput
            style={styles.input}
            placeholder="ID number (stored encrypted)"
            placeholderTextColor="#64748b"
            value={agentIdNumber}
            onChangeText={setAgentIdNumber}
          />

          <Text style={styles.label}>Relationship</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. spouse, sibling, employee"
            placeholderTextColor="#64748b"
            value={relationship}
            onChangeText={setRelationship}
          />

          <Text style={styles.label}>Max amount (optional, major units)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 50000.00"
            placeholderTextColor="#64748b"
            keyboardType="decimal-pad"
            value={maxAmount}
            onChangeText={setMaxAmount}
          />

          <Text style={styles.label}>Expires in hours (1–72)</Text>
          <TextInput
            style={styles.input}
            placeholder="24"
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
            value={expiresInHoursStr}
            onChangeText={setExpiresInHoursStr}
          />

          <Text style={styles.label}>TOTP code (step-up)</Text>
          <TextInput
            style={styles.input}
            placeholder="6-digit authenticator code"
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
            value={totpCode}
            onChangeText={setTotpCode}
            maxLength={8}
          />

          <TouchableOpacity
            style={[styles.primaryButton, authorizeMutation.isPending && styles.buttonDisabled]}
            onPress={submit}
            disabled={authorizeMutation.isPending}
          >
            {authorizeMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Authorize pickup</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── my authorizations ───────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>My authorizations</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, statusFilter === null && styles.chipActive]}
              onPress={() => setStatusFilter(null)}
            >
              <Text style={[styles.chipText, statusFilter === null && styles.chipTextActive]}>all</Text>
            </TouchableOpacity>
            {STATUS_FILTERS.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, statusFilter === s && styles.chipActive]}
                onPress={() => setStatusFilter(statusFilter === s ? null : s)}
              >
                <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {isLoading ? (
            <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 24 }} />
          ) : error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Failed to load authorizations.</Text>
              <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={styles.emptyText}>
                {statusFilter ? `No ${statusFilter} authorizations.` : 'No pickup authorizations yet.'}
              </Text>
            </View>
          ) : (
            rows.map((row: any) => (
              <View key={row.id} style={styles.authCard}>
                <View style={styles.authHeader}>
                  <Text style={styles.authName}>{row.agentFullName}</Text>
                  <View style={[styles.badge, { backgroundColor: STATUS_COLORS[row.status] ?? '#64748b' }]}>
                    <Text style={styles.badgeText}>{row.status}</Text>
                  </View>
                </View>
                <Text style={styles.authMeta}>
                  {row.agentIdType} · {row.relationship}
                  {row.maxAmount ? ` · max ${row.maxAmount}` : ''}
                </Text>
                <Text style={styles.authMeta}>
                  {row.status === 'pending'
                    ? formatCountdown(row.expiresAt, now)
                    : row.status === 'used' && row.usedAt
                      ? `used ${new Date(row.usedAt).toLocaleString()}`
                      : `created ${new Date(row.createdAt).toLocaleString()}`}
                </Text>
                {row.status === 'pending' && (
                  <TouchableOpacity
                    style={styles.revokeButton}
                    onPress={() => {
                      setRevokeTotp('');
                      setRevokeTarget(row.id);
                    }}
                  >
                    <Text style={styles.revokeButtonText}>Revoke</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* ── revoke TOTP confirm dialog ────────────────────────────── */}
      <Modal visible={revokeTarget !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Revoke authorization #{revokeTarget}</Text>
            <Text style={styles.modalText}>
              This permanently revokes the agent's ability to collect cash. Enter your TOTP code to
              confirm.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="6-digit authenticator code"
              placeholderTextColor="#64748b"
              keyboardType="number-pad"
              value={revokeTotp}
              onChangeText={setRevokeTotp}
              maxLength={8}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setRevokeTarget(null);
                  setRevokeTotp('');
                }}
                disabled={revokeMutation.isPending}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dangerButton, revokeMutation.isPending && styles.buttonDisabled]}
                onPress={confirmRevoke}
                disabled={revokeMutation.isPending}
              >
                {revokeMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.dangerButtonText}>Revoke</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  title: { fontSize: 16, fontWeight: '700', color: '#f1f5f9', flex: 1, textAlign: 'center' },
  back: { color: '#6366f1', fontSize: 14, width: 50 },
  content: { flex: 1, padding: 12 },
  blockedBanner: { backgroundColor: '#7f1d1d', borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#ef4444' },
  blockedText: { color: '#fecaca', fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#f1f5f9', marginBottom: 10 },
  label: { fontSize: 12, color: '#94a3b8', marginBottom: 4, marginTop: 8 },
  input: { backgroundColor: '#0f172a', borderRadius: 8, padding: 10, color: '#f1f5f9', fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a' },
  chipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipText: { fontSize: 12, color: '#94a3b8' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  primaryButton: { backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.6 },
  authCard: { backgroundColor: '#0f172a', borderRadius: 8, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#334155' },
  authHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  authName: { fontSize: 14, fontWeight: '600', color: '#f1f5f9', flex: 1 },
  badge: { borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  authMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  revokeButton: { marginTop: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#ef4444', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  revokeButtonText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
  errorContainer: { alignItems: 'center', marginTop: 24 },
  errorText: { color: '#ef4444', fontSize: 14, marginBottom: 12 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyContainer: { alignItems: 'center', marginTop: 32 },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyText: { color: '#64748b', fontSize: 14, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#334155' },
  modalTitle: { fontSize: 15, fontWeight: '700', color: '#f1f5f9', marginBottom: 8 },
  modalText: { fontSize: 13, color: '#94a3b8', lineHeight: 18, marginBottom: 12 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  cancelButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, borderWidth: 1, borderColor: '#334155' },
  cancelButtonText: { color: '#94a3b8', fontWeight: '600' },
  dangerButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#ef4444' },
  dangerButtonText: { color: '#fff', fontWeight: '700' },
});
