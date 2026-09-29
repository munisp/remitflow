/**
 * SendToCountryScreen — wave14 perf (H1): ONE parameterized screen replacing
 * the 15 near-identical per-country SendTo* screens (1225 lines total, all
 * eagerly bundled at startup).
 *
 * All 15 route names stay registered in RootNavigator and render THIS
 * component, which looks up its per-country config by route name — so
 * existing navigation.navigate('SendToBrazil') style callers are untouched.
 *
 * Three historical variants are preserved:
 *   - 'calculator'   : FX rate + amount converter via trpc.fx.rates (11 screens)
 *   - 'transferList' : searchable transfer list via trpc.transfers.list
 *                      (Benin, Mali, Togo)
 *   - 'legacyList'   : same trpc.transfers.list data, legacy FlatList rendering
 *                      (Niger). wave16: the previous raw fetch('/trpc/sendMoney.list')
 *                      was hostless (unresolvable in RN) AND targeted a namespace
 *                      that does not exist server-side — replaced with the mounted
 *                      transfers.list procedure.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { trpc } from '../services/trpc';

interface CalculatorConfig {
  variant: 'calculator';
  country: string;
  flag: string;
  currency: string;
  subtitle: string;
  /** Exactly one of prefix/suffix is set, matching the deleted screens. */
  convertedPrefix?: string;
  convertedSuffix?: string;
  infoTitle: string;
  infoLines: string[];
}

interface ListConfig {
  variant: 'transferList' | 'legacyList';
  country: string;
}

type CountryConfig = CalculatorConfig | ListConfig;

const GENERIC_INFO_LINES = [
  'Competitive exchange rates',
  'Transfers arrive within minutes',
  'Bank deposits & mobile money supported',
  '24/7 customer support',
];

function calculator(
  country: string,
  flag: string,
  currency: string,
  convertedSuffix: string,
): CalculatorConfig {
  return {
    variant: 'calculator',
    country,
    flag,
    currency,
    subtitle: `Fast, secure transfers to ${country}`,
    convertedSuffix,
    infoTitle: `Why send to ${country}?`,
    infoLines: GENERIC_INFO_LINES,
  };
}

/** Keyed by the REGISTERED ROUTE NAME (RootNavigator Stack.Screen name). */
export const SEND_TO_COUNTRY_CONFIG: Record<string, CountryConfig> = {
  SendToNigeria: calculator('Nigeria', '🇳🇬', 'NGN', 'Naira'),
  SendToGhana: calculator('Ghana', '🇬🇭', 'GHS', 'Cedis'),
  SendToKenya: calculator('Kenya', '🇰🇪', 'KES', 'Shillings'),
  SendToSouthAfrica: calculator('South Africa', '🇿🇦', 'ZAR', 'Rand'),
  SendToTanzania: calculator('Tanzania', '🇹🇿', 'TZS', 'Shillings'),
  SendToUganda: calculator('Uganda', '🇺🇬', 'UGX', 'Shillings'),
  SendToCameroon: calculator('Cameroon', '🇨🇲', 'XAF', 'FCFA'),
  SendToSenegal: calculator('Senegal', '🇸🇳', 'XOF', 'FCFA'),
  SendToChina: {
    variant: 'calculator',
    country: 'China',
    flag: '🇨🇳',
    currency: 'CNY',
    subtitle: 'Fast CIPS transfers to China',
    convertedPrefix: '¥',
    infoTitle: 'Why send to China via CIPS?',
    infoLines: [
      'CIPS settlement in 2-4 hours',
      'Direct to any Chinese bank (ICBC, BOC, CCB)',
      'Alipay & WeChat Pay supported',
      'Up to 70% cheaper than wire transfers',
      'PBoC compliance handled automatically',
    ],
  },
  SendToBrazil: {
    variant: 'calculator',
    country: 'Brazil',
    flag: '🇧🇷',
    currency: 'BRL',
    subtitle: 'Instant PIX transfers to Brazil',
    convertedPrefix: 'R$',
    infoTitle: 'Why send to Brazil via PIX?',
    infoLines: [
      'PIX instant settlement — seconds, not days',
      '24/7 including weekends & holidays',
      'Send to CPF, email, phone, or EVP key',
      'All banks supported (Itaú, Nubank, Bradesco)',
      'Flat fee from $2.99',
    ],
  },
  SendToIndia: {
    variant: 'calculator',
    country: 'India',
    flag: '🇮🇳',
    currency: 'INR',
    subtitle: 'Instant UPI transfers to India',
    convertedPrefix: '₹',
    infoTitle: 'Why send to India via UPI?',
    infoLines: [
      'UPI instant settlement — arrives in seconds',
      'Send to any VPA (name@oksbi, name@paytm)',
      'All major banks (SBI, HDFC, ICICI, Axis)',
      'Paytm, PhonePe, Google Pay supported',
      'Mid-market rates, 0.3-0.5% margin',
    ],
  },
  SendToBenin: { variant: 'transferList', country: 'Benin' },
  SendToTogo: { variant: 'transferList', country: 'Togo' },
  SendToMali: { variant: 'transferList', country: 'Mali' },
  SendToNiger: { variant: 'legacyList', country: 'Niger' },
};

