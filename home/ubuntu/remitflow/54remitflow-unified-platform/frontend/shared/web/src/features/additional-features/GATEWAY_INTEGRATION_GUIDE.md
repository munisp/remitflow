# Payment Gateway Frontend Integration Guide

## Overview

This guide explains how to integrate the new payment gateways (PAPSS, PIX, UPI, CIPS) into all frontend platforms.

---

## Architecture

```
Frontend App
    ↓
PaymentGatewayService
    ↓
Integration Service API
    ↓
Gateway Orchestrator
    ↓
Gateway Adapters (PAPSS, PIX, UPI, CIPS)
```

---

## API Endpoints

### 1. Initiate Payment

**Endpoint:** `POST /api/integration/payment/initiate`

**Request:**
```json
{
  "source_country": "NG",
  "dest_country": "KE",
  "source_currency": "NGN",
  "dest_currency": "KES",
  "amount": 10000,
  "sender_id": "user_123",
  "recipient_id": "user_456",
  "metadata": {
    "purpose": "family_support"
  }
}
```

**Response:**
```json
{
  "transaction_id": "txn_abc123",
  "status": "processing",
  "gateway": "papss",
  "estimated_completion": "60 seconds",
  "payment_details": {
    "amount": 10000,
    "currency": "KES",
    "exchange_rate": 0.22,
    "fee": 50,
    "total": 10050
  }
}
```

### 2. Get Payment Status

**Endpoint:** `GET /api/integration/payment/{transaction_id}/status`

**Response:**
```json
{
  "transaction_id": "txn_abc123",
  "status": "completed",
  "gateway": "papss",
  "created_at": "2025-11-05T10:00:00Z",
  "completed_at": "2025-11-05T10:01:15Z",
  "payment_details": {
    "amount": 10000,
    "currency": "KES",
    "recipient": "user_456"
  }
}
```

### 3. Get Available Gateways

**Endpoint:** `GET /api/integration/payment/gateways`

**Response:**
```json
{
  "gateways": [
    {
      "type": "papss",
      "name": "PAPSS",
      "regions": ["Africa"],
      "currencies": ["NGN", "KES", "GHS", ...],
      "settlement_time": "< 60 seconds",
      "fee": "0.5%"
    },
    {
      "type": "pix",
      "name": "PIX",
      "regions": ["Brazil"],
      "currencies": ["BRL"],
      "settlement_time": "< 10 seconds",
      "fee": "1.0%"
    },
    {
      "type": "upi",
      "name": "UPI",
      "regions": ["India"],
      "currencies": ["INR"],
      "settlement_time": "< 5 seconds",
      "fee": "0.8%"
    },
    {
      "type": "cips",
      "name": "CIPS",
      "regions": ["China", "Global"],
      "currencies": ["CNY"],
      "settlement_time": "< 2 minutes",
      "fee": "1.5%"
    }
  ]
}
```

---

## Frontend Implementation

### PWA/React Native (TypeScript)

