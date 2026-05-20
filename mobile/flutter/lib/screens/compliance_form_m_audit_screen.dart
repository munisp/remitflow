import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

/// ComplianceFormMAuditScreen — v205
/// Admin-only screen for compliance officers to audit Form M submissions.
/// Mirrors the web ComplianceFormMAudit page.
class ComplianceFormMAuditScreen extends ConsumerStatefulWidget {
  const ComplianceFormMAuditScreen({super.key});

  @override
  ConsumerState<ComplianceFormMAuditScreen> createState() => _ComplianceFormMAuditScreenState();
}

class _ComplianceFormMAuditScreenState extends ConsumerState<ComplianceFormMAuditScreen> {
  List<dynamic> _items = [];
  bool _loading = true;
  String? _error;
  String _statusFilter = 'all';
  int _page = 0;
  static const int _pageSize = 20;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final result = await apiService.query('smeTrade.listFormMDocumentsAdmin', params: {
        'limit': _pageSize,
        'offset': _page * _pageSize,
        if (_statusFilter != 'all') 'status': _statusFilter,
      });
      if (mounted) {
        setState(() {
          final newItems = result is List
              ? result
              : (result?['items'] is List ? result['items'] : []);
          _items = _page == 0 ? newItems : [..._items, ...newItems];
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

  Future<void> _showReviewDialog(dynamic item) async {
    String? selectedStatus = item?['status']?.toString() ?? 'pending';
    final noteController = TextEditingController();
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Review Form M', style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('CBN Ref: ${item?['cbnReference'] ?? '—'}', style: const TextStyle(color: Color(0xFF94A3B8))),
            const SizedBox(height: 16),
            const Text('Status', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
            const SizedBox(height: 6),
            StatefulBuilder(builder: (ctx2, setInner) => DropdownButton<String>(
              value: selectedStatus,
              dropdownColor: const Color(0xFF1E293B),
              style: const TextStyle(color: Colors.white),
              items: ['pending', 'validated', 'approved', 'rejected', 'expired']
                  .map((s) => DropdownMenuItem(value: s, child: Text(s.toUpperCase())))
                  .toList(),
              onChanged: (v) { setInner(() => selectedStatus = v); },
            )),
            const SizedBox(height: 12),
            TextField(
              controller: noteController,
              maxLines: 3,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Audit note',
                labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF334155))),
                focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF6366F1))),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF94A3B8))),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1)),
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                await apiService.mutate('smeTrade.updateFormMStatus', params: {
                  'id': item?['id'],
                  'status': selectedStatus,
                  'auditNote': noteController.text.trim(),
                });
                setState(() => _loading = true);
                _page = 0;
                _loadData();
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Status updated'), backgroundColor: Color(0xFF10B981)),
                  );
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Error: $e'), backgroundColor: const Color(0xFFEF4444)),
                  );
                }
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Form M Audit', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF6366F1)),
            onPressed: () { setState(() { _loading = true; _page = 0; }); _loadData(); },
          ),
        ],
      ),
      body: Column(
        children: [
          // Status filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: ['all', 'pending', 'validated', 'approved', 'rejected', 'expired'].map((s) {
                final selected = _statusFilter == s;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(s.toUpperCase(), style: TextStyle(color: selected ? Colors.white : const Color(0xFF94A3B8), fontSize: 11)),
                    selected: selected,
                    onSelected: (_) {
                      setState(() { _statusFilter = s; _page = 0; _loading = true; });
                      _loadData();
                    },
                    backgroundColor: const Color(0xFF1E293B),
                    selectedColor: const Color(0xFF6366F1),
                    checkmarkColor: Colors.white,
                    side: BorderSide(color: selected ? const Color(0xFF6366F1) : const Color(0xFF334155)),
                  ),
                );
              }).toList(),
            ),
          ),
          Expanded(
            child: _loading && _items.isEmpty
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
                : _error != null
                    ? Center(child: Text('Error: $_error', style: const TextStyle(color: Color(0xFFEF4444))))
                    : _items.isEmpty
                        ? const Center(child: Text('No Form M submissions found', style: TextStyle(color: Color(0xFF94A3B8))))
                        : RefreshIndicator(
                            onRefresh: () async { setState(() { _page = 0; }); await _loadData(); },
                            color: const Color(0xFF6366F1),
                            child: ListView.builder(
                              padding: const EdgeInsets.symmetric(horizontal: 16),
                              itemCount: _items.length,
                              itemBuilder: (ctx, i) {
                                final item = _items[i];
                                final status = item?['status']?.toString() ?? 'pending';
                                final cbnRef = item?['cbnReference']?.toString() ?? '—';
                                final amount = item?['transactionAmount'];
                                final currency = item?['currency']?.toString() ?? 'USD';
                                final userName = item?['user']?['name']?.toString() ?? item?['userId']?.toString() ?? '—';
                                return Container(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF1E293B),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: const Color(0xFF334155)),
                                  ),
                                  child: ListTile(
                                    contentPadding: const EdgeInsets.all(14),
                                    title: Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            'CBN: $cbnRef',
                                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: _statusColor(status).withOpacity(0.15),
                                            borderRadius: BorderRadius.circular(5),
                                            border: Border.all(color: _statusColor(status).withOpacity(0.4)),
                                          ),
                                          child: Text(status.toUpperCase(), style: TextStyle(color: _statusColor(status), fontSize: 10, fontWeight: FontWeight.bold)),
                                        ),
                                      ],
                                    ),
                                    subtitle: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        const SizedBox(height: 4),
                                        Text('User: $userName', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                                        if (amount != null)
                                          Text('$currency ${double.tryParse(amount.toString())?.toStringAsFixed(2) ?? amount}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
                                      ],
                                    ),
                                    trailing: IconButton(
                                      icon: const Icon(Icons.rate_review_outlined, color: Color(0xFF6366F1)),
                                      onPressed: () => _showReviewDialog(item),
                                    ),
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
