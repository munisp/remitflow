import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { trpc } from '../services/trpc';

export default function BondSecondaryMarketScreen() {
  const navigation = useNavigation();

  // State for modal visibility and bond purchase details
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [selectedBond, setSelectedBond] = useState<any>(null);
  const [buyQuantity, setBuyQuantity] = useState('');

  // tRPC queries and mutations
  const { data: openOrders, isLoading: isLoadingOpenOrders, error: errorOpenOrders, refetch: refetchOpenOrders } = trpc.bondSecondaryMarket.listOpenOrders.useQuery();
  const { data: myOrders, isLoading: isLoadingMyOrders, error: errorMyOrders, refetch: refetchMyOrders } = trpc.bondSecondaryMarket.myOrders.useQuery();
  const buyMutation = trpc.bondSecondaryMarket.buy.useMutation();

  const handleBuyPress = (bond: any) => {
    setSelectedBond(bond);
    setShowBuyModal(true);
  };

  const confirmPurchase = () => {
    if (!selectedBond || !buyQuantity || isNaN(Number(buyQuantity)) || Number(buyQuantity) <= 0) {
      Alert.alert('Invalid Input', 'Please enter a valid quantity.');
      return;
    }

    Alert.alert(
      'Confirm Purchase',
      `Are you sure you want to buy ${buyQuantity} units of ${selectedBond.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Buy', onPress: handlePurchase },
      ]
    );
  };

  const handlePurchase = async () => {
    try {
      await buyMutation.mutateAsync({
        bondId: selectedBond.id,
        quantity: Number(buyQuantity),
        price: selectedBond.price, // Assuming price is per unit
      });
      Alert.alert('Success', 'Bond purchased successfully!');
      setShowBuyModal(false);
      setBuyQuantity('');
      setSelectedBond(null);
      refetchOpenOrders(); // Refresh open orders
      refetchMyOrders(); // Refresh my orders
    } catch (err: any) {
      Alert.alert('Error', `Failed to purchase bond: ${err.message || 'Unknown error'}`);
    }
  };

  const renderOpenOrders = () => {
    if (isLoadingOpenOrders) {
      return (
        <View style={styles.centeredMessage}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.mutedText}>Loading open bond orders...</Text>
        </View>
      );
    }

    if (errorOpenOrders) {
      return (
        <View style={styles.centeredMessage}>
          <Text style={styles.errorText}>Failed to load open orders: {errorOpenOrders.message}</Text>
          <TouchableOpacity onPress={refetchOpenOrders} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!openOrders || openOrders.length === 0) {
      return (
        <View style={styles.centeredMessage}>
          <Text style={styles.emptyEmoji}>😔</Text>
          <Text style={styles.mutedText}>No open bond orders available.</Text>
        </View>
      );
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Open Bond Orders</Text>
        {openOrders.map((bond: any) => (
          <View key={bond.id} style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Bond:</Text>
              <Text style={styles.cardValue}>{bond.name} ({bond.issuer})</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Coupon:</Text>
              <Text style={styles.cardValue}>{bond.couponRate}%</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Maturity:</Text>
              <Text style={styles.cardValue}>{new Date(bond.maturityDate).toLocaleDateString()}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Yield:</Text>
              <Text style={styles.cardValue}>{bond.yield}%</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Price:</Text>
              <Text style={styles.cardValue}>${bond.price.toFixed(2)}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Available:</Text>
              <Text style={styles.cardValue}>{bond.quantityAvailable}</Text>
            </View>
            <TouchableOpacity style={styles.buyButton} onPress={() => handleBuyPress(bond)}>
              <Text style={styles.buyButtonText}>Buy</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    );
  };

  const renderMyOrders = () => {
    if (isLoadingMyOrders) {
      return (
        <View style={styles.centeredMessage}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.mutedText}>Loading your bond orders...</Text>
        </View>
      );
    }

    if (errorMyOrders) {
      return (
        <View style={styles.centeredMessage}>
          <Text style={styles.errorText}>Failed to load your orders: {errorMyOrders.message}</Text>
          <TouchableOpacity onPress={refetchMyOrders} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!myOrders || myOrders.length === 0) {
      return (
        <View style={styles.centeredMessage}>
          <Text style={styles.emptyEmoji}>🤷‍♂️</Text>
          <Text style={styles.mutedText}>You haven't placed any bond orders yet.</Text>
        </View>
      );
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Bond Orders</Text>
        {myOrders.map((order: any) => (
          <View key={order.id} style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Bond:</Text>
              <Text style={styles.cardValue}>{order.bondName} ({order.issuer})</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Quantity:</Text>
              <Text style={styles.cardValue}>{order.quantity}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Price:</Text>
              <Text style={styles.cardValue}>${order.price.toFixed(2)}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Status:</Text>
              <Text style={[styles.cardValue, order.status === 'completed' ? styles.statusCompleted : styles.statusPending]}>{order.status}</Text>
            </View>
            {/* Add more order details as needed */}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Bond Secondary Market</Text>
        {/* The '+ New' button is replaced by the 'Buy' button on each bond card for this screen */}
        <View style={{ width: 50 }} />{/* Placeholder to balance header */}
      </View>
      <ScrollView style={styles.scrollViewContent}>
        {renderOpenOrders()}
        {renderMyOrders()}
      </ScrollView>

      {/* Buy Bond Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showBuyModal}
        onRequestClose={() => setShowBuyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Buy {selectedBond?.name}</Text>
            <Text style={styles.modalText}>Issuer: {selectedBond?.issuer}</Text>
            <Text style={styles.modalText}>Price per unit: ${selectedBond?.price.toFixed(2)}</Text>
            <Text style={styles.modalText}>Available: {selectedBond?.quantityAvailable}</Text>
            <TextInput
              style={styles.input}
              placeholder="Quantity"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={buyQuantity}
              onChangeText={setBuyQuantity}
            />
            <View style={styles.modalButtonContainer}>
              <TouchableOpacity style={styles.modalButtonCancel} onPress={() => setShowBuyModal(false)}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonConfirm, buyMutation.isLoading && styles.modalButtonDisabled]}
                onPress={confirmPurchase}
                disabled={buyMutation.isLoading}
              >
                {buyMutation.isLoading ? (
                  <ActivityIndicator color="#f1f5f9" />
                ) : (
                  <Text style={styles.modalButtonText}>Confirm Buy</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  title: { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  back: { color: '#6366f1', fontSize: 14 },
  addBtn: { color: '#6366f1', fontSize: 14, fontWeight: '600' }, // Not used directly, but kept for consistency if needed
  scrollViewContent: { padding: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9', marginBottom: 12 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  cardValue: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '500',
  },
  buyButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    borderRadius: 6,
    marginTop: 10,
    alignItems: 'center',
  },
  buyButtonText: {
    color: '#f1f5f9',
    fontSize: 15,
    fontWeight: '600',
  },
  centeredMessage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    minHeight: 150, // Ensure it takes up some space
  },
  mutedText: {
    color: '#94a3b8',
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    color: '#ef4444', // A red color for errors
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    marginTop: 12,
  },
  retryButtonText: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 10,
  },
  statusCompleted: {
    color: '#22c55e', // Green for completed
  },
  statusPending: {
    color: '#f59e0b', // Orange for pending
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 20,
    width: '85%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 15,
    textAlign: 'center',
  },
  modalText: {
    color: '#f1f5f9',
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0f172a',
    color: '#f1f5f9',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
  },
  modalButtonCancel: {
    backgroundColor: '#475569',
    paddingVertical: 12,
    borderRadius: 6,
    flex: 1,
    marginRight: 10,
    alignItems: 'center',
  },
  modalButtonConfirm: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    borderRadius: 6,
    flex: 1,
    marginLeft: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
});
