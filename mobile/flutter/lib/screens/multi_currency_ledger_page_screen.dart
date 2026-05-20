import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart'; // Added for currency formatting
import '../services/api_service.dart';

class MultiCurrencyLedgerPageScreen extends ConsumerStatefulWidget {
  const MultiCurrencyLedgerPageScreen({super.key});
  @override
  ConsumerState<MultiCurrencyLedgerPageScreen> createState() => _MultiCurrencyLedgerPageScreenState();
}
class _MultiCurrencyLedgerPageScreenState extends ConsumerState<MultiCurrencyLedgerPageScreen> {
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
      final result = await api.get('/trpc/multiCurrencyLedger.list'); 
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Multi-Currency Ledger', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
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
                  ? const Center(child: Text('No ledger entries yet', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        // Format amount with currency
                        final String formattedAmount = NumberFormat.currency(
                          symbol: item['currency']?.toString() ?? '', // Use currency symbol from data
                          decimalDigits: 2,
                        ).format(item['amount'] ?? 0.0);

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(
                              '${item['description']?.toString() ?? 'Entry ${index + 1}'} - $formattedAmount',
                              style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              'Date: ${item['date']?.toString() ?? 'N/A'}',
                              style: const TextStyle(color: Color(0xFF94A3B8)),
                            ),
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
}