```typescript
// PaymentGatewayService.ts
import { API_BASE_URL } from './config';

export interface PaymentRequest {
  sourceCountry: string;
  destCountry: string;
  sourceCurrency: string;
  destCurrency: string;
  amount: number;
  senderId: string;
  recipientId: string;
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  transactionId: string;
  status: string;
  gateway: string;
  estimatedCompletion: string;
  paymentDetails: {
    amount: number;
    currency: string;
    exchangeRate: number;
    fee: number;
    total: number;
  };
}

export class PaymentGatewayService {
  private baseUrl: string;
  
  constructor() {
    this.baseUrl = `${API_BASE_URL}/api/integration/payment`;
  }
  
  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    const response = await fetch(`${this.baseUrl}/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getToken()}`
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Payment initiation failed: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  async getPaymentStatus(transactionId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${transactionId}/status`, {
      headers: {
        'Authorization': `Bearer ${this.getToken()}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get payment status: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  async getAvailableGateways(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/gateways`, {
      headers: {
        'Authorization': `Bearer ${this.getToken()}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get gateways: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  private getToken(): string {
    // Get JWT token from storage
    return localStorage.getItem('auth_token') || '';
  }
}
```

### iOS (Swift)

```swift
// PaymentGatewayService.swift
import Foundation

struct PaymentRequest: Codable {
    let sourceCountry: String
    let destCountry: String
    let sourceCurrency: String
    let destCurrency: String
    let amount: Double
    let senderId: String
    let recipientId: String
    let metadata: [String: Any]?
}

struct PaymentResponse: Codable {
    let transactionId: String
    let status: String
    let gateway: String
    let estimatedCompletion: String
    let paymentDetails: PaymentDetails
}

struct PaymentDetails: Codable {
    let amount: Double
    let currency: String
    let exchangeRate: Double
    let fee: Double
    let total: Double
}

class PaymentGatewayService {
    private let baseURL: String
    
    init(baseURL: String = "https://api.example.com/api/integration/payment") {
        self.baseURL = baseURL
    }
    
    func initiatePayment(request: PaymentRequest) async throws -> PaymentResponse {
        guard let url = URL(string: "\(baseURL)/initiate") else {
            throw URLError(.badURL)
        }
        
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Bearer \(getToken())", forHTTPHeaderField: "Authorization")
        
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        urlRequest.httpBody = try encoder.encode(request)
        
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(PaymentResponse.self, from: data)
    }
    
    func getPaymentStatus(transactionId: String) async throws -> PaymentResponse {
        guard let url = URL(string: "\(baseURL)/\(transactionId)/status") else {
            throw URLError(.badURL)
        }
        
        var urlRequest = URLRequest(url: url)
        urlRequest.setValue("Bearer \(getToken())", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(PaymentResponse.self, from: data)
    }
    
    private func getToken() -> String {
        // Get JWT token from Keychain
        return KeychainService.shared.getToken() ?? ""
    }
}
```

### Android (Kotlin)

```kotlin
// PaymentGatewayService.kt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

data class PaymentRequest(
    val sourceCountry: String,
    val destCountry: String,
    val sourceCurrency: String,
    val destCurrency: String,
    val amount: Double,
    val senderId: String,
    val recipientId: String,
    val metadata: Map<String, Any>? = null
)

data class PaymentResponse(
    val transactionId: String,
    val status: String,
    val gateway: String,
    val estimatedCompletion: String,
    val paymentDetails: PaymentDetails
)

data class PaymentDetails(
    val amount: Double,
    val currency: String,
    val exchangeRate: Double,
    val fee: Double,
    val total: Double
)

class PaymentGatewayService(private val baseUrl: String = "https://api.example.com/api/integration/payment") {
    private val client = OkHttpClient()
    private val mediaType = "application/json; charset=utf-8".toMediaType()
    
    suspend fun initiatePayment(request: PaymentRequest): PaymentResponse = withContext(Dispatchers.IO) {
        val json = JSONObject().apply {
            put("source_country", request.sourceCountry)
            put("dest_country", request.destCountry)
            put("source_currency", request.sourceCurrency)
            put("dest_currency", request.destCurrency)
            put("amount", request.amount)
            put("sender_id", request.senderId)
            put("recipient_id", request.recipientId)
            request.metadata?.let { put("metadata", JSONObject(it)) }
        }
        
        val body = json.toString().toRequestBody(mediaType)
        val httpRequest = Request.Builder()
            .url("$baseUrl/initiate")
            .post(body)
            .addHeader("Content-Type", "application/json")
            .addHeader("Authorization", "Bearer ${getToken()}")
            .build()
        
        val response = client.newCall(httpRequest).execute()
        
        if (!response.isSuccessful) {
            throw Exception("Payment initiation failed: ${response.message}")
        }
        
        val responseBody = response.body?.string() ?: throw Exception("Empty response")
        parsePaymentResponse(JSONObject(responseBody))
    }
    
    suspend fun getPaymentStatus(transactionId: String): PaymentResponse = withContext(Dispatchers.IO) {
        val httpRequest = Request.Builder()
            .url("$baseUrl/$transactionId/status")
            .get()
            .addHeader("Authorization", "Bearer ${getToken()}")
            .build()
        
        val response = client.newCall(httpRequest).execute()
        
        if (!response.isSuccessful) {
            throw Exception("Failed to get payment status: ${response.message}")
        }
        
        val responseBody = response.body?.string() ?: throw Exception("Empty response")
        parsePaymentResponse(JSONObject(responseBody))
    }
    
    private fun parsePaymentResponse(json: JSONObject): PaymentResponse {
        val paymentDetails = json.getJSONObject("payment_details")
        return PaymentResponse(
            transactionId = json.getString("transaction_id"),
            status = json.getString("status"),
            gateway = json.getString("gateway"),
            estimatedCompletion = json.getString("estimated_completion"),
            paymentDetails = PaymentDetails(
                amount = paymentDetails.getDouble("amount"),
                currency = paymentDetails.getString("currency"),
                exchangeRate = paymentDetails.getDouble("exchange_rate"),
                fee = paymentDetails.getDouble("fee"),
                total = paymentDetails.getDouble("total")
            )
        )
    }
    
    private fun getToken(): String {
        // Get JWT token from EncryptedSharedPreferences
        return TokenManager.getToken() ?: ""
    }
}
```

### Flutter (Dart)

```dart
// payment_gateway_service.dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class PaymentRequest {
  final String sourceCountry;
  final String destCountry;
  final String sourceCurrency;
  final String destCurrency;
  final double amount;
  final String senderId;
  final String recipientId;
  final Map<String, dynamic>? metadata;
  
  PaymentRequest({
    required this.sourceCountry,
    required this.destCountry,
    required this.sourceCurrency,
    required this.destCurrency,
    required this.amount,
    required this.senderId,
    required this.recipientId,
    this.metadata,
  });
  
  Map<String, dynamic> toJson() => {
    'source_country': sourceCountry,
    'dest_country': destCountry,
    'source_currency': sourceCurrency,
    'dest_currency': destCurrency,
    'amount': amount,
    'sender_id': senderId,
    'recipient_id': recipientId,
    if (metadata != null) 'metadata': metadata,
  };
}

class PaymentResponse {
  final String transactionId;
  final String status;
  final String gateway;
  final String estimatedCompletion;
  final PaymentDetails paymentDetails;
  
  PaymentResponse({
    required this.transactionId,
    required this.status,
    required this.gateway,
    required this.estimatedCompletion,
    required this.paymentDetails,
  });
  
  factory PaymentResponse.fromJson(Map<String, dynamic> json) => PaymentResponse(
    transactionId: json['transaction_id'],
    status: json['status'],
    gateway: json['gateway'],
    estimatedCompletion: json['estimated_completion'],
    paymentDetails: PaymentDetails.fromJson(json['payment_details']),
  );
}

class PaymentDetails {
  final double amount;
  final String currency;
  final double exchangeRate;
  final double fee;
  final double total;
  
  PaymentDetails({
    required this.amount,
    required this.currency,
    required this.exchangeRate,
    required this.fee,
    required this.total,
  });
  
  factory PaymentDetails.fromJson(Map<String, dynamic> json) => PaymentDetails(
    amount: json['amount'].toDouble(),
    currency: json['currency'],
    exchangeRate: json['exchange_rate'].toDouble(),
    fee: json['fee'].toDouble(),
    total: json['total'].toDouble(),
  );
}

class PaymentGatewayService {
  final String baseUrl;
  
  PaymentGatewayService({this.baseUrl = 'https://api.example.com/api/integration/payment'});
  
  Future<PaymentResponse> initiatePayment(PaymentRequest request) async {
    final response = await http.post(
      Uri.parse('$baseUrl/initiate'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${await _getToken()}',
      },
      body: jsonEncode(request.toJson()),
    );
    
    if (response.statusCode != 200) {
      throw Exception('Payment initiation failed: ${response.reasonPhrase}');
    }
    
    return PaymentResponse.fromJson(jsonDecode(response.body));
  }
  
  Future<PaymentResponse> getPaymentStatus(String transactionId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/$transactionId/status'),
      headers: {
        'Authorization': 'Bearer ${await _getToken()}',
      },
    );
    
    if (response.statusCode != 200) {
      throw Exception('Failed to get payment status: ${response.reasonPhrase}');
    }
    
    return PaymentResponse.fromJson(jsonDecode(response.body));
  }
  
  Future<String> _getToken() async {
    // Get JWT token from secure storage
    return await TokenStorage.getToken() ?? '';
  }
}
```

---

## Usage Examples

### PWA/React Native

```typescript
const paymentService = new PaymentGatewayService();

// Initiate payment
const result = await paymentService.initiatePayment({
  sourceCountry: 'NG',
  destCountry: 'KE',
  sourceCurrency: 'NGN',
  destCurrency: 'KES',
  amount: 10000,
  senderId: 'user_123',
  recipientId: 'user_456'
});

console.log(`Transaction ID: ${result.transactionId}`);
console.log(`Gateway: ${result.gateway}`);
console.log(`Status: ${result.status}`);

// Poll for status
const checkStatus = async () => {
  const status = await paymentService.getPaymentStatus(result.transactionId);
  
  if (status.status === 'completed') {
    console.log('Payment completed!');
  } else if (status.status === 'failed') {
    console.log('Payment failed');
  } else {
    // Still processing, check again
    setTimeout(checkStatus, 2000);
  }
};

checkStatus();
```

---

## Real-Time Updates

Use Server-Sent Events (SSE) for real-time payment status updates:

```typescript
const eventSource = new EventSource(
  `${API_BASE_URL}/api/integration/events/stream?user_id=${userId}`
);

eventSource.addEventListener('payment_status', (event) => {
  const data = JSON.parse(event.data);
  
  if (data.transaction_id === transactionId) {
    console.log(`Payment status: ${data.status}`);
    
    if (data.status === 'completed') {
      // Show success message
      showSuccessMessage();
      eventSource.close();
    }
  }
});
```

---

## Error Handling

```typescript
try {
  const result = await paymentService.initiatePayment(request);
} catch (error) {
  if (error.message.includes('insufficient_balance')) {
    // Show add funds prompt
  } else if (error.message.includes('kyc_required')) {
    // Navigate to KYC upgrade
  } else {
    // Show generic error
  }
}
```

---

## Testing

Use mock data for testing:

```typescript
// Mock service for testing
class MockPaymentGatewayService extends PaymentGatewayService {
  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    return {
      transactionId: 'mock_txn_123',
      status: 'processing',
      gateway: 'papss',
      estimatedCompletion: '60 seconds',
      paymentDetails: {
        amount: request.amount,
        currency: request.destCurrency,
        exchangeRate: 0.22,
        fee: 50,
        total: request.amount + 50
      }
    };
  }
}
```

---

## Best Practices

1. **Always validate input** before sending to API
2. **Handle errors gracefully** with user-friendly messages
3. **Show loading states** during payment processing
4. **Use SSE** for real-time updates instead of polling
5. **Cache gateway list** to reduce API calls
6. **Implement retry logic** for failed requests
7. **Log all transactions** for debugging
8. **Test with mock data** before production

---

**Last Updated:** November 5, 2025  
**Version:** 1.0.0
