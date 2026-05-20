import 'package:flutter/material.dart';
import '../services/api_service.dart';

class MyTransfersScreen extends StatefulWidget {
  const MyTransfersScreen({super.key});
  @override
  State<MyTransfersScreen> createState() => _MyTransfersScreenState();
}

class _MyTransfersScreenState extends State<MyTransfersScreen> {
  final _api = ApiService();
  List<dynamic> _transfers = [];
  bool _loading = true;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _loadTransfers();
  }

  Future<void> _loadTransfers() async {
    try {
      final result = await _api.query('transactions.list', {'limit': 50, 'type': _filter == 'all' ? null : _filter});
      if (mounted) setState(() { _transfers = List<dynamic>.from(result['transactions'] ?? result['data'] ?? []); _loading = false; });
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
        title: const Text('My Transfers', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(icon: const Icon(Icons.refresh, color: Colors.white), onPressed: () { setState(() => _loading = true); _loadTransfers(); }),
        ],
      ),
      body: Column(
        children: [
          // Filter chips
          Container(
            color: const Color(0xFF1E293B),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: ['all', 'send', 'receive', 'pending'].map((f) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(f.toUpperCase(), style: TextStyle(color: _filter == f ? Colors.white : const Color(0xFF94A3B8), fontSize: 11)),
                  selected: _filter == f,
                  onSelected: (v) { setState(() { _filter = f; _loading = true; }); _loadTransfers(); },
                  selectedColor: const Color(0xFF6366F1),
                  backgroundColor: const Color(0xFF334155),
                  checkmarkColor: Colors.white,
                  side: BorderSide.none,
                ),
              )).toList(),
            ),
          ),
          Expanded(
            child: _loading
              ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
              : _transfers.isEmpty
                ? const Center(child: Text('No transfers found', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 16)))
                : RefreshIndicator(
                    onRefresh: () async { setState(() => _loading = true); await _loadTransfers(); },
                    color: const Color(0xFF6366F1),
                    child: ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _transfers.length,
                      itemBuilder: (context, i) {
                        final t = _transfers[i];
                        final amount = t['amount']?.toString() ?? '0';
                        final currency = t['currency'] ?? t['sourceCurrency'] ?? 'NGN';
                        final status = t['status'] ?? 'pending';
                        final type = t['type'] ?? 'send';
                        final ref = t['reference'] ?? t['id']?.toString() ?? '';
                        final statusColor = status == 'completed' ? Colors.green : status == 'failed' ? Colors.red : Colors.orange;
                        return Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
                          child: Row(
                            children: [
                              Container(
                                width: 44, height: 44,
                                decoration: BoxDecoration(color: type == 'send' ? const Color(0xFF6366F1).withOpacity(0.2) : Colors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(22)),
                                child: Icon(type == 'send' ? Icons.arrow_upward : Icons.arrow_downward, color: type == 'send' ? const Color(0xFF6366F1) : Colors.green, size: 20),
                              ),
                              const SizedBox(width: 12),
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(ref, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14)),
                                const SizedBox(height: 4),
                                Text(t['createdAt']?.toString().substring(0, 10) ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                              ])),
                              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                Text('$currency $amount', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                                const SizedBox(height: 4),
                                Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(8)), child: Text(status.toUpperCase(), style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold))),
                              ]),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}
