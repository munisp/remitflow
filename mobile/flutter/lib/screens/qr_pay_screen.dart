import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class QrPayScreen extends ConsumerStatefulWidget {
  const QrPayScreen({super.key});
  @override
  ConsumerState<QrPayScreen> createState() => _QrPayScreenState();
}

class _QrPayScreenState extends ConsumerState<QrPayScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('/trpc/qrPay.codes');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('QR Pay', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Color(0xFF6366F1)),
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: const Color(0xFF2D2D4E)),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Text('⚠️', style: TextStyle(fontSize: 40)),
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF)), textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : _items.isEmpty
                  ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Text('📷', style: TextStyle(fontSize: 48)),
                      const SizedBox(height: 12),
                      const Text('No QR Pay yet', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 16)),
                    ]))
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: const Color(0xFF6366F1),
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          return Card(
                            color: const Color(0xFF1A1A2E),
                            margin: const EdgeInsets.only(bottom: 12),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                              side: const BorderSide(color: Color(0xFF2D2D4E)),
                            ),
                            child: ListTile(
                              contentPadding: const EdgeInsets.all(16),
                              title: Text(
                                item['name']?.toString() ?? item['id']?.toString() ?? 'Item ${index + 1}',
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600),
                              ),
                              subtitle: item['status'] != null
                                  ? Text(item['status'].toString(), style: const TextStyle(color: Color(0xFF9CA3AF)))
                                  : null,
                              trailing: const Icon(Icons.chevron_right, color: Color(0xFF6366F1)),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
