import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
export const RecommendationsScreen = () => (
  <ScrollView style={styles.container}>
    <View style={styles.card}><Text style={styles.title}>Recommended Products</Text><Text>Based on your sales history</Text></View>
    <View style={styles.card}><Text style={styles.title}>Next Best Action</Text><Text>Follow up with 3 customers</Text></View>
  </ScrollView>
);
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 10, marginBottom: 15 },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
});