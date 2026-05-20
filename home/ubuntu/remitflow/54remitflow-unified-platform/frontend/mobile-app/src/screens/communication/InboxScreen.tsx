import React, { useState, useEffect } from 'react';
import { FlatList, Text, View, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { ApiService } from '../../services/ApiService';

export const InboxScreen = ({ navigation }: any) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMessages = async () => {
    try {
      const res = await ApiService.get('/api/v1/chat/sessions');
      setMessages(res.data?.sessions || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchMessages(); }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#667eea" /></View>;

  return (
    <FlatList data={messages} keyExtractor={(item, i) => item.id || i.toString()}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMessages(); }} />}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No messages</Text></View>}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => navigation?.navigate('MessageDetail', { sessionId: item.id })}>
          <Text style={styles.subject}>{item.subject || 'Support Chat'}</Text>
          <Text style={styles.preview} numberOfLines={1}>{item.last_message || 'No messages yet'}</Text>
          <Text style={styles.date}>{item.updated_at ? new Date(item.updated_at).toLocaleDateString() : ''}</Text>
        </TouchableOpacity>
      )}
    />
  );
};

const styles = StyleSheet.create({
  list: { padding: 15 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { color: '#666', fontSize: 15 },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10 },
  subject: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', marginBottom: 4 },
  preview: { fontSize: 13, color: '#666', marginBottom: 4 },
  date: { fontSize: 12, color: '#999' },
});
