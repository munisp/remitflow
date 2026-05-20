import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineService } from './OfflineService';

const API_BASE_URL = 'http://localhost:8070'; // POS Integration service

export interface QRValidationResponse {
  valid: boolean;
  merchant_name?: string;
  description?: string;
  error?: string;
}

export interface QRPaymentRequest {
  qr_data: any;
  customer_pin: string;
  payment_method: string;
  agent_id: string;
  notes?: string;
}

export interface QRPaymentResponse {
  success: boolean;
  transaction_id?: string;
  error?: string;
  receipt_data?: any;
}

class PaymentService {
  private static instance: PaymentService;
  private authToken: string | null = null;

  private constructor() {
    this.loadAuthToken();
  }

  public static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  private async loadAuthToken() {
    try {
      this.authToken = await AsyncStorage.getItem('auth_token');
    } catch (error) {
      console.error('Failed to load auth token:', error);
    }
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` }),
    };

    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  async validateQRCode(qrData: any): Promise<QRValidationResponse> {
    try {
      // Check if offline
      if (await OfflineService.isOfflineMode()) {
        // Offline validation - basic checks only
        const now = new Date();
        const expiresAt = new Date(qrData.expires_at);
        
        if (expiresAt <= now) {
          return {
            valid: false,
            error: 'QR code has expired'
          };
        }

        // Get cached merchant info
        const merchantInfo = await OfflineService.getCachedMerchant(qrData.merchant_id);
        
        return {
          valid: true,
          merchant_name: merchantInfo?.name || 'Unknown Merchant',
          description: qrData.description || 'Payment'
        };
      }

      // Online validation
      const response = await this.makeRequest('/qr/validate', {
        method: 'POST',
        body: JSON.stringify({ qr_data: qrData }),
      });

      return {
        valid: response.valid,
        merchant_name: response.merchant_name,
        description: response.description,
        error: response.error,
      };

    } catch (error) {
      console.error('QR validation failed:', error);
      return {
        valid: false,
        error: 'Failed to validate QR code'
      };
    }
  }

  async processQRPayment(paymentRequest: QRPaymentRequest): Promise<QRPaymentResponse> {
    try {
      // Check if offline
      if (await OfflineService.isOfflineMode()) {
        // Store payment for later processing
        const offlinePayment = {
          id: `offline_${Date.now()}`,
          type: 'qr_payment',
          qr_data: paymentRequest.qr_data,
          customer_pin: paymentRequest.customer_pin,
          payment_method: paymentRequest.payment_method,
          agent_id: paymentRequest.agent_id,
          notes: paymentRequest.notes,
          created_at: new Date().toISOString(),
          status: 'pending_sync',
        };

        await OfflineService.storeOfflinePayment(offlinePayment);

        return {
          success: true,
          transaction_id: offlinePayment.id,
        };
      }

      // Online payment processing
      const response = await this.makeRequest('/qr/process-payment', {
        method: 'POST',
        body: JSON.stringify(paymentRequest),
      });

      return {
        success: response.success,
        transaction_id: response.transaction_id,
        error: response.error,
        receipt_data: response.receipt_data,
      };

    } catch (error) {
      console.error('QR payment processing failed:', error);
      return {
        success: false,
        error: 'Failed to process payment'
      };
    }
  }

  async getPaymentHistory(limit: number = 50): Promise<any[]> {
    try {
      if (await OfflineService.isOfflineMode()) {
        return await OfflineService.getCachedTransactions();
      }

      const response = await this.makeRequest(`/payments/history?limit=${limit}`);
      return response.payments || [];

    } catch (error) {
      console.error('Failed to get payment history:', error);
      return [];
    }
  }

  async getTransactionDetails(transactionId: string): Promise<any> {
    try {
      if (await OfflineService.isOfflineMode()) {
        return await OfflineService.getCachedTransaction(transactionId);
      }

      const response = await this.makeRequest(`/transactions/${transactionId}`);
      return response.transaction;

    } catch (error) {
      console.error('Failed to get transaction details:', error);
      return null;
    }
  }

  async refundPayment(transactionId: string, amount?: number, reason?: string): Promise<any> {
    try {
      const response = await this.makeRequest(`/transactions/${transactionId}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          reason,
        }),
      });

      return response;

    } catch (error) {
      console.error('Failed to process refund:', error);
      throw error;
    }
  }

  async generateQRCode(paymentData: any): Promise<string> {
    try {
      const response = await this.makeRequest('/qr/generate', {
        method: 'POST',
        body: JSON.stringify(paymentData),
      });

      return response.qr_code;

    } catch (error) {
      console.error('Failed to generate QR code:', error);
      throw error;
    }
  }

  async syncOfflinePayments(): Promise<void> {
    try {
      const offlinePayments = await OfflineService.getOfflinePayments();
      
      for (const payment of offlinePayments) {
        try {
          const response = await this.processQRPayment({
            qr_data: payment.qr_data,
            customer_pin: payment.customer_pin,
            payment_method: payment.payment_method,
            agent_id: payment.agent_id,
            notes: payment.notes,
          });

          if (response.success) {
            // Update local payment with server transaction ID
            await OfflineService.updateOfflinePayment(payment.id, {
              server_transaction_id: response.transaction_id,
              status: 'synced',
              synced_at: new Date().toISOString(),
            });
          }

        } catch (error) {
          console.error(`Failed to sync payment ${payment.id}:`, error);
          // Mark as failed but keep for retry
          await OfflineService.updateOfflinePayment(payment.id, {
            status: 'sync_failed',
            sync_error: error.message,
          });
        }
      }

    } catch (error) {
      console.error('Failed to sync offline payments:', error);
    }
  }
}

export const validateQRCode = (qrData: any) => PaymentService.getInstance().validateQRCode(qrData);
export const processQRPayment = (paymentRequest: QRPaymentRequest) => PaymentService.getInstance().processQRPayment(paymentRequest);
export const getPaymentHistory = (limit?: number) => PaymentService.getInstance().getPaymentHistory(limit);
export const getTransactionDetails = (transactionId: string) => PaymentService.getInstance().getTransactionDetails(transactionId);
export const refundPayment = (transactionId: string, amount?: number, reason?: string) => PaymentService.getInstance().refundPayment(transactionId, amount, reason);
export const generateQRCode = (paymentData: any) => PaymentService.getInstance().generateQRCode(paymentData);
export const syncOfflinePayments = () => PaymentService.getInstance().syncOfflinePayments();

export default PaymentService;
