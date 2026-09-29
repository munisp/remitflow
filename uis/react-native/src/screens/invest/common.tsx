/**
 * wave17 C1 (SPEC-wave17, rn-invest) — shared helpers for the RN investment
 * parity screens (Bonds, Stocks, Real Estate, Startups, Community, Escrow).
 *
 * Mirrors uis/pwa/src/pages/invest/api-b.ts conventions:
 *  - numeric(18,2) money columns arrive on the wire as decimal strings;
 *  - every failure is surfaced verbatim in a dismissible red banner
 *    (fail-closed — no fabricated/placeholder data ever);
 *  - money-moving mutations collect a 6-digit TOTP step-up code
 *    (TotpField) forwarded verbatim as `totpCode` — the server fails closed
 *    with 2FA_REQUIRED when the user is enrolled.
 *
 * All trpc procedure names used by these screens were grep-verified against
 * /mnt/agents/output/audit/routers.json (mounted, non-legacy) and the server
 * routers on bdc-integration. Admin-only procedures are deliberately NOT
 * wired (see per-screen headers).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

// ── Errors ───────────────────────────────────────────────────────────────────

/** Human-readable error from a tRPC/network failure (same rule as PWA api.ts). */
export function investErrMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// ── Formatting (server returns numerics as strings) ──────────────────────────

