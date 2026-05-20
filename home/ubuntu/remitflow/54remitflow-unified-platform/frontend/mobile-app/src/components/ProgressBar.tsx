import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
export const ProgressBar = ({ progress, showPercentage }: any) => (
  <View style={styles.container}>
    <View style={styles.track}><View style={[styles.fill, {width: `${progress}%`}]}/></View>
    {showPercentage && <Text style={styles.text}>{progress}%</Text>}
  </View>
);
const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  track: { flex: 1, height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#667eea' },
  text: { marginLeft: 10, fontSize: 12, fontWeight: '600' },
});