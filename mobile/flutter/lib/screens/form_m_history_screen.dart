import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

/// FormMHistoryScreen — v205
/// Shows the authenticated user's CBN Form M validation history.
/// Mirrors the web SmeTradeFormMHistory page.
class FormMHistoryScreen extends ConsumerStatefulWidget {
  const FormMHistoryScreen({super.key});

  @override
  ConsumerState<FormMHistoryScreen> createState() => _FormMHistoryScreenState();
}

class _FormMHistoryScreenState extends ConsumerState<FormMHistoryScreen> {
  List<dynamic> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final result = await apiService.query('smeTrade.listFormMHistory', params: {
        'limit': 50,
        'offset': 0,
      });
      if (mounted) {
        setState(() {
          _items = result is List
              ? result
              : (result?['items'] is List ? result['items'] : []);
          _loading = false;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  Color _statusColor(String? status) {
    switch (status) {
      case 'validated':
      case 'approved':
        return const Color(0xFF10B981);
      case 'rejected':
        return const Color(0xFFEF4444);
      case 'expired':
        return const Color(0xFFF59E0B);
      default:
        return const Color(0xFF6366F1);
    }
  }

  String _expiryLabel(dynamic validityDate) {
    if (validityDate == null) return '';
    try {
      final expiry = DateTime.parse(validityDate.toString());
      final now = DateTime.now();
      final diff = expiry.difference(now).inDays;
      if (diff < 0) return 'Expired';
      if (diff == 0) return 'Expires today';
      if (diff <= 14) return 'Expires in $diff days';
      return 'Valid until ${expiry.day}/${expiry.month}/${expiry.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text(
          'Form M History',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF6366F1)),
            onPressed: () {
              setState(() => _loading = true);
              _loadData();
            },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 48, color: Color(0xFFEF4444)),
                      const SizedBox(height: 12),
                      Text('Error loading data', style: const TextStyle(color: Colors.white, fontSize: 16)),
                      const SizedBox(height: 8),
                      ElevatedButton(
                        onPressed: () { setState(() { _loading = true; _error = null; }); _loadData(); },
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : _items.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: const [
                          Icon(Icons.description_outlined, size: 64, color: Color(0xFF64748B)),
                          SizedBox(height: 16),
                          Text('No Form M submissions yet', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                          SizedBox(height: 8),
                          Text('Submit a batch payment to generate\na Form M validation record.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadData,
                      color: const Color(0xFF6366F1),
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        itemBuilder: (ctx, i) {
                          final item = _items[i];
                          final status = item?['status']?.toString() ?? 'pending';
                          final cbnRef = item?['cbnReference']?.toString() ?? item?['cbm_reference']?.toString() ?? '—';
                          final amount = item?['transactionAmount'];
                          final currency = item?['currency']?.toString() ?? 'USD';
                          final validityDate = item?['validityDate'] ?? item?['validity_date'];
                          final expiryLabel = _expiryLabel(validityDate);
                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1E293B),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: const Color(0xFF334155)),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          'CBN Ref: $cbnRef',
                                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: _statusColor(status).withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(6),
                                          border: Border.all(color: _statusColor(status).withOpacity(0.4)),
                                        ),
                                        child: Text(
                                          status.toUpperCase(),
                                          style: TextStyle(color: _statusColor(status), fontSize: 11, fontWeight: FontWeight.bold),
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (amount != null) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      '$currency ${double.tryParse(amount.toString())?.toStringAsFixed(2) ?? amount}',
                                      style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                                    ),
                                  ],
                                  if (expiryLabel.isNotEmpty) ...[
                                    const SizedBox(height: 4),
                                    Row(
                                      children: [
                                        Icon(
                                          Icons.schedule,
                                          size: 13,
                                          color: expiryLabel.startsWith('Exp') ? const Color(0xFFF59E0B) : const Color(0xFF64748B),
                                        ),
                                        const SizedBox(width: 4),
                                        Text(
                                          expiryLabel,
                                          style: TextStyle(
                                            color: expiryLabel.startsWith('Exp') ? const Color(0xFFF59E0B) : const Color(0xFF64748B),
                                            fontSize: 12,
                                          ),
                                        ),
                                      ],
                                    ),
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
