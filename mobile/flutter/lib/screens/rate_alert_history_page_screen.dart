import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class RateAlertHistoryPageScreen extends ConsumerStatefulWidget {
  const RateAlertHistoryPageScreen({super.key});
  @override
  ConsumerState<RateAlertHistoryPageScreen> createState() => _RateAlertHistoryPageScreenState();
}
class _RateAlertHistoryPageScreenState extends ConsumerState<RateAlertHistoryPageScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('/trpc/rateAlert.list');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Rate Alert History', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
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
                  ? const Center(child: Text('No rate alerts found', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        final currencyPair = item['currencyPair']?.toString() ?? 'N/A';
                        final rate = item['rate']?.toString() ?? 'N/A';
                        final alertType = item['alertType']?.toString() ?? 'N/A';
                        final status = item['status']?.toString() ?? 'N/A';
                        final timestamp = item['timestamp'] != null
                            ? DateTime.parse(item['timestamp']).toLocal().toString().split('.')[0]
                            : 'N/A';

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text('$currencyPair @ $rate', // Display currency pair and rate
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text('Type: $alertType, Status: $status\nTriggered: $timestamp', // Display alert type, status, and timestamp
                                style: const TextStyle(color: Color(0xFF94A3B8))),
                            trailing: const Icon(Icons.chevron_right, color: Color(0xFF6C63FF)),
                            isThreeLine: true, // Allow for more text in subtitle
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
