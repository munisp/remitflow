import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { ApiService } from '../../services/ApiService';

interface Message { id: string; text: string; user: boolean; timestamp: Date; }

export const ChatbotScreen = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', text: 'Hello! I am your RemitFlow AI assistant. How can I help you today?', user: false, timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg: Message = { id: Date.now().toString(), text: input.trim(), user: true, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    const query = input.trim();
    setInput('');
    setSending(true);
    try {
      const res = await ApiService.post('/api/v1/ai/chat', { message: query });
      const botMsg: Message = { id: (Date.now()+1).toString(), text: res.data?.reply || 'I could not process that request.', user: false, timestamp: new Date() };
      setMessages(prev => [...prev, botMsg]);
    } catch {
      const errMsg: Message = { id: (Date.now()+1).toString(), text: 'Sorry, I am currently unavailable. Please try again.', user: false, timestamp: new Date() };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { listRef.current?.scrollToEnd({ animated: true }); }, [messages]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList ref={listRef} data={messages} keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <View style={[styles.message, item.user ? styles.userMessage : styles.botMessage]}>
            <Text style={[styles.messageText, item.user && styles.userText]}>{item.text}</Text>
          </View>
        )}
        contentContainerStyle={styles.messageList}
      />
      <View style={styles.inputContainer}>
        <TextInput style={styles.input} value={input} onChangeText={setInput} placeholder="Type a message..." onSubmitEditing={send} returnKeyType="send" />
        <TouchableOpacity style={[styles.sendButton, (!input.trim() || sending) && styles.sendDisabled]} onPress={send} disabled={!input.trim() || sending}>
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendText}>Send</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  messageList: { padding: 15, paddingBottom: 5 },
  message: { maxWidth: '80%', padding: 12, borderRadius: 12, marginBottom: 10 },
  botMessage: { backgroundColor: '#fff', alignSelf: 'flex-start', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  userMessage: { backgroundColor: '#667eea', alignSelf: 'flex-end' },
  messageText: { fontSize: 15, color: '#333' },
  userText: { color: '#fff' },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 8, marginRight: 10, fontSize: 15 },
  sendButton: { backgroundColor: '#667eea', paddingHorizontal: 18, borderRadius: 20, justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#ccc' },
  sendText: { color: '#fff', fontWeight: '600' },
});
