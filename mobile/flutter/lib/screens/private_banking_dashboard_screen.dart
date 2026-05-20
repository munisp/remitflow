import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'package:intl/intl.dart'; // For currency formatting

class PrivateBankingDashboardScreen extends ConsumerStatefulWidget {
  const PrivateBankingDashboardScreen({super.key});
  @override
  ConsumerState<PrivateBankingDashboardScreen> createState() => _PrivateBankingDashboardScreenState();
}
class _PrivateBankingDashboardScreenState extends ConsumerState<PrivateBankingDashboardScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      // Using a more specific tRPC route for private banking
      final result = await api.get('/trpc/privateBanking.list');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }

  String _formatCurrency(double amount, String currencyCode) {
    final format = NumberFormat.currency(locale: 'en_US', symbol: currencyCode);
    return format.format(amount);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Private Banking Dashboard', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
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
                  ? const Center(child: Text('No data yet', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        // Assuming item contains 'accountName', 'balance', 'currency' or 'transactionDescription', 'amount', 'currency', 'date'
                        final titleText = item['accountName']?.toString() ?? item['transactionDescription']?.toString() ?? 'Item ${index + 1}';
                        String subtitleText = '';
                        if (item['balance'] != null && item['currency'] != null) {
                          subtitleText = _formatCurrency(item['balance'].toDouble(), item['currency'].toString());
                        } else if (item['amount'] != null && item['currency'] != null) {
                          subtitleText = _formatCurrency(item['amount'].toDouble(), item['currency'].toString());
                          if (item['date'] != null) {
                            subtitleText += ' on ${DateFormat.yMMMd().format(DateTime.parse(item['date']))}';
                          }
                        } else if (item['status'] != null) {
                          subtitleText = item['status'].toString();
                        } else if (item['description'] != null) {
                          subtitleText = item['description'].toString();
                        }

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(titleText,
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text(subtitleText,
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
}
