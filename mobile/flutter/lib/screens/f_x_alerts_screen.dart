import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart'; // Import for currency formatting
import '../services/api_service.dart';

class FXAlertsScreen extends ConsumerStatefulWidget {
  const FXAlertsScreen({super.key});
  @override
  ConsumerState<FXAlertsScreen> createState() => _FXAlertsScreenState();
}
class _FXAlertsScreenState extends ConsumerState<FXAlertsScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;
  
  @override
  void initState() { super.initState(); _load(); }
  
  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('/trpc/fxAlerts.list'); // Updated tRPC route
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('FX Alerts', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)), // Updated title
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
                  ? const Center(child: Text('No FX alerts yet', style: TextStyle(color: Color(0xFF94A3B8)))) // Updated empty message
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        final currencyPair = item['currencyPair']?.toString() ?? 'N/A';
                        final alertPrice = item['alertPrice'];
                        final direction = item['direction']?.toString() ?? '';
                        final currencyCode = item['currencyCode']?.toString() ?? 'USD'; // Default currency code

                        String formattedPrice = '';
                        if (alertPrice != null) {
                          try {
                            final numberFormat = NumberFormat.currency(symbol: currencyCode, decimalDigits: 4); // Assuming 4 decimal places for FX
                            formattedPrice = numberFormat.format(alertPrice);
                          } catch (e) {
                            formattedPrice = alertPrice.toString(); // Fallback if formatting fails
                          }
                        }

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(currencyPair,
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text('$direction $formattedPrice',
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