/* ── calculator variant (was: SendToBrazilScreen et al., 11 copies) ──────── */

function CalculatorView({ config }: { config: CalculatorConfig }) {
  const navigation = useNavigation<any>();
  const [amount, setAmount] = useState('');
  // NOTE: the original screens passed `{ onError: () => {} }` here, which
  // react-query v5 removed from useQuery options; it was a silent no-op, so
  // it is simply dropped (query errors remain available via `error`).
  // wave16: fx.getRates does not exist server-side — use the mounted fx.rates
  // (public, USD base) and pick the destination currency entry.
  const { data: rates, isLoading } = trpc.fx.rates.useQuery();
  const rate = rates?.find?.((r: any) => r?.currency === config.currency)?.rate ?? 0;
  const converted = amount ? (parseFloat(amount) * rate).toFixed(2) : '0.00';
  return (
    <ScrollView style={calcStyles.container}>
      <View style={calcStyles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={calcStyles.backBtn}>
          <Text style={calcStyles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={calcStyles.flag}>{config.flag}</Text>
        <Text style={calcStyles.title}>Send to {config.country}</Text>
        <Text style={calcStyles.subtitle}>{config.subtitle}</Text>
      </View>
      <View style={calcStyles.card}>
        <Text style={calcStyles.label}>Exchange Rate</Text>
        {isLoading ? (
          <ActivityIndicator color="#6366f1" />
        ) : (
          <Text style={calcStyles.rate}>
            1 USD = {rate.toFixed(4)} {config.currency}
          </Text>
        )}
      </View>
      <View style={calcStyles.card}>
        <Text style={calcStyles.label}>Amount (USD)</Text>
        <TextInput
          style={calcStyles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor="#64748b"
        />
        <Text style={calcStyles.label}>Recipient Gets ({config.currency})</Text>
        <Text style={calcStyles.converted}>
          {config.convertedPrefix ?? ''}
          {converted}
          {config.convertedSuffix ? ` ${config.convertedSuffix}` : ''}
        </Text>
      </View>
      <TouchableOpacity style={calcStyles.btn} onPress={() => navigation.navigate('SendMoney' as never)}>
        <Text style={calcStyles.btnText}>Continue to Send</Text>
      </TouchableOpacity>
      <View style={calcStyles.infoCard}>
        <Text style={calcStyles.infoTitle}>{config.infoTitle}</Text>
        {config.infoLines.map((line) => (
          <Text key={line} style={calcStyles.infoText}>
            • {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const calcStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 24, alignItems: 'center' },
  backBtn: { alignSelf: 'flex-start', marginBottom: 16 },
  backText: { color: '#6366f1', fontSize: 16 },
  flag: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#94a3b8' },
  card: { backgroundColor: '#1e293b', margin: 16, borderRadius: 12, padding: 16 },
  label: { fontSize: 12, color: '#94a3b8', marginBottom: 4, marginTop: 8 },
  rate: { fontSize: 20, fontWeight: 'bold', color: '#6366f1' },
  input: { backgroundColor: '#0f172a', color: '#fff', borderRadius: 8, padding: 12, fontSize: 18, marginTop: 4 },
  converted: { fontSize: 24, fontWeight: 'bold', color: '#10b981', marginTop: 4 },
  btn: { backgroundColor: '#6366f1', margin: 16, borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  infoCard: { backgroundColor: '#1e293b', margin: 16, borderRadius: 12, padding: 16, marginBottom: 32 },
  infoTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  infoText: { fontSize: 14, color: '#94a3b8', marginBottom: 4 },
});

/* ── transferList variant (was: SendToBenin/Mali/TogoScreen) ─────────────── */

function TransferListView({ config }: { config: ListConfig }) {
  const navigation = useNavigation();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // wave16: transfer.listTransfers is not mounted — transfers.list
  // (posAgentCashFlow router, "user's full transfer history") is the mounted
  // equivalent. Input { limit?, offset?, status? } all default; returns
  // { transfers, total }.
  const { data, isLoading, error, refetch } = trpc.transfers.list.useQuery({}, {
    retry: 2,
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const items: any[] = data?.transfers ?? [];
  const filtered = search
    ? items.filter((item: any) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <View style={listStyles.container}>
      <View style={listStyles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={listStyles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={listStyles.title}>Send to {config.country}</Text>
        <View style={{ width: 50 }} />
      </View>
      <View style={listStyles.searchContainer}>
        <TextInput
          style={listStyles.searchInput}
          placeholder="Search..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <ScrollView
        style={listStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={listStyles.errorContainer}>
            <Text style={listStyles.errorText}>Failed to load Send to {config.country}.</Text>
            <TouchableOpacity onPress={() => refetch()} style={listStyles.retryButton}>
              <Text style={listStyles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filtered.length === 0 ? (
          <View style={listStyles.emptyContainer}>
            <Text style={listStyles.emptyEmoji}>📋</Text>
            <Text style={listStyles.emptyText}>
              {search ? 'No results.' : `No Send to ${config.country} yet.`}
            </Text>
          </View>
        ) : (
          filtered.map((item: any, idx: number) => (
            <View key={item.id ?? idx} style={listStyles.card}>
              {Object.entries(item)
                .filter(([k]) => !['__typename'].includes(k))
                .slice(0, 6)
                .map(([k, v]) => (
                  <View key={k} style={listStyles.row}>
                    <Text style={listStyles.label}>{k.replace(/([A-Z])/g, ' $1').trim()}</Text>
                    <Text style={listStyles.value} numberOfLines={1}>
                      {v === null || v === undefined ? '—' : String(v)}
                    </Text>
                  </View>
                ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const listStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  title: { fontSize: 16, fontWeight: '700', color: '#f1f5f9', flex: 1, textAlign: 'center' },
  back: { color: '#6366f1', fontSize: 14, width: 50 },
  searchContainer: { padding: 12, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  searchInput: { backgroundColor: '#0f172a', borderRadius: 8, padding: 10, color: '#f1f5f9', fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  content: { flex: 1, padding: 12 },
  card: { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 12, color: '#64748b', flex: 1, textTransform: 'capitalize' },
  value: { fontSize: 12, color: '#f1f5f9', flex: 2, textAlign: 'right' },
  errorContainer: { alignItems: 'center', marginTop: 60 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 12 },
  retryButton: { backgroundColor: '#6366f1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#64748b', fontSize: 15, textAlign: 'center' },
});

/* ── legacyList variant (was: SendToNigerScreen) ─────────────────────────── */

interface LegacyItem {
  id: number;
  reference: string;
  status?: string;
  description?: string;
}

// Fixed row geometry for getItemLayout (wave14 perf L1): card padding 16×2
// + one-line title (~22) + one-line status (~20) = 74, plus 12 marginBottom.
const LEGACY_ROW_HEIGHT = 74 + 12;

const LegacyRow = React.memo(function LegacyRow({ item }: { item: LegacyItem }) {
  return (
    <TouchableOpacity style={legacyStyles.card}>
      <Text style={legacyStyles.cardTitle} numberOfLines={1}>
        {item.reference?.toString() ?? item.description ?? `Item ${item.id}`}
      </Text>
      {item.status && (
        <Text style={legacyStyles.cardStatus} numberOfLines={1}>
          {item.status}
        </Text>
      )}
    </TouchableOpacity>
  );
});

function LegacyListView({ config }: { config: ListConfig }) {
  // wave16: replaced the hostless fetch('/trpc/sendMoney.list') — the sendMoney
  // namespace does not exist server-side — with the mounted transfers.list
  // procedure (same user transfer history the screen intends to show).
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading: loading, error: queryError, refetch } = trpc.transfers.list.useQuery({}, {
    retry: 2,
    staleTime: 30_000,
  });
  const items: LegacyItem[] = (data?.transfers ?? []) as LegacyItem[];
  const error = queryError ? (queryError as any).message ?? 'Failed to load data' : null;

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const renderItem = useCallback(
    ({ item }: { item: LegacyItem }) => <LegacyRow item={item} />,
    [],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<LegacyItem> | null | undefined, index: number) => ({
      length: LEGACY_ROW_HEIGHT,
      offset: LEGACY_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  if (loading) {
    return (
      <View style={legacyStyles.center}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={legacyStyles.center}>
        <Text style={legacyStyles.errorText}>{error}</Text>
        <TouchableOpacity style={legacyStyles.retryBtn} onPress={() => load()}>
          <Text style={legacyStyles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={legacyStyles.container}>
      <Text style={legacyStyles.header}>Send to {config.country}</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id?.toString()}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#6C63FF" />
        }
        ListEmptyComponent={
          <View style={legacyStyles.center}>
            <Text style={legacyStyles.emptyText}>No Send to {config.country} data yet</Text>
          </View>
        }
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        removeClippedSubviews
        initialNumToRender={10}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: 80 }}
      />
    </View>
  );
}

const legacyStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F23', padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F0F23' },
  header: { fontSize: 22, fontWeight: '700', color: '#E2E8F0', marginBottom: 16 },
  card: { backgroundColor: '#1A1A2E', borderRadius: 12, padding: 16, marginBottom: 12, height: 74 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#E2E8F0' },
  cardStatus: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  errorText: { color: '#EF4444', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  emptyText: { color: '#94A3B8', fontSize: 14 },
  retryBtn: { backgroundColor: '#6C63FF', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#FFFFFF', fontWeight: '600' },
});

/* ── entry point: resolve config by route name ───────────────────────────── */

export default function SendToCountryScreen() {
  const route = useRoute();
  const config = SEND_TO_COUNTRY_CONFIG[route.name];
  if (!config) {
    // Unreachable: RootNavigator only registers route names present in
    // SEND_TO_COUNTRY_CONFIG. Fail visibly instead of crashing on undefined.
    return (
      <View style={legacyStyles.center}>
        <Text style={legacyStyles.errorText}>Unknown destination: {route.name}</Text>
      </View>
    );
  }
  if (config.variant === 'calculator') return <CalculatorView config={config} />;
  if (config.variant === 'transferList') return <TransferListView config={config} />;
  return <LegacyListView config={config} />;
}
