import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface AvatarProps {
  name: string;
  size?: number;
}

export const Avatar: React.FC<AvatarProps> = ({ name, size = 50 }) => {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.text, { fontSize: size / 2.5 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  avatar: { backgroundColor: '#667eea', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#fff', fontWeight: 'bold' },
});