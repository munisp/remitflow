import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function SendToSenegalScreen() {
  const navigation = useNavigation<any>();
  const [amount, setAmount] = React.useState('');
  const { data: rates, isLoading } = trpc.fx.getRates.useQuery({ from: 'USD', to: 'XOF' }, { onError: () => {} });
  const rate = rates?.rate ?? 0;
  const converted = amount ? (parseFloat(amount) * rate).toFixed(2) : '0.00';
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.flag}>🇸🇳</Text>
        <Text style={styles.title}>Send to Senegal</Text>
        <Text style={styles.subtitle}>Fast, secure transfers to Senegal</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Exchange Rate</Text>
        {isLoading ? <ActivityIndicator color="#6366f1" /> : (
          <Text style={styles.rate}>1 USD = {rate.toFixed(4)} XOF</Text>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Amount (USD)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor="#64748b"
        />
        <Text style={styles.label}>Recipient Gets (XOF)</Text>
        <Text style={styles.converted}>{converted} FCFA</Text>
      </View>
      <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('SendMoney' as never)}>
        <Text style={styles.btnText}>Continue to Send</Text>
      </TouchableOpacity>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Why send to Senegal?</Text>
        <Text style={styles.infoText}>• Competitive exchange rates</Text>
        <Text style={styles.infoText}>• Transfers arrive within minutes</Text>
        <Text style={styles.infoText}>• Bank deposits & mobile money supported</Text>
        <Text style={styles.infoText}>• 24/7 customer support</Text>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
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
