// File: transaction_details_screen.dart

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:local_auth/local_auth.dart';
import 'packagepackage:shared_preferences/shared_preferences.dart';
import 'package:flutter/rendering.dart';
import 'dart:ui' as ui;

// --- Mock Data Models ---

/// Represents a single transaction.
class Transaction {
  final String id;
  final String sender;
  final String recipient;
  final double amount;
  final String currency;
  final DateTime date;
  final String status;
  final String reference;

  Transaction({
    required this.id,
    required this.sender,
    required this.recipient,
    required this.amount,
    required this.currency,
    required this.date,
    required this.status,
    required this.reference,
  });

  factory Transaction.fromJson(Map<String, dynamic> json) {
    return Transaction(
      id: json['id'],
      sender: json['sender'],
      recipient: json['recipient'],
      amount: json['amount'].toDouble(),
      currency: json['currency'],
      date: DateTime.parse(json['date']),
      status: json['status'],
      reference: json['reference'],
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'sender': sender,
        'recipient': recipient,
        'amount': amount,
        'currency': currency,
        'date': date.toIso8601String(),
        'status': status,
        'reference': reference,
      };
}

// --- State Management (Provider) ---

/// Manages the state for the Transaction Details Screen.
class TransactionProvider with ChangeNotifier {
  Transaction? _transaction;
  bool _isLoading = false;
  String? _errorMessage;

  Transaction? get transaction => _transaction;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  // Mock API call to fetch transaction details
  Future<void> fetchTransactionDetails(String transactionId) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      // 1. Check for offline data first (shared_preferences)
      final prefs = await SharedPreferences.getInstance();
      final cachedData = prefs.getString('transaction_$transactionId');

      if (cachedData != null) {
        _transaction = Transaction.fromJson(json.decode(cachedData));
        _isLoading = false;
        notifyListeners();
        // Attempt to refresh in background
        _fetchFromApi(transactionId, prefs);
        return;
      }

      // 2. Fetch from API
      await _fetchFromApi(transactionId, prefs);
    } catch (e) {
      _errorMessage = 'Failed to load transaction: ${e.toString()}';
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _fetchFromApi(String transactionId, SharedPreferences prefs) async {
    // Mock API endpoint
    final url = Uri.parse('https://api.mockremittance.com/transactions/$transactionId');
    
    // Simulate network delay
    await Future.delayed(const Duration(seconds: 1));

    // Mock response data
    final mockResponse = {
      'id': transactionId,
      'sender': 'John Doe',
      'recipient': 'Jane Smith',
      'amount': 1500.00,
      'currency': 'NGN',
      'date': '2025-11-03T10:30:00Z',
      'status': 'Completed',
      'reference': 'REF-1234567890',
    };

    // Simulate successful http response
    final response = http.Response(json.encode(mockResponse), 200);

    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      _transaction = Transaction.fromJson(data);
      _errorMessage = null;

      // Cache data for offline use
      prefs.setString('transaction_$transactionId', response.body);
    } else {
      // Proper error handling for API failures
      _errorMessage = 'API Error: Failed to fetch transaction details. Status code: ${response.statusCode}';
    }

    _isLoading = false;
    notifyListeners();
  }
}

// --- Utility Classes and Functions ---

/// Utility for Biometric Authentication
class BiometricAuthService {
  final LocalAuthentication auth = LocalAuthentication();

  Future<bool> authenticate() async {
    final bool canAuthenticate = await auth.canCheckBiometrics;
    if (!canAuthenticate) {
      // Fallback to a simple dialog or PIN if biometrics are not available
      return true; 
    }

    try {
      final bool didAuthenticate = await auth.authenticate(
        localizedReason: 'Please authenticate to view sensitive transaction details',
        options: const AuthenticationOptions(
          stickyAuth: true,
        ),
      );
      return didAuthenticate;
    } catch (e) {
      // Handle platform exceptions
      debugPrint('Biometric authentication error: $e');
      return false;
    }
  }
}

// --- Screen Widget ---

class TransactionDetailsScreen extends StatefulWidget {
  static const String routeName = '/transaction_details';
  final String transactionId;

  const TransactionDetailsScreen({
    super.key,
    required this.transactionId,
  });

  @override
  State<TransactionDetailsScreen> createState() => _TransactionDetailsScreenState();
}

class _TransactionDetailsScreenState extends State<TransactionDetailsScreen> {
  final GlobalKey _receiptKey = GlobalKey();
  final BiometricAuthService _authService = BiometricAuthService();
  bool _isAuthenticated = false;

