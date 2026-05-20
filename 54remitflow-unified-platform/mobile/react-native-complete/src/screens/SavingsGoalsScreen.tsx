import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { APIClient } from '../api/APIClient';
import { AnalyticsService } from '../services/AnalyticsService';


const apiClient = new APIClient();

export const SavingsGoalsScreen = ({ navigation }: any) => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [goals, setGoals] = useState<any[]>([]);

  useEffect(() => {
    AnalyticsService.trackScreenView('SavingsGoals');
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/trpc/savings.list');
      setGoals(res?.result?.data ?? []);
    } catch (e) {
      AnalyticsService.trackError('savingsgoals_load_failed', e);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    const filtered = goals.filter(g => g.name?.toLowerCase().includes(search.toLowerCase()));
    if (!filtered.length) return <Text style={styles.emptyText}>No savings goals yet. Create your first goal!</Text>;
    return (
      <ScrollView>
        <TouchableOpacity style={[styles.actionBtn, { margin: 16 }]} onPress={() => Alert.alert('Create Goal', 'Use the web app to create savings goals.')}>
          <Text style={styles.actionBtnText}>+ New Savings Goal</Text>
        </TouchableOpacity>
        {filtered.map(goal => {
          const progress = Math.min(((goal.currentAmount ?? 0) / (goal.targetAmount ?? 1)) * 100, 100);
          return (
            <View key={goal.id} style={styles.card}>
              <Text style={styles.cardTitle}>{goal.name}</Text>
              <Text style={styles.cardSubtitle}>{goal.currency ?? 'USD'} {(goal.currentAmount ?? 0).toFixed(2)} of {(goal.targetAmount ?? 0).toFixed(2)}</Text>
              <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${progress}%` as any }]} /></View>
              <Text style={styles.label}>{progress.toFixed(0)}% complete{goal.deadline ? ` · Due ${goal.deadline}` : ''}</Text>
              {goal.autoSave && <View style={[styles.badge, styles.successBadge]}><Text style={styles.badgeText}>⚡ Auto-save</Text></View>}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Savings Goals</Text>
      </View>
      <TextInput
        style={styles.searchInput}
        placeholder="Search..."
        value={search}
        onChangeText={setSearch}
      />
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading Savings Goals...</Text>
        </View>
      ) : renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  backBtn: { marginRight: 12 },
  backText: { color: '#6366f1', fontSize: 14 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', flex: 1 },
  searchInput: { margin: 16, padding: 12, backgroundColor: '#1e1e2e', borderRadius: 8, color: '#fff', fontSize: 14 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', marginTop: 8 },
  card: { margin: 8, marginHorizontal: 16, padding: 16, backgroundColor: '#1e1e2e', borderRadius: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: '#888', marginBottom: 8 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: '#6366f1', marginTop: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  actionBtn: { marginTop: 8, padding: 10, backgroundColor: '#6366f1', borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 40, fontSize: 15 },
  progressBar: { height: 6, backgroundColor: '#2e2e3e', borderRadius: 3, marginVertical: 6 },
  progressFill: { height: 6, backgroundColor: '#6366f1', borderRadius: 3 },
  amount: { fontSize: 22, fontWeight: 'bold', color: '#6366f1' },
  label: { fontSize: 12, color: '#888', marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  dangerBtn: { padding: 10, backgroundColor: '#ef4444', borderRadius: 8, alignItems: 'center', marginTop: 8 },
  successBadge: { backgroundColor: '#22c55e' },
  warningBadge: { backgroundColor: '#f59e0b' },
  dangerBadge: { backgroundColor: '#ef4444' },
});
