import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function NotFoundScreen() {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>❌</Text>
      <Text style={styles.title}>Not Found</Text>
      <Text style={styles.msg}>The page you're looking for doesn't exist.</Text>
      <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Dashboard' as never)}>
        <Text style={styles.btnText}>Go to Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 8, textAlign: 'center' },
  msg: { fontSize: 16, color: '#94a3b8', textAlign: 'center', marginBottom: 32 },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
