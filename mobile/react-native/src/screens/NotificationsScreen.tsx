import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

const TYPE_ICONS: Record<string, string> = {
  transfer: '💸', kyc: '🪪', fx_alert: '📈', payout: '💰',
  security: '🔒', system: 'ℹ️', marketing: '📣',
};

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const { data: notifications, isLoading, refetch } = trpc.notifications.list.useQuery({ limit: 50 });
  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => refetch(),
  });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => refetch(),
  });

  const unreadCount = (notifications ?? []).filter(n => !n.isRead).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={() => markAllReadMutation.mutate()}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={notifications ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.notifItem, !item.isRead && styles.notifItemUnread]}
              onPress={() => !item.isRead && markReadMutation.mutate({ id: item.id })}
            >
              <Text style={styles.notifIcon}>{TYPE_ICONS[item.type] ?? 'ℹ️'}</Text>
              <View style={styles.notifContent}>
                <Text style={styles.notifTitle}>{item.title}</Text>
                <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                <Text style={styles.notifTime}>{new Date(item.createdAt).toLocaleString()}</Text>
              </View>
              {!item.isRead && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyText}>No notifications yet</Text>
            </View>
          }
          onRefresh={refetch}
          refreshing={isLoading}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 56, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  backText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  markAllText: { color: '#6366f1', fontSize: 13, fontWeight: '600' },
  notifItem: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, borderBottomWidth: 1, borderBottomColor: '#2d2d4e' },
  notifItemUnread: { backgroundColor: '#1a1a2e' },
  notifIcon: { fontSize: 24, marginRight: 12, marginTop: 2 },
  notifContent: { flex: 1 },
  notifTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  notifBody: { color: '#9ca3af', fontSize: 13, lineHeight: 18, marginBottom: 4 },
  notifTime: { color: '#6b7280', fontSize: 11 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6366f1', marginTop: 6 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#6b7280', fontSize: 16 },
});
