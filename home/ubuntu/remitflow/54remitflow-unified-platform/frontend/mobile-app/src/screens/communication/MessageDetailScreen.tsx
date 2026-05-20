import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
export const MessageDetailScreen = ({ route }: any) => {
  const { message } = route.params;
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}><Text style={styles.from}>From: {message.from}</Text><Text style={styles.date}>{message.date}</Text></View>
      <View style={styles.body}><Text>{message.body}</Text></View>
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#fff', padding: 20, marginBottom: 15 },
  from: { fontSize: 16, fontWeight: '600', marginBottom: 5 },
  date: { fontSize: 12, color: '#666' },
  body: { backgroundColor: '#fff', padding: 20 },
});