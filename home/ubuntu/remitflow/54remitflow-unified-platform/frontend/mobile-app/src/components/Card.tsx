import React from 'react';
import { View, StyleSheet } from 'react-native';

export const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <View style={styles.card}>{children}</View>;
};

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', padding: 15, marginHorizontal: 15, marginVertical: 8, borderRadius: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
});