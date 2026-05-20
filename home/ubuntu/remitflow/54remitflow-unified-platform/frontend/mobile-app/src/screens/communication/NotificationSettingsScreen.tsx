import React, { useState } from 'react';
import { ScrollView, View, Text, Switch, StyleSheet } from 'react-native';
export const NotificationSettingsScreen = () => {
  const [email, setEmail] = useState(true);
  const [push, setPush] = useState(true);
  const [sms, setSms] = useState(false);
  return (
    <ScrollView style={styles.container}>
      <View style={styles.row}><Text>Email Notifications</Text><Switch value={email} onValueChange={setEmail}/></View>
      <View style={styles.row}><Text>Push Notifications</Text><Switch value={push} onValueChange={setPush}/></View>
      <View style={styles.row}><Text>SMS Notifications</Text><Switch value={sms} onValueChange={setSms}/></View>
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 20, marginBottom: 1 },
});