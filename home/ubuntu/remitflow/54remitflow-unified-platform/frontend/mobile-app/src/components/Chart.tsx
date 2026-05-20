import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
export const Chart = ({ data, type }: any) => (
  <View style={styles.container}><Text style={styles.placeholder}>Chart: {type}</Text></View>
);
const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', padding: 20, borderRadius: 10, alignItems: 'center' },
  placeholder: { fontSize: 16, color: '#666' },
});