  @override
  void initState() {
    super.initState();
    // Initial fetch
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<TransactionProvider>(context, listen: false)
          .fetchTransactionDetails(widget.transactionId);
    });
  }

  // Function to capture the receipt widget as an image
  Future<String?> _captureAndSaveReceipt() async {
    try {
      // 1. Authenticate before generating receipt
      final authenticated = await _authService.authenticate();
      if (!authenticated) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Authentication failed. Cannot generate receipt.')),
          );
        }
        return null;
      }

      // 2. Capture the widget
      RenderRepaintBoundary boundary =
          _receiptKey.currentContext!.findRenderObject() as RenderRepaintBoundary;
      ui.Image image = await boundary.toImage(pixelRatio: 3.0);
      ByteData? byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      Uint8List pngBytes = byteData!.buffer.asUint8List();

      // 3. Save the image to a temporary file
      final directory = await getTemporaryDirectory();
      final filePath = '${directory.path}/receipt_${widget.transactionId}.png';
      final file = File(filePath);
      await file.writeAsBytes(pngBytes);

      return filePath;
    } catch (e) {
      debugPrint('Error capturing receipt: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to generate receipt image.')),
        );
      }
      return null;
    }
  }

  // Function to share the receipt image
  void _shareReceipt() async {
    final filePath = await _captureAndSaveReceipt();
    if (filePath != null) {
      await Share.shareXFiles([XFile(filePath)], text: 'Here is the transaction receipt.');
    }
  }

  // Mock payment gateway integration (for demonstration)
  void _processRefund() {
    // In a real app, this would involve an API call to the payment gateway
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Initiating refund via Payment Gateway... (Mock)')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Transaction Details'),
        actions: [
          IconButton(
            icon: const Icon(Icons.share),
            onPressed: _shareReceipt,
            tooltip: 'Share Receipt',
          ),
        ],
      ),
      body: Consumer<TransactionProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.errorMessage != null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      provider.errorMessage!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.red),
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: () => provider.fetchTransactionDetails(widget.transactionId),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            );
          }

          final transaction = provider.transaction;

          if (transaction == null) {
            return const Center(child: Text('No transaction data found.'));
          }

          // Main content: Transaction Details and Receipt View
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Receipt Section (RepaintBoundary for capture)
                RepaintBoundary(
                  key: _receiptKey,
                  child: Card(
                    elevation: 4,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    child: Padding(
                      padding: const EdgeInsets.all(20.0),
                      child: _buildReceiptContent(transaction),
                    ),
                  ),
                ),
                const SizedBox(height: 30),

                // Additional Actions
                Text(
                  'Actions',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const Divider(),
                ListTile(
                  leading: const Icon(Icons.receipt_long),
                  title: const Text('Generate PDF Receipt'),
                  subtitle: const Text('Save a high-quality PDF version of the receipt.'),
                  trailing: const Icon(Icons.arrow_forward_ios),
                  onTap: () {
                    // Placeholder for PDF generation logic (requires a package like pdf)
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('PDF Generation not implemented (Requires PDF package)')),
                    );
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.refresh),
                  title: const Text('Process Refund'),
                  subtitle: const Text('Initiate a refund for this transaction.'),
                  trailing: const Icon(Icons.payment),
                  onTap: _processRefund,
                ),
                // Accessibility example
                Semantics(
                  label: 'Transaction status is ${transaction.status}',
                  child: const SizedBox.shrink(),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  // Helper widget to build the detailed receipt content
  Widget _buildReceiptContent(Transaction transaction) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Center(
          child: Text(
            'Transaction Receipt',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
          ),
        ),
        const Divider(height: 30, thickness: 2),
        _buildDetailRow('Status', transaction.status, color: transaction.status == 'Completed' ? Colors.green : Colors.orange),
        _buildDetailRow('Amount', '${transaction.currency} ${transaction.amount.toStringAsFixed(2)}', isAmount: true),
        _buildDetailRow('Date', transaction.date.toLocal().toString().split('.')[0]),
        _buildDetailRow('Reference', transaction.reference),
        const Divider(height: 30),
        Text(
          'Sender Details',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        _buildDetailRow('Name', transaction.sender),
        const Divider(height: 30),
        Text(
          'Recipient Details',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        _buildDetailRow('Name', transaction.recipient),
        const Divider(height: 30),
        Center(
          child: Text(
            'Thank you for using our service.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ],
    );
  }

  // Helper widget for a single detail row
  Widget _buildDetailRow(String label, String value, {Color? color, bool isAmount = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 16,
              color: Colors.grey[600],
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: isAmount ? 20 : 16,
              fontWeight: isAmount ? FontWeight.bold : FontWeight.normal,
              color: color ?? Colors.black,
            ),
          ),
        ],
      ),
    );
  }
}

// --- Example Usage (Main function for context) ---
/*
void main() {
  runApp(
    ChangeNotifierProvider(
      create: (context) => TransactionProvider(),
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Remittance App',
      theme: ThemeData(
        primarySwatch: Colors.blue,
        visualDensity: VisualDensity.adaptivePlatformDensity,
      ),
      home: const TransactionDetailsScreen(transactionId: 'TXN-001'),
      // Example of using routeName for navigation
      // routes: {
      //   TransactionDetailsScreen.routeName: (context) => const TransactionDetailsScreen(transactionId: 'TXN-001'),
      // },
    );
  }
}
*/
