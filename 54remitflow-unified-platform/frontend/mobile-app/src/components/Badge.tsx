import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface BadgeProps {
  text: string;
  variant?: 'success' | 'warning' | 'error' | 'info';
}

export const Badge: React.FC<BadgeProps> = ({ text, variant = 'info' }) => {
  return (
    <View style={[styles.badge, styles[variant]]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start' },
  success: { backgroundColor: '#d1fae5' },
  warning: { backgroundColor: '#fef3c7' },
  error: { backgroundColor: '#fee2e2' },
  info: { backgroundColor: '#dbeafe' },
  text: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
});