import React, { useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchSyncHistory, triggerSync } from '../../store/slices/inventorySlice';

export const InventorySyncScreen = () => {
  const dispatch = useAppDispatch();
  const { syncHistory, syncing } = useAppSelector(s => s.inventory);
  
  useEffect(() => { dispatch(fetchSyncHistory()); }, []);
  
  const handleSync = () => {
    dispatch(triggerSync());
  };
  
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.syncButton} onPress={handleSync} disabled={syncing}>
        <Text style={styles.syncButtonText}>{syncing ? 'Syncing...' : 'Sync Now'}</Text>
      </TouchableOpacity>
      <FlatList
        data={syncHistory}
        keyExtractor={i => i.id}
        renderItem={({item}) => (
          <View style={styles.card}>
            <Text style={styles.timestamp}>{new Date(item.timestamp).toLocaleString()}</Text>
            <Text style={styles.status}>{item.status}</Text>
            <Text style={styles.details}>{item.itemsSynced} items synced</Text>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  syncButton: { backgroundColor: '#667eea', padding: 15, margin: 20, borderRadius: 8, alignItems: 'center' },
  syncButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: '#fff', padding: 15, marginHorizontal: 20, marginBottom: 10, borderRadius: 10 },
  timestamp: { fontSize: 14, fontWeight: '600', marginBottom: 5 },
  status: { fontSize: 12, color: '#10b981', marginBottom: 5 },
  details: { fontSize: 12, color: '#666' },
});