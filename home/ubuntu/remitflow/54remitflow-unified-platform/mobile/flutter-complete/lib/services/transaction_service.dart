// Flutter Transaction Service
import '../api/api_client.dart';

class Transaction {
  final String id;
  final String type;
  final double amount;
  final String currency;
  final String status;
  final String date;
  final String? recipient;
  final String? sender;
  final String paymentSystem;
  final String reference;

  Transaction({
    required this.id,
    required this.type,
    required this.amount,
    required this.currency,
    required this.status,
    required this.date,
    this.recipient,
    this.sender,
    required this.paymentSystem,
    required this.reference,
  });

  factory Transaction.fromJson(Map<String, dynamic> json) {
    return Transaction(
      id: json['id'],
      type: json['type'],
      amount: json['amount'].toDouble(),
      currency: json['currency'],
      status: json['status'],
      date: json['date'],
      recipient: json['recipient'],
      sender: json['sender'],
      paymentSystem: json['paymentSystem'],
      reference: json['reference'],
    );
  }
}

class TransactionService {
  static final APIClient _apiClient = APIClient();

  static Future<List<Transaction>> getAllTransactions() async {
    final response = await _apiClient.get('/transactions');
    return (response['data'] as List).map((json) => Transaction.fromJson(json)).toList();
  }

  static Future<List<Transaction>> getRecentTransactions(int limit) async {
    final response = await _apiClient.get('/transactions/recent?limit=$limit');
    return (response['data'] as List).map((json) => Transaction.fromJson(json)).toList();
  }

  static Future<Map<String, dynamic>> getTransactionById(String id) async {
    final response = await _apiClient.get('/transactions/$id');
    return response['data'];
  }

  static Future<void> exportTransactions(String format) async {
    await _apiClient.get('/transactions/export?format=$format');
  }
}
