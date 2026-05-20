import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'package:intl/intl.dart'; // Import for currency formatting

class RevenueAnalyticsPageScreen extends ConsumerStatefulWidget {
  const RevenueAnalyticsPageScreen({super.key});
  @override
  ConsumerState<RevenueAnalyticsPageScreen> createState() => _RevenueAnalyticsPageScreenState();
}
class _RevenueAnalyticsPageScreenState extends ConsumerState<RevenueAnalyticsPageScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;
  
  @override
  void initState() { super.initState(); _load(); }
  
  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      // Changed tRPC route to revenueAnalytics.list
      final result = await api.get('/trpc/revenueAnalytics.list'); 
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }
  
  @override
  Widget build(BuildContext context) {
    final currencyFormatter = NumberFormat.currency(locale: 'en_US', symbol: '$'); // For currency formatting

    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        // Changed FEATURE TITLE to Revenue Analytics
        title: const Text('Revenue Analytics', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
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
                  ? const Center(child: Text('No revenue data yet', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        // Assuming item contains 'metricName', 'value', and 'description'
                        final String metricName = item['metricName']?.toString() ?? 'Metric ${index + 1}';
                        final String description = item['description']?.toString() ?? '';
                        final double value = (item['value'] as num?)?.toDouble() ?? 0.0;

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(metricName,
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text(description,
                                style: const TextStyle(color: Color(0xFF94A3B8))),
                            trailing: Text(currencyFormatter.format(value),
                                style: const TextStyle(color: Color(0xFF6C63FF), fontWeight: FontWeight.w600)),
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
