import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart'; // Import for currency formatting
import '../services/api_service.dart';

class SimilarTransactionsPageScreen extends ConsumerStatefulWidget {
  const SimilarTransactionsPageScreen({super.key});
  @override
  ConsumerState<SimilarTransactionsPageScreen> createState() => _SimilarTransactionsPageScreenState();
}
class _SimilarTransactionsPageScreenState extends ConsumerState<SimilarTransactionsPageScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;
  
  @override
  void initState() { super.initState(); _load(); }
  
  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      // Updated tRPC route
      final result = await api.get('/trpc/transactions.listSimilar'); 
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        // Updated FEATURE TITLE
        title: const Text('Similar Transactions', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Color(0xFFE2E8F0)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6C63FF)))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : _items.isEmpty
                  ? const Center(child: Text('No similar transactions found', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        final NumberFormat currencyFormatter = NumberFormat.currency(locale: 'en_US', symbol: '$'); // Example for USD
                        final String amount = item['amount'] != null ? currencyFormatter.format(item['amount']) : '';
                        final String transactionDate = item['date'] != null ? DateFormat('MMM dd, yyyy').format(DateTime.parse(item['date'])) : '';

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(item['transactionId']?.toString() ?? 'Transaction ${index + 1}',
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text('$amount - $transactionDate',
                                style: const TextStyle(color: Color(0xFF94A3B8))),
                            trailing: const Icon(Icons.chevron_right, color: Color(0xFF6C63FF)),
                          ),
                        );
                      },
                    ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: const Color(0xFF6C63FF),
        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Feature coming soon'))),
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
