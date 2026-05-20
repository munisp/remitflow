import React from 'react';
import { Modal as RNModal, View, TouchableOpacity, StyleSheet } from 'react-native';
export const Modal = ({ visible, onClose, children }: any) => (
  <RNModal visible={visible} transparent animationType="fade">
    <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1}>
      <View style={styles.content} onStartShouldSetResponder={()=>true}>{children}</View>
    </TouchableOpacity>
  </RNModal>
);
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  content: { backgroundColor: '#fff', borderRadius: 10, padding: 20, minWidth: 300 },
});