export function fmtMoney(v: string | number | null | undefined, currency = 'USD'): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function fmtPct(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Fresh idempotency key per order attempt (server bound: max 90 chars). */
export function newIdempotencyKey(): string {
  return `rn-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

// ── Status badges (same grouping as PWA statusBadgeCls / statusTone) ─────────

export function statusBadgeColors(status: string | null | undefined): { bg: string; fg: string } {
  switch (status) {
    case 'active':
    case 'open':
    case 'approved':
    case 'confirmed':
    case 'funded':
    case 'completed':
    case 'verified':
    case 'executed':
      return { bg: 'rgba(16,185,129,0.12)', fg: '#10b981' };
    case 'pending':
    case 'pending_acquisition':
    case 'pending_payment':
    case 'pending_broker':
    case 'draft':
    case 'voting':
    case 'scheduled':
    case 'submitted':
    case 'evidence_submitted':
      return { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' };
    case 'rejected':
    case 'cancelled':
    case 'defaulted':
    case 'failed':
      return { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444' };
    case 'disputed':
      return { bg: 'rgba(249,115,22,0.12)', fg: '#f97316' };
    case 'refunded':
      return { bg: 'rgba(14,165,233,0.12)', fg: '#0ea5e9' };
    default:
      return { bg: 'rgba(156,163,175,0.12)', fg: '#9ca3af' };
  }
}

/** Honest, human label for holding statuses (never decorate server values). */
export function holdingStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending_acquisition':
      return 'pending acquisition — custody not yet confirmed';
    default:
      return status ?? '—';
  }
}

// ── Shared components ────────────────────────────────────────────────────────

/** Dismissible red error banner (fail-closed surfacing; no toast library). */
export function ErrorBanner({ message }: { message: string | null }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
  }, [message]);
  if (!message || hidden) return null;
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
      <TouchableOpacity onPress={() => setHidden(true)} accessibilityLabel="Dismiss error">
        <Text style={styles.errorDismiss}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Green success note (dismissible). */
export function SuccessNote({ message }: { message: string | null }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
  }, [message]);
  if (!message || hidden) return null;
  return (
    <View style={styles.successBanner}>
      <Text style={styles.successText}>{message}</Text>
      <TouchableOpacity onPress={() => setHidden(true)} accessibilityLabel="Dismiss message">
        <Text style={styles.successDismiss}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Status pill. */
export function Badge({ label, color, bg }: { label: string; color?: string; bg?: string }) {
  const c = color ?? '#9ca3af';
  const b = bg ?? 'rgba(156,163,175,0.12)';
  return (
    <View style={[styles.badge, { backgroundColor: b }]}>
      <Text style={[styles.badgeText, { color: c }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { bg, fg } = statusBadgeColors(status);
  return <Badge label={status ?? '—'} color={fg} bg={bg} />;
}

/**
 * TOTP step-up field (RN equivalent of PWA pages/bdc/TotpField.tsx).
 * The 6-digit code is forwarded verbatim as `totpCode`; the server fails
 * closed with 2FA_REQUIRED when the user is enrolled.
 */
export function TotpField({
  value,
  onChange,
  label = '2FA code (required if enrolled)',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        placeholder="6-digit code"
        placeholderTextColor="#6b7280"
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
      />
    </View>
  );
}

/** Labeled text input, shared dark-theme style. */
export function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  numeric,
  hint,
  multiline,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 72, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#6b7280"
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        multiline={multiline}
        maxLength={maxLength}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Inline single-choice selector (chip row) — replaces the PWA <select>. */
export function ChipSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={[styles.chip, value === o.value && styles.chipActive]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[styles.chipText, value === o.value && styles.chipTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Screen header with back button (same pattern as StablecoinScreen). */
export function InvestHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>{'<'} Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 60, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/** Tab bar (same pattern as StablecoinScreen tabs). */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: ReadonlyArray<{ key: T; label: string }>;
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {tabs.map((t) => (
        <TouchableOpacity key={t.key} style={[styles.tab, active === t.key && styles.tabActive]} onPress={() => onChange(t.key)}>
          <Text style={[styles.tabText, active === t.key && styles.tabTextActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Shared styles (dark theme, consistent with existing RN screens) ──────────

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  content: { flex: 1 },
  contentPad: { padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  back: { color: '#6366f1', fontSize: 16, width: 60 },
  title: { color: '#e2e8f0', fontSize: 20, fontWeight: '700' },
  sectionTitle: { color: '#e2e8f0', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  card: { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 14, padding: 14, marginBottom: 12 },
  cardSelected: { borderColor: '#6366f1' },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textMain: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  textBody: { color: '#c7cbe0', fontSize: 13, lineHeight: 19 },
  textMuted: { color: '#9ca3af', fontSize: 12 },
  textDim: { color: '#6b7280', fontSize: 11 },
  label: { color: '#9ca3af', fontSize: 12, marginTop: 4, marginBottom: 4 },
  hint: { color: '#6b7280', fontSize: 11, marginTop: 4 },
  input: { backgroundColor: '#12122a', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 8, padding: 12, color: '#e2e8f0', fontSize: 15 },
  btn: { backgroundColor: '#6366f1', padding: 13, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnSecondary: { backgroundColor: '#2d2d4e', padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnDanger: { backgroundColor: '#b91c1c', padding: 13, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  linkBtn: { paddingVertical: 6 },
  linkText: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '600' },
  errorBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', borderRadius: 10, padding: 12, marginBottom: 10 },
  errorText: { color: '#f87171', fontSize: 13, flex: 1 },
  errorDismiss: { color: '#f87171', fontSize: 14, paddingLeft: 12 },
  successBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16,185,129,0.10)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.35)', borderRadius: 10, padding: 12, marginBottom: 10 },
  successText: { color: '#34d399', fontSize: 13, flex: 1 },
  successDismiss: { color: '#34d399', fontSize: 14, paddingLeft: 12 },
  warnBox: { backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.30)', borderRadius: 10, padding: 12, marginBottom: 12 },
  warnText: { color: '#fbbf24', fontSize: 12, lineHeight: 17 },
  infoBox: { backgroundColor: 'rgba(99,102,241,0.07)', borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)', borderRadius: 10, padding: 12, marginBottom: 12 },
  infoText: { color: '#a5b4fc', fontSize: 12, lineHeight: 17 },
  tabBar: { flexDirection: 'row', backgroundColor: '#1a1a2e', borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  tab: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#6366f1' },
  tabText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#6366f1' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#12122a', borderWidth: 1, borderColor: '#2d2d4e' },
  chipActive: { backgroundColor: 'rgba(99,102,241,0.18)', borderColor: '#6366f1' },
  chipText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#a5b4fc' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#2d2d4e', overflow: 'hidden', marginTop: 6 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#6366f1' },
  divider: { borderTopWidth: 1, borderTopColor: '#2d2d4e', marginVertical: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCell: { backgroundColor: '#12122a', borderWidth: 1, borderColor: '#2d2d4e', borderRadius: 10, padding: 10, minWidth: '30%', flexGrow: 1 },
  statLabel: { color: '#6b7280', fontSize: 11 },
  statValue: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginTop: 3 },
});
