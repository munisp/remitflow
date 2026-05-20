// ignore_for_file: use_build_context_synchronously
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import '../services/api_service.dart';

class RequestMoneyScreen extends StatefulWidget {
  const RequestMoneyScreen({super.key});

  @override
  State<RequestMoneyScreen> createState() => _RequestMoneyScreenState();
}

class _RequestMoneyScreenState extends State<RequestMoneyScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _amountCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  String _currency = 'USD';
  bool _loading = false;
  Map<String, dynamic>? _created;
  List<Map<String, dynamic>> _requests = [];
  bool _listLoading = false;

  static const _currencies = ['USD', 'GBP', 'EUR', 'NGN', 'KES', 'GHS', 'ZAR'];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (_tabController.index == 1) _loadRequests();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _amountCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    if (_descCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a description')),
      );
      return;
    }
    setState(() => _loading = true);
    try {
      final body = {
        'currency': _currency,
        'description': _descCtrl.text.trim(),
        'expiresInHours': 72,
        if (_amountCtrl.text.isNotEmpty)
          'amount': double.tryParse(_amountCtrl.text),
      };
      final data = await ApiService.post('/api/trpc/requestMoney.create', body);
      setState(() {
        _created = data['result']?['data'] as Map<String, dynamic>?;
        _amountCtrl.clear();
        _descCtrl.clear();
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e')),
      );
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _loadRequests() async {
    setState(() => _listLoading = true);
    try {
      final data = await ApiService.get('/api/trpc/requestMoney.list');
      final items = (data['result']?['data']?['items'] as List?) ?? [];
      setState(() => _requests = items.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      setState(() => _listLoading = false);
    }
  }

  Future<void> _cancel(int id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF1e293b),
        title: const Text('Cancel Request', style: TextStyle(color: Colors.white)),
        content: const Text('Are you sure?', style: TextStyle(color: Color(0xFF94a3b8))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('No')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Yes', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ApiService.post('/api/trpc/requestMoney.cancel', {'id': id});
      setState(() {
        _requests = _requests.map((r) {
          if (r['id'] == id) return {...r, 'status': 'cancelled'};
          return r;
        }).toList();
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'paid': return const Color(0xFF4ade80);
      case 'pending': return const Color(0xFFfbbf24);
      case 'expired': return const Color(0xFFf87171);
      default: return const Color(0xFF94a3b8);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0f172a),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1e293b),
        title: const Text('Request Money', style: TextStyle(color: Colors.white)),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF6366f1),
          labelColor: Colors.white,
          unselectedLabelColor: const Color(0xFF94a3b8),
          tabs: const [Tab(text: 'Create Request'), Tab(text: 'My Requests')],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [_buildCreateTab(), _buildListTab()],
      ),
    );
  }

  Widget _buildCreateTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Generate a payment link to share with anyone.',
              style: TextStyle(color: Color(0xFF94a3b8), fontSize: 14)),
          const SizedBox(height: 24),
          _label('Amount (optional)'),
          _input(_amountCtrl, 'Leave blank for any amount', keyboardType: TextInputType.number),
          const SizedBox(height: 16),
          _label('Currency'),
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _currencies.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final c = _currencies[i];
                final active = c == _currency;
                return GestureDetector(
                  onTap: () => setState(() => _currency = c),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      color: active ? const Color(0xFF6366f1) : const Color(0xFF1e293b),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: active ? const Color(0xFF6366f1) : const Color(0xFF334155),
                      ),
                    ),
                    child: Text(c,
                        style: TextStyle(
                          color: active ? Colors.white : const Color(0xFF94a3b8),
                          fontWeight: FontWeight.w600,
                        )),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          _label('Description *'),
          _input(_descCtrl, 'e.g. Monthly rent, Dinner split', maxLines: 3),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _loading ? null : _create,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366f1),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: _loading
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Text('Generate Payment Link', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
            ),
          ),
          if (_created != null) ...[
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFF0f2d1a),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFF16a34a)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('✅ Payment Link Created!',
                      style: TextStyle(color: Color(0xFF4ade80), fontWeight: FontWeight.w700, fontSize: 16)),
                  const SizedBox(height: 12),
                  Text(_created!['payLink'] ?? '',
                      style: const TextStyle(color: Color(0xFF94a3b8), fontSize: 12, fontFamily: 'monospace')),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () => Share.share('Pay me via RemitFlow: ${_created!['payLink']}'),
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366f1)),
                          child: const Text('Share', style: TextStyle(color: Colors.white)),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: _created!['payLink'] ?? ''));
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Link copied!')),
                            );
                          },
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0ea5e9)),
                          child: const Text('Copy', style: TextStyle(color: Colors.white)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildListTab() {
    if (_listLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFF6366f1)));
    }
    if (_requests.isEmpty) {
      return const Center(
        child: Text('No payment requests yet.', style: TextStyle(color: Color(0xFF64748b), fontSize: 15)),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _requests.length,
      itemBuilder: (_, i) {
        final req = _requests[i];
        final status = req['status'] as String? ?? 'pending';
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF1e293b),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF334155)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(req['description'] ?? 'Payment Request',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: _statusColor(status).withOpacity(0.2),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(status.toUpperCase(),
                        style: TextStyle(color: _statusColor(status), fontSize: 11, fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
              if (req['amount'] != null) ...[
                const SizedBox(height: 8),
                Text('${req['currency']} ${req['amount']}',
                    style: const TextStyle(color: Color(0xFF6366f1), fontSize: 18, fontWeight: FontWeight.w700)),
              ],
              if (status == 'pending') ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Share.share('Pay me via RemitFlow: ${req['payLink']}'),
                        style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFF6366f1)),
                        child: const Text('Share'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _cancel(req['id'] as int),
                        style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                        child: const Text('Cancel'),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(text, style: const TextStyle(color: Color(0xFFcbd5e1), fontSize: 14, fontWeight: FontWeight.w600)),
  );

  Widget _input(TextEditingController ctrl, String hint, {TextInputType? keyboardType, int maxLines = 1}) =>
    TextField(
      controller: ctrl,
      keyboardType: keyboardType,
      maxLines: maxLines,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFF9ca3af)),
        filled: true,
        fillColor: const Color(0xFF1e293b),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF334155)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF334155)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF6366f1)),
        ),
      ),
    );
}
