import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'package:intl/intl.dart'; // For currency formatting

class MultiCurrencyWalletV2PageScreen extends ConsumerStatefulWidget {
  const MultiCurrencyWalletV2PageScreen({super.key});
  @override
  ConsumerState<MultiCurrencyWalletV2PageScreen> createState() => _MultiCurrencyWalletV2PageScreenState();
}
class _MultiCurrencyWalletV2PageScreenState extends ConsumerState<MultiCurrencyWalletV2PageScreen> {
  bool _isLoading = true;
  List<dynamic> _items = []; // This will hold wallet balances
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      // Assuming a tRPC route for listing multi-currency wallet balances
      final result = await api.get('/trpc/multiCurrencyWalletV2.list');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }

  String _formatCurrency(double amount, String currencyCode) {
    final format = NumberFormat.currency(locale: 'en_US', symbol: currencyCode); // Adjust locale as needed
    return format.format(amount);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Multi-Currency Wallet V2', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
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
                  ? const Center(child: Text('No wallets found', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        final String currencyCode = item['currency']?.toString() ?? 'USD'; // Default to USD if not provided
                        final double balance = (item['balance'] as num?)?.toDouble() ?? 0.0;
                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(currencyCode,
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text(_formatCurrency(balance, currencyCode),
                                style: const TextStyle(color: Color(0xFF94A3B8))),
                            trailing: const Icon(Icons.chevron_right, color: Color(0xFF6C63FF)),
                            onTap: () {
                              // Handle tapping on a wallet item, e.g., navigate to detail screen
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('View wallet details coming soon'))
                              );
                            },
                          ),
                        );
                      },
                    ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: const Color(0xFF6C63FF),
        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Add new wallet coming soon'))),
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
}
