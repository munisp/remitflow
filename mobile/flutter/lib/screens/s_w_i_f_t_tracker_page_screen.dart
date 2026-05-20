import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';

class SWIFTTrackerPageScreen extends ConsumerStatefulWidget {
  const SWIFTTrackerPageScreen({super.key});
  @override
  ConsumerState<SWIFTTrackerPageScreen> createState() => _SWIFTTrackerPageScreenState();
}
class _SWIFTTrackerPageScreenState extends ConsumerState<SWIFTTrackerPageScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;
  
  @override
  void initState() { super.initState(); _load(); }
  
  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('/trpc/swiftTracker.list');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('SWIFT Tracker', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
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
                  ? const Center(child: Text('No SWIFT transactions yet', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        final String transactionId = item['swiftTransactionId']?.toString() ?? 'N/A';
                        final String status = item['status']?.toString() ?? 'N/A';
                        final String sender = item['senderName']?.toString() ?? 'N/A';
                        final String receiver = item['receiverName']?.toString() ?? 'N/A';
                        
                        String subtitleText = 'Status: $status\nFrom: $sender To: $receiver';

                        if (item['amount'] != null && item['currency'] != null) {
                          try {
                            final double amount = double.parse(item['amount'].toString());
                            final String currencyCode = item['currency'].toString();
                            final NumberFormat currencyFormatter = NumberFormat.currency(symbol: currencyCode);
                            subtitleText += '\nAmount: ${currencyFormatter.format(amount)}';
                          } catch (e) {
                            // Fallback if amount/currency parsing fails
                            subtitleText += '\nAmount: ${item['amount']} ${item['currency']}';
                          }
                        }

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text('Transaction ID: $transactionId',
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
