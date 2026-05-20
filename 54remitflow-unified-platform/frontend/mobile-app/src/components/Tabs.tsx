import React, { useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
export const Tabs = ({ tabs, children }: any) => {
  const [active, setActive] = useState(0);
  return (
    <View style={styles.container}>
      <View style={styles.header}>{tabs.map((t:string,i:number)=><TouchableOpacity key={i} style={[styles.tab, active===i && styles.activeTab]} onPress={()=>setActive(i)}><Text style={[styles.tabText, active===i && styles.activeTabText]}>{t}</Text></TouchableOpacity>)}</View>
      <View style={styles.content}>{children[active]}</View>
    </View>
  );
};
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, padding: 15, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#667eea' },
  tabText: { fontSize: 14, color: '#666' },
  activeTabText: { color: '#667eea', fontWeight: '600' },
  content: { flex: 1 },
});