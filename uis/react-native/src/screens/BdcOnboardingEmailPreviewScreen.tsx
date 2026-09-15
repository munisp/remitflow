import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

/**
 * wave12 fix: this screen previously fetched `/trpc/bdcOnboarding.list`, an
 * endpoint that never existed on the server. The real procedure is
 * `cbnCompliance.getBdcOnboardingEmailPreview` (server/routers/cbnCompliance.ts)
 * which returns { html, subject, previewData }. The app has no webview/HTML
 * renderer dependency (and wave12 forbids new deps), so the HTML body is not
 * rendered natively — we show the subject + structured previewData honestly
 * and say so, instead of fabricating a rendered email.
 */
export const BdcOnboardingEmailPreviewScreen: React.FC = () => {
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } =
    trpc.cbnCompliance.getBdcOnboardingEmailPreview.useQuery(undefined, {
      retry: 2,
      staleTime: 30_000,
    });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error.message ?? 'Failed to load preview'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const previewData = (data?.previewData ?? {}) as Record<string, unknown>;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.header}>BDC Onboarding Email Preview</Text>
        <View style={{ width: 50 }} />
      </View>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" />
        }
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {!data ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No preview data returned.</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Subject</Text>
              <Text style={styles.cardTitle}>{data.subject ?? '—'}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Preview Data (sample values)</Text>
              {Object.entries(previewData).map(([k, v]) => (
                <View key={k} style={styles.row}>
                  <Text style={styles.rowLabel}>
                    {k.replace(/([A-Z])/g, ' $1').trim()}
                  </Text>
                  <Text style={styles.rowValue} numberOfLines={2}>
                    {v === null || v === undefined ? '—' : String(v)}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.noteText}>
                The full HTML email body cannot be rendered in the mobile app
                (no webview dependency). Use the PWA compliance console to view
                the rendered email. Values above are server-generated samples.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F23',
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F0F23',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  back: {
    color: '#6C63FF',
    fontSize: 14,
    width: 50,
  },
  header: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E2E8F0',
    flex: 1,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6C63FF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rowLabel: {
    fontSize: 12,
    color: '#94A3B8',
    flex: 1,
    textTransform: 'capitalize',
  },
  rowValue: {
    fontSize: 12,
    color: '#E2E8F0',
    flex: 2,
    textAlign: 'right',
  },
  noteText: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  retryBtn: {
    backgroundColor: '#6C63FF',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

export default BdcOnboardingEmailPreviewScreen;
