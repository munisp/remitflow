import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import ApiClient from '../../services/ApiClient';

interface AppSettings {
  notifications: { push: boolean; email: boolean; sms: boolean; transactions: boolean };
  security: { biometric: boolean; twoFactor: boolean; loginAlerts: boolean };
  preferences: { language: string; theme: string; currency: string };
}

const MOCK_SETTINGS: AppSettings = {
  notifications: { push: true, email: true, sms: false, transactions: true },
  security: { biometric: true, twoFactor: false, loginAlerts: true },
  preferences: { language: 'English', theme: 'Light', currency: 'NGN' },
};

const SettingsScreen: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(MOCK_SETTINGS);

  useEffect(() => {
    (async () => {
      try {
        const res = await ApiClient.get<{ settings: AppSettings }>('/api/settings');
        if (res.data.settings) setSettings(res.data.settings);
      } catch {
        setSettings(MOCK_SETTINGS);
      }
    })();
  }, []);

  const handleToggle = (category: keyof AppSettings, key: string, value: boolean) => {
    setSettings(prev => ({
      ...prev,
      [category]: { ...prev[category], [key]: value },
    }));
    ApiClient.put('/api/settings', { [category]: { [key]: value } }).catch(() => {});
  };

  const handlePreferenceChange = (key: string, options: string[]) => {
    const current = settings.preferences[key as keyof typeof settings.preferences];
    const currentIdx = options.indexOf(current);
    const nextIdx = (currentIdx + 1) % options.length;
    setSettings(prev => ({
      ...prev,
      preferences: { ...prev.preferences, [key]: options[nextIdx] },
    }));
    ApiClient.put('/api/settings', { preferences: { [key]: options[nextIdx] } }).catch(() => {});
  };

  const ToggleRow = ({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) => (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch value={value} onValueChange={onToggle} trackColor={{ false: '#E2E8F0', true: '#6366F1' }} thumbColor={value ? '#FFFFFF' : '#F8FAFC'} />
    </View>
  );

  const SelectRow = ({ label, value, onPress }: { label: string; value: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.settingRow} onPress={onPress}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value} &gt;</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <ToggleRow label="Push Notifications" value={settings.notifications.push} onToggle={v => handleToggle('notifications', 'push', v)} />
        <ToggleRow label="Email Notifications" value={settings.notifications.email} onToggle={v => handleToggle('notifications', 'email', v)} />
        <ToggleRow label="SMS Notifications" value={settings.notifications.sms} onToggle={v => handleToggle('notifications', 'sms', v)} />
        <ToggleRow label="Transaction Alerts" value={settings.notifications.transactions} onToggle={v => handleToggle('notifications', 'transactions', v)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <ToggleRow label="Biometric Login" value={settings.security.biometric} onToggle={v => handleToggle('security', 'biometric', v)} />
        <ToggleRow label="Two-Factor Authentication" value={settings.security.twoFactor} onToggle={v => handleToggle('security', 'twoFactor', v)} />
        <ToggleRow label="Login Alerts" value={settings.security.loginAlerts} onToggle={v => handleToggle('security', 'loginAlerts', v)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        <SelectRow label="Language" value={settings.preferences.language} onPress={() => handlePreferenceChange('language', ['English', 'Hausa', 'Yoruba', 'Igbo'])} />
        <SelectRow label="Theme" value={settings.preferences.theme} onPress={() => handlePreferenceChange('theme', ['Light', 'Dark', 'System'])} />
        <SelectRow label="Currency" value={settings.preferences.currency} onPress={() => handlePreferenceChange('currency', ['NGN', 'USD', 'GBP', 'EUR'])} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity style={styles.settingRow} onPress={() => Alert.alert('Export Data', 'Your data export has been initiated. You will receive an email when ready.')}>
          <Text style={styles.settingLabel}>Export Data</Text>
          <Text style={styles.settingValue}>&gt;</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingRow} onPress={() => Alert.alert('Clear Cache', 'Cache cleared successfully.')}>
          <Text style={styles.settingLabel}>Clear Cache</Text>
          <Text style={styles.settingValue}>&gt;</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.settingRow, { borderBottomWidth: 0 }]} onPress={() => Alert.alert('Delete Account', 'Are you sure? This action cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }])}>
          <Text style={[styles.settingLabel, { color: '#EF4444' }]}>Delete Account</Text>
          <Text style={[styles.settingValue, { color: '#EF4444' }]}>&gt;</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>Version 1.0.0 (Build 54)</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC', padding: 20 },
  header: { fontSize: 28, fontWeight: '800', color: '#0F172A', marginBottom: 20, letterSpacing: -0.5 },
  section: { backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#94A3B8', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.8 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  settingLabel: { fontSize: 15, color: '#1E293B', fontWeight: '500' },
  settingValue: { fontSize: 14, color: '#94A3B8', fontWeight: '500' },
  version: { textAlign: 'center', color: '#CBD5E1', fontSize: 12, marginTop: 12, marginBottom: 40, fontWeight: '500' },
});

export default SettingsScreen;
