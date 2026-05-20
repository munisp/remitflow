import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Clipboard, Modal, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function VirtualAccountScreen() {
  const navigation = useNavigation();
  const [showCreate, setShowCreate] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const { data, isLoading, refetch } = trpc.virtualAccounts.list.useQuery();
  const createMutation = trpc.virtualAccounts.create.useMutation({ onSuccess: () => { setShowCreate(false); refetch(); }, onError: (e) => Alert.alert('Error', e.message) });
  const copy = (text: string, label: string) => { Clipboard.setString(text); Alert.alert('Copied', \`\${label} copied to clipboard\