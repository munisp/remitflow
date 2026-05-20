import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { ApiService } from '../../services/ApiService';

export const ComposeMessageScreen = ({ navigation }: any) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!subject.trim() || !message.trim()) { Alert.alert('Error', 'Please fill in all fields'); return; }
    setSending(true);
    try {
      await ApiService.post('/api/v1/support/tickets', { subject: subject.trim(), message: message.trim() });
      Alert.alert('Sent', 'Your message has been sent successfully.', [{ text: 'OK', onPress: () => navigation?.goBack() }]);
    } catch (e) {
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally { setSending(false); }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.label}>Subject</Text>
      <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="Enter subject" />
      <Text style={styles.label}>Message</Text>
      <TextInput style={[styles.input, styles.textArea]} value={message} onChangeText={setMessage} placeholder="Write your message..." multiline numberOfLines={6} textAlignVertical="top" />
      <TouchableOpacity style={[styles.btn, sending && styles.btnDisabled]} onPress={send} disabled={sending}>
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send Message</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 15 },
  textArea: { height: 150 },
  btn: { backgroundColor: '#667eea', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  btnDisabled: { backgroundColor: '#ccc' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
