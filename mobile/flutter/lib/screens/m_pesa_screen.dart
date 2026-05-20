import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
class MPesaScreen extends ConsumerStatefulWidget {
  const MPesaScreen({super.key});
  @override
  ConsumerState<MPesaScreen> createState() => _MPesaScreenState();
}
class _MPesaScreenState extends ConsumerState<MPesaScreen> {
  List<dynamic> _items = [];
  bool _loading = true;
  @override
  void initState() {
    super.initState();
    _loadData();
  }
  Future<void> _loadData() async {
    try {
      final result = await apiService.query('mpesa.getStatus');
      if (mounted) {
        setState(() {
          _items = result is List ? result : (result != null ? [result] : []);
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
        title: const Text('M-Pesa', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _items.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.phone_android, size: 64, color: const Color(0xFF64748B)),
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
                      final name = item['name'] ?? item['title'] ?? item['id'] ?? 'Item ${index + 1}';
                      final status = item['status']?.toString();
                      final amount = item['amount'];
                      return Card(
                        color: const Color(0xFF1E293B),
                        margin: const EdgeInsets.only(bottom: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name.toString(), style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600)),
                              if (status != null) ...[
                                const SizedBox(height: 4),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(color: const Color(0xFF312E81), borderRadius: BorderRadius.circular(8)),
                                  child: Text(status, style: const TextStyle(color: Color(0xFFA5B4FC), fontSize: 12)),
                                ),
                              ],
                              if (amount != null) ...[
                                const SizedBox(height: 4),
                                Text('\$${amount}', style: const TextStyle(color: Color(0xFF10B981), fontSize: 18, fontWeight: FontWeight.bold)),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
