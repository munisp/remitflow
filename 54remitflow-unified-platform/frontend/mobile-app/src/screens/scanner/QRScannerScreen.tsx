import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Dimensions,
  Vibration,
  StatusBar,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { RNCamera } from 'react-native-camera';
import QRCodeScanner from 'react-native-qrcode-scanner';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Card, Button, Input, Badge } from 'react-native-elements';
import Toast from 'react-native-toast-message';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { format } from 'date-fns';

import { RootState } from '../../store/store';
import { OfflineService } from '../../services/OfflineService';
import { processQRPayment, validateQRCode } from '../../services/PaymentService';

const { width, height } = Dimensions.get('window');

interface QRData {
  transaction_id: string;
  amount: number;
  currency: string;
  merchant_id: string;
  terminal_id: string;
  expires_at: string;
  description?: string;
  reference?: string;
}

interface PaymentConfirmation {
  amount: number;
  currency: string;
  merchant_name: string;
  description: string;
  expires_at: string;
}

const QRScannerScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const dispatch = useDispatch();
  
  const { user, isOffline } = useSelector((state: RootState) => ({
    user: state.auth.user,
    isOffline: state.auth.isOffline,
  }));

  const [isScanning, setIsScanning] = useState(true);
  const [flashOn, setFlashOn] = useState(false);
  const [scannedData, setScannedData] = useState<QRData | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentConfirmation, setPaymentConfirmation] = useState<PaymentConfirmation | null>(null);
  const [scanHistory, setScanHistory] = useState<QRData[]>([]);

  const scannerRef = useRef<QRCodeScanner>(null);

  useEffect(() => {
    loadScanHistory();
    
    // Auto-focus camera every 3 seconds
    const focusInterval = setInterval(() => {
      if (scannerRef.current && isScanning) {
        scannerRef.current.reactivate();
      }
    }, 3000);

    return () => clearInterval(focusInterval);
  }, [isScanning]);

  const loadScanHistory = async () => {
    try {
      const history = await OfflineService.getQRScanHistory();
      setScanHistory(history);
    } catch (error) {
      console.error('Failed to load scan history:', error);
    }
  };

  const validateQRData = (data: string): QRData | null => {
    try {
      const parsed = JSON.parse(data);
      
      // Validate required fields
      const requiredFields = ['transaction_id', 'amount', 'currency', 'merchant_id', 'terminal_id', 'expires_at'];
      for (const field of requiredFields) {
        if (!parsed[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Validate data types
      if (typeof parsed.amount !== 'number' || parsed.amount <= 0) {
        throw new Error('Invalid amount');
      }

      // Validate expiration
      const expiresAt = new Date(parsed.expires_at);
      if (expiresAt <= new Date()) {
        throw new Error('QR code has expired');
      }

      // Validate currency format
      if (!/^[A-Z]{3}$/.test(parsed.currency)) {
        throw new Error('Invalid currency format');
      }

      return parsed as QRData;
    } catch (error) {
      console.error('QR validation error:', error);
      return null;
    }
  };

  const onQRCodeRead = async (e: any) => {
    if (!isScanning) return;

    setIsScanning(false);
    Vibration.vibrate(200);

    try {
      const qrData = validateQRData(e.data);
      
      if (!qrData) {
        Alert.alert(
          'Invalid QR Code',
          'The scanned QR code is not valid or has expired.',
          [
            { text: 'Scan Again', onPress: () => setIsScanning(true) },
            { text: 'Manual Entry', onPress: () => setShowManualEntry(true) },
          ]
        );
        return;
      }

      // Store in scan history
      await OfflineService.addQRScanHistory(qrData);
      await loadScanHistory();

      setScannedData(qrData);

      // Validate QR code with backend if online
      if (!isOffline) {
        const validation = await validateQRCode(qrData);
        if (!validation.valid) {
          Alert.alert(
            'QR Code Validation Failed',
            validation.error || 'The QR code could not be validated.',
            [{ text: 'OK', onPress: () => setIsScanning(true) }]
          );
          return;
        }
        
        setPaymentConfirmation({
          amount: qrData.amount,
          currency: qrData.currency,
          merchant_name: validation.merchant_name || 'Unknown Merchant',
          description: qrData.description || validation.description || 'Payment',
          expires_at: qrData.expires_at,
        });
      } else {
        // Offline mode - use cached merchant data
        const merchantInfo = await OfflineService.getCachedMerchant(qrData.merchant_id);
        setPaymentConfirmation({
          amount: qrData.amount,
          currency: qrData.currency,
          merchant_name: merchantInfo?.name || 'Unknown Merchant',
          description: qrData.description || 'Payment',
          expires_at: qrData.expires_at,
        });
      }

      setShowPaymentModal(true);

    } catch (error) {
      console.error('QR scan error:', error);
      Alert.alert(
        'Scan Error',
        'Failed to process the QR code. Please try again.',
        [{ text: 'OK', onPress: () => setIsScanning(true) }]
      );
    }
  };

  const processPayment = async (paymentData: any) => {
    if (!scannedData) return;

    setIsProcessing(true);

    try {
      const paymentRequest = {
        qr_data: scannedData,
        customer_pin: paymentData.pin,
        payment_method: paymentData.paymentMethod,
        agent_id: user?.id,
        notes: paymentData.notes,
      };

      const result = await processQRPayment(paymentRequest);

      if (result.success) {
        Toast.show({
          type: 'success',
          text1: 'Payment Successful',
          text2: `Transaction ID: ${result.transaction_id}`,
        });

        // Store transaction locally
        await OfflineService.storeTransaction({
          id: result.transaction_id,
          type: 'qr_payment',
          amount: scannedData.amount,
          currency: scannedData.currency,
          status: 'completed',
          qr_data: scannedData,
          created_at: new Date().toISOString(),
          synced: !isOffline,
        });

        setShowPaymentModal(false);
        setScannedData(null);
        setPaymentConfirmation(null);

        // Navigate to transaction details
        navigation.navigate('TransactionDetails', { 
          transactionId: result.transaction_id 
        });

      } else {
        Alert.alert('Payment Failed', result.error || 'Payment could not be processed.');
      }

    } catch (error) {
      console.error('Payment processing error:', error);
      Alert.alert('Payment Error', 'Failed to process payment. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleFlash = () => {
    setFlashOn(!flashOn);
  };

  const resetScanner = () => {
    setIsScanning(true);
    setScannedData(null);
    setShowPaymentModal(false);
    setShowManualEntry(false);
    setPaymentConfirmation(null);
  };

  const manualQREntry = async (qrText: string) => {
    const qrData = validateQRData(qrText);
    
    if (qrData) {
      setScannedData(qrData);
      setShowManualEntry(false);
      
      // Process as if scanned
      await onQRCodeRead({ data: qrText });
    } else {
      Alert.alert('Invalid QR Data', 'The entered QR code data is not valid.');
    }
  };

  const PaymentConfirmationModal = () => (
    <Modal
      visible={showPaymentModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowPaymentModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Payment</Text>
              <TouchableOpacity 
                onPress={() => setShowPaymentModal(false)}
                style={styles.closeButton}
              >
                <Icon name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {paymentConfirmation && (
              <View style={styles.paymentDetails}>
                <Card containerStyle={styles.detailCard}>
                  <View style={styles.amountSection}>
                    <Text style={styles.amountLabel}>Amount</Text>
                    <Text style={styles.amountValue}>
                      {paymentConfirmation.currency} {paymentConfirmation.amount.toFixed(2)}
                    </Text>
                  </View>
                  
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Merchant:</Text>
                    <Text style={styles.detailValue}>{paymentConfirmation.merchant_name}</Text>
                  </View>
                  
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Description:</Text>
                    <Text style={styles.detailValue}>{paymentConfirmation.description}</Text>
                  </View>
                  
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Expires:</Text>
                    <Text style={styles.detailValue}>
                      {format(new Date(paymentConfirmation.expires_at), 'MMM dd, yyyy HH:mm')}
                    </Text>
                  </View>

                  {isOffline && (
                    <Badge
                      value="Offline Mode"
                      status="warning"
                      containerStyle={styles.offlineBadge}
                    />
                  )}
                </Card>

                <Formik
                  initialValues={{
                    pin: '',
                    paymentMethod: 'agent_account',
                    notes: '',
                  }}
                  validationSchema={Yup.object({
                    pin: Yup.string()
                      .required('PIN is required')
                      .min(4, 'PIN must be at least 4 digits'),
                    paymentMethod: Yup.string().required('Payment method is required'),
                  })}
                  onSubmit={processPayment}
                >
                  {({ handleChange, handleBlur, handleSubmit, values, errors, touched }) => (
                    <View style={styles.paymentForm}>
                      <Input
                        placeholder="Enter Customer PIN"
                        label="Customer PIN"
                        secureTextEntry
                        keyboardType="numeric"
                        maxLength={6}
                        value={values.pin}
                        onChangeText={handleChange('pin')}
                        onBlur={handleBlur('pin')}
                        errorMessage={touched.pin && errors.pin ? errors.pin : ''}
                        leftIcon={<Icon name="lock" size={20} color="#666" />}
                      />

                      <Input
                        placeholder="Payment notes (optional)"
                        label="Notes"
                        multiline
                        numberOfLines={3}
                        value={values.notes}
                        onChangeText={handleChange('notes')}
                        onBlur={handleBlur('notes')}
                        leftIcon={<Icon name="note-text" size={20} color="#666" />}
                      />

                      <View style={styles.buttonRow}>
                        <Button
                          title="Cancel"
                          type="outline"
                          onPress={() => setShowPaymentModal(false)}
                          containerStyle={styles.cancelButton}
                        />
                        <Button
                          title={isProcessing ? "Processing..." : "Confirm Payment"}
                          onPress={handleSubmit}
                          loading={isProcessing}
                          disabled={isProcessing}
                          containerStyle={styles.confirmButton}
                        />
                      </View>
                    </View>
                  )}
                </Formik>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const ManualEntryModal = () => (
    <Modal
      visible={showManualEntry}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowManualEntry(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Manual QR Entry</Text>
            <TouchableOpacity 
              onPress={() => setShowManualEntry(false)}
              style={styles.closeButton}
            >
              <Icon name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <Formik
            initialValues={{ qrData: '' }}
            validationSchema={Yup.object({
              qrData: Yup.string().required('QR data is required'),
            })}
            onSubmit={(values) => manualQREntry(values.qrData)}
          >
            {({ handleChange, handleBlur, handleSubmit, values, errors, touched }) => (
              <View style={styles.manualEntryForm}>
                <Input
                  placeholder="Paste or type QR code data"
                  label="QR Code Data"
                  multiline
                  numberOfLines={6}
                  value={values.qrData}
                  onChangeText={handleChange('qrData')}
                  onBlur={handleBlur('qrData')}
                  errorMessage={touched.qrData && errors.qrData ? errors.qrData : ''}
                />

                <View style={styles.buttonRow}>
                  <Button
                    title="Cancel"
                    type="outline"
                    onPress={() => setShowManualEntry(false)}
                    containerStyle={styles.cancelButton}
                  />
                  <Button
                    title="Process"
                    onPress={handleSubmit}
                    containerStyle={styles.confirmButton}
                  />
                </View>
              </View>
            )}
          </Formik>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {isScanning ? (
        <QRCodeScanner
          ref={scannerRef}
          onRead={onQRCodeRead}
          flashMode={flashOn ? RNCamera.Constants.FlashMode.torch : RNCamera.Constants.FlashMode.off}
          showMarker={true}
          markerStyle={styles.marker}
          cameraStyle={styles.camera}
          topContent={
            <View style={styles.topContent}>
              <Text style={styles.centerText}>
                Scan QR Code for Payment
              </Text>
              <Text style={styles.instructionText}>
                Position the QR code within the frame
              </Text>
              {isOffline && (
                <Badge
                  value="Offline Mode"
                  status="warning"
                  containerStyle={styles.offlineBadgeTop}
                />
              )}
            </View>
          }
          bottomContent={
            <View style={styles.bottomContent}>
              <View style={styles.controlsRow}>
                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={toggleFlash}
                >
                  <Icon 
                    name={flashOn ? "flashlight" : "flashlight-off"} 
                    size={24} 
                    color="#fff" 
                  />
                  <Text style={styles.controlText}>Flash</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={() => setShowManualEntry(true)}
                >
                  <Icon name="keyboard" size={24} color="#fff" />
                  <Text style={styles.controlText}>Manual</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={() => navigation.goBack()}
                >
                  <Icon name="close" size={24} color="#fff" />
                  <Text style={styles.controlText}>Close</Text>
                </TouchableOpacity>
              </View>

              {scanHistory.length > 0 && (
                <View style={styles.historySection}>
                  <Text style={styles.historyTitle}>Recent Scans</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {scanHistory.slice(0, 5).map((item, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.historyItem}
                        onPress={() => onQRCodeRead({ data: JSON.stringify(item) })}
                      >
                        <Text style={styles.historyAmount}>
                          {item.currency} {item.amount}
                        </Text>
                        <Text style={styles.historyTime}>
                          {format(new Date(item.expires_at), 'HH:mm')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          }
        />
      ) : (
        <View style={styles.processingContainer}>
          <Icon name="qrcode-scan" size={80} color="#007AFF" />
          <Text style={styles.processingText}>Processing QR Code...</Text>
          <Button
            title="Scan Again"
            onPress={resetScanner}
            containerStyle={styles.scanAgainButton}
          />
        </View>
      )}

      <PaymentConfirmationModal />
      <ManualEntryModal />
      <Toast />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  marker: {
    borderColor: '#007AFF',
    borderWidth: 2,
    borderRadius: 10,
  },
  topContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  centerText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
  },
  instructionText: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 20,
  },
  offlineBadgeTop: {
    marginTop: 10,
  },
  bottomContent: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 20,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  controlButton: {
    alignItems: 'center',
    padding: 10,
  },
  controlText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 5,
  },
  historySection: {
    marginTop: 10,
  },
  historyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  historyItem: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 10,
    borderRadius: 8,
    marginRight: 10,
    minWidth: 80,
    alignItems: 'center',
  },
  historyAmount: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  historyTime: {
    color: '#ccc',
    fontSize: 10,
    marginTop: 2,
  },
  processingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  processingText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 20,
    marginBottom: 30,
  },
  scanAgainButton: {
    width: 200,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 15,
    width: width * 0.9,
    maxHeight: height * 0.8,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 5,
  },
  paymentDetails: {
    flex: 1,
  },
  detailCard: {
    borderRadius: 10,
    marginBottom: 20,
  },
  amountSection: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    marginBottom: 15,
  },
  amountLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  amountValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '400',
    flex: 1,
    textAlign: 'right',
  },
  offlineBadge: {
    alignSelf: 'center',
    marginTop: 10,
  },
  paymentForm: {
    marginTop: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  cancelButton: {
    flex: 0.45,
  },
  confirmButton: {
    flex: 0.45,
  },
  manualEntryForm: {
    marginTop: 20,
  },
});

export default QRScannerScreen;
