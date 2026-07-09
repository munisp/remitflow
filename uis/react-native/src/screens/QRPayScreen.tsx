import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Clipboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';
import { DARK } from '../theme/dark';

export default function QRPayScreen() {
  const navigation = useNavigation();
  const [tab, setTab] = useState<'receive' | 'send'>('receive');
  const { data: qrInfo, isLoading } = trpc.qr.info.useQuery();
  const copyLink = () => {
    if (qrInfo?.paymentLink) { Clipboard.setString(qrInfo.paymentLink); Alert.alert('Copied', 'Payment link copied to clipboard'); }
  };
  return (
    <View style={s.container}>
      <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity><Text style={s.title}>QR Pay</Text><View /></View>
      <View style={s.tabs}>
        {(['receive', 'send'] as const).map((t) => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{t === 'receive' ? '📥 Receive' : '📤 Send'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {isLoading ? <ActivityIndicator color={DARK.primary} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={s.content}>
          {tab === 'receive' ? (
            <View style={s.qrCard}>
              <Text style={s.qrPlaceholder}>[ QR Code ]</Text>
              <Text style={s.qrId}>User ID: {qrInfo?.userId ?? '—'}</Text>
              <Text style={s.qrData}>{qrInfo?.qrData ?? '—'}</Text>
              <TouchableOpacity style={s.copyBtn} onPress={copyLink}><Text style={s.copyBtnText}>📋 Copy Payment Link</Text></TouchableOpacity>
              <Text style={s.link}>{qrInfo?.paymentLink ?? '—'}</Text>
            </View>
          ) : (
            <View style={s.sendCard}>
              <Text style={s.sendIcon}>📷</Text>
              <Text style={s.sendTitle}>Scan QR Code</Text>
              <Text style={s.sendSub}>Point your camera at a RemitFlow QR code to pay instantly</Text>
              <TouchableOpacity style={s.scanBtn} onPress={() => Alert.alert('Camera', 'QR scanner requires camera permission on a real device')}><Text style={s.scanBtnText}>Open Camera</Text></TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK.bg }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: DARK.border },
  back: { color: DARK.primary, fontSize: 16 }, title: { color: DARK.text, fontSize: 20, fontWeight: '700' },
  tabs: { flexDirection: 'row', margin: 16, backgroundColor: DARK.card, borderRadius: 12, padding: 4 },
  tab: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' }, tabActive: { backgroundColor: DARK.primary },
  tabText: { color: DARK.muted, fontSize: 14, fontWeight: '500' }, tabTextActive: { color: '#fff', fontWeight: '600' },
  content: { padding: 16 },
  qrCard: { backgroundColor: DARK.card, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: DARK.border },
  qrPlaceholder: { width: 180, height: 180, backgroundColor: '#fff', borderRadius: 12, textAlign: 'center', lineHeight: 180, fontSize: 14, color: '#000', marginBottom: 16 },
  qrId: { color: DARK.muted, fontSize: 13, marginBottom: 4 }, qrData: { color: DARK.dim, fontSize: 11, marginBottom: 16, textAlign: 'center' },
  copyBtn: { backgroundColor: DARK.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginBottom: 12 }, copyBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  link: { color: DARK.muted, fontSize: 12, textAlign: 'center' },
  sendCard: { backgroundColor: DARK.card, borderRadius: 16, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: DARK.border },
  sendIcon: { fontSize: 64, marginBottom: 16 }, sendTitle: { color: DARK.text, fontSize: 20, fontWeight: '700', marginBottom: 8 }, sendSub: { color: DARK.muted, fontSize: 14, textAlign: 'center', marginBottom: 24 },
  scanBtn: { backgroundColor: DARK.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 }, scanBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
