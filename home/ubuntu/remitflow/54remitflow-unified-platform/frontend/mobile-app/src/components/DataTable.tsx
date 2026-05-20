import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
export const DataTable = ({ columns, data }: any) => (
  <FlatList data={data} keyExtractor={(i,idx)=>idx.toString()} renderItem={({item})=><View style={styles.row}>{columns.map((c:any)=><Text key={c} style={styles.cell}>{item[c]}</Text>)}</View>}/>
);
const styles = StyleSheet.create({
  row: { flexDirection: 'row', padding: 15, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  cell: { flex: 1, fontSize: 14 },
});