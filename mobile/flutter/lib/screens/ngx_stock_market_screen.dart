import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class NGXStockMarketScreen extends ConsumerStatefulWidget {
  const NGXStockMarketScreen({super.key});
  @override
  ConsumerState<NGXStockMarketScreen> createState() => _NGXStockMarketScreenState();
}

class _NGXStockMarketScreenState extends ConsumerState<NGXStockMarketScreen> {
  List<dynamic> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final result = await _api.query('ngxStockMarket.getQuotes');
      if (mounted) {
        setState(() {
          _items = List<dynamic>.from(result['quotes'] ?? result['data'] ?? result['result'] ?? []);
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('NGX Stock Market', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _items.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.inbox_outlined, size: 64, color: Color(0xFF64748B)),
                      const SizedBox(height: 16),
                      const Text('No data available', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      const Text('Pull down to refresh', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () async { setState(() => _loading = true); await _loadData(); },
                  color: const Color(0xFF6366F1),
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length > 20 ? 20 : _items.length,
                    itemBuilder: (context, index) {
                      final item = _items[index];
                      final id = item['id']?.toString() ?? '\${index + 1}';
                      final name = item['name'] ?? item['title'] ?? item['id'] ?? 'Item \${index + 1}';
                      final status = item['status']?.toString();
                      final amount = item['amount'];
                      return Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1E293B),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(name.toString(), style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600)),
                            if (status != null) ...[
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: const Color(0xFF1E1B4B), borderRadius: BorderRadius.circular(6)),
                                child: Text(status, style: const TextStyle(color: Color(0xFF6366F1), fontSize: 12)),
                              ),
                            ],
                            if (amount != null) ...[
                              const SizedBox(height: 4),
                              Text('\$\${amount}', style: const TextStyle(color: Color(0xFF10B981), fontSize: 18, fontWeight: FontWeight.bold)),
                            ],
                          ],
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
