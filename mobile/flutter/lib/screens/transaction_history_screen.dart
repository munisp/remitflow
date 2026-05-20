import 'package:flutter/material.dart';
import '../services/api_service.dart';

class TransactionHistoryScreen extends StatefulWidget {
  const TransactionHistoryScreen({super.key});
  @override
  State<TransactionHistoryScreen> createState() => _TransactionHistoryScreenState();
}

class _TransactionHistoryScreenState extends State<TransactionHistoryScreen> {
  List<dynamic> _transactions = [];
  bool _loading = true;
  int _page = 1;
  bool _hasMore = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await apiService.query('transactions.list', {'limit': 20, 'page': _page});
      setState(() {
        _transactions = data['items'] as List? ?? [];
        _hasMore = data['hasMore'] as bool? ?? false;
        _loading = false;
      });
    } catch (e) { setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Transaction History')),
      body: _loading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _transactions.length + 1,
              itemBuilder: (ctx, i) {
                if (i == _transactions.length) {
                  return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    TextButton(onPressed: _page > 1 ? () { setState(() => _page--); _load(); } : null, child: const Text('← Prev')),
                    Text('Page $_page', style: const TextStyle(color: Color(0xFF9CA3AF))),
                    TextButton(onPressed: _hasMore ? () { setState(() => _page++); _load(); } : null, child: const Text('Next →')),
                  ]);
                }
                final tx = _transactions[i] as Map<String, dynamic>;
                final isReceive = tx['type'] == 'receive';
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(12)),
                  child: Row(children: [
                    CircleAvatar(backgroundColor: const Color(0xFF2D2D4E), radius: 20,
                        child: Text(isReceive ? '↙' : '↗', style: const TextStyle(color: Color(0xFF6366F1)))),
                    const SizedBox(width: 12),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tx['description']?.toString() ?? '${tx['type']} transfer',
                          style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 14, fontWeight: FontWeight.w600)),
                      Text('${tx['status']} · ${tx['createdAt']?.toString().substring(0, 10) ?? ''}',
                          style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
                    ])),
                    Text('${isReceive ? '+' : '-'}${tx['currency']} ${double.tryParse(tx['amount']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00'}',
                        style: TextStyle(color: isReceive ? const Color(0xFF10B981) : const Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
                  ]),
                );
              },
            ),
    );
  }
}
