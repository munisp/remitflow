import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'package:intl/intl.dart'; // Import for currency formatting

class TreasuryDashboardPageScreen extends ConsumerStatefulWidget {
  const TreasuryDashboardPageScreen({super.key});
  @override
  ConsumerState<TreasuryDashboardPageScreen> createState() => _TreasuryDashboardPageScreenState();
}
class _TreasuryDashboardPageScreenState extends ConsumerState<TreasuryDashboardPageScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      // Adjusted tRPC route for TreasuryDashboardPage
      final result = await api.get('/trpc/treasury.list');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }

  String _formatCurrency(dynamic amount) {
    if (amount == null) return '';
    try {
      final numberFormat = NumberFormat.currency(locale: 'en_US', symbol: '$'); // Using US Dollar symbol
      return numberFormat.format(amount);
    } catch (e) {
      return amount.toString(); // Fallback if formatting fails
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Treasury Dashboard', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
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
                  ? const Center(child: Text('No treasury data available', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        final String title = item['title']?.toString() ?? item['name']?.toString() ?? 'Item ${index + 1}';
                        final String status = item['status']?.toString() ?? '';
                        final String description = item['description']?.toString() ?? '';
                        final String amount = item['amount'] != null ? _formatCurrency(item['amount']) : '';

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(title, style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text(
                              amount.isNotEmpty ? '$amount - $status' : '$status $description'.trim(),
                              style: const TextStyle(color: Color(0xFF94A3B8))
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
