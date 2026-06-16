import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { parsePaymentIntent } from '../../services/futureProofingApi';

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  action?: { amount: number; currency: string; recipient: string };
}

export default function ConversationalPaymentsScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: '0',
    text: 'Hi! I can help you send money. Try:\n• "Send ₦50,000 to Emeka"\n• "Pay $200 to John in Kenya"\n• "Transfer 500 euros to Maria"',
    isUser: false,
  }]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isProcessing) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), text, isUser: true };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await parsePaymentIntent(text);
      const intent = result.intent;

      if (intent?.action === 'send_money' && intent.amount) {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: `I understood:\n💰 Amount: ${intent.currency ?? 'NGN'} ${intent.amount?.toFixed(2)}\n👤 Recipient: ${intent.recipient ?? 'Unknown'}\n📊 Confidence: ${((intent.confidence ?? 0) * 100).toFixed(0)}%\n\nWould you like to proceed?`,
          isUser: false,
          action: { amount: intent.amount!, currency: intent.currency ?? 'NGN', recipient: intent.recipient ?? 'Unknown' },
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: "I couldn't parse a payment from that. Try:\n\"Send ₦50,000 to Emeka\"",
          isUser: false,
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, something went wrong. Please try again.',
        isUser: false,
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => (
    <View style={[styles.messageContainer, item.isUser ? styles.userMessage : styles.botMessage]}>
      <Text style={[styles.messageText, item.isUser && styles.userText]}>{item.text}</Text>
      {item.action && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.confirmButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              setMessages(prev => [...prev, { id: Date.now().toString(), text: 'Transfer initiated!', isUser: false }]);
            }}
          >
            <Text style={styles.confirmText}>Confirm</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setMessages(prev => [...prev, { id: Date.now().toString(), text: 'Transfer cancelled.', isUser: false }])}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />
      {isProcessing && (
        <View style={styles.processingRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.processingText}>Analyzing...</Text>
        </View>
      )}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="Type a payment request..."
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  listContent: { padding: 16 },
  messageContainer: { maxWidth: '75%', padding: 12, borderRadius: 16, marginBottom: 12 },
  userMessage: { alignSelf: 'flex-end', backgroundColor: '#007AFF', borderBottomRightRadius: 4 },
  botMessage: { alignSelf: 'flex-start', backgroundColor: '#f0f0f0', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 15, color: '#333' },
  userText: { color: '#fff' },
  actionRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  confirmButton: { flex: 1, backgroundColor: '#34C759', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '600' },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#ccc', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  cancelText: { color: '#666' },
  processingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  processingText: { color: '#999', fontSize: 13 },
  inputBar: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#eee', alignItems: 'center' },
  textInput: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  sendButton: { marginLeft: 8, backgroundColor: '#007AFF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  sendText: { color: '#fff', fontWeight: '600' },
});
