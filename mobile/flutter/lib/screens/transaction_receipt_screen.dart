// ignore_for_file: use_build_context_synchronously
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../services/api_service.dart';

class TransactionReceiptScreen extends StatefulWidget {
  final int? transactionId;
  const TransactionReceiptScreen({super.key, this.transactionId});

  @override
  State<TransactionReceiptScreen> createState() => _TransactionReceiptScreenState();
}

class _TransactionReceiptScreenState extends State<TransactionReceiptScreen> {
  Map<String, dynamic>? _tx;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.transactionId != null) {
      _load();
    } else {
      setState(() { _loading = false; _error = 'No transaction ID provided'; });
    }
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await ApiService.get(
        '/api/trpc/transactions.getById?input=${Uri.encodeComponent('{"id":${widget.transactionId}}')}',
      );
      setState(() => _tx = data['result']?['data'] as Map<String, dynamic>?);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  void _share() {
    if (_tx == null) return;
    final lines = [
      'RemitFlow Transaction Receipt',
      '─────────────────────────',
      'Reference: ${_tx!['referenceNumber'] ?? ''}',
      'Date: ${_tx!['createdAt'] ?? ''}',
      'Amount Sent: ${_tx!['fromCurrency']} ${_tx!['fromAmount']}',
      'Amount Received: ${_tx!['toCurrency']} ${_tx!['toAmount']}',
      'Exchange Rate: 1 ${_tx!['fromCurrency']} = ${_tx!['fxRate']} ${_tx!['toCurrency']}',
      'Fee: ${_tx!['fromCurrency']} ${_tx!['fee']}',
      'Status: ${(_tx!['status'] as String? ?? '').toUpperCase()}',
      if (_tx!['recipientName'] != null) 'Recipient: ${_tx!['recipientName']}',
    ];
    Share.share(lines.join('\n'), subject: 'Transaction Receipt');
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'completed': return const Color(0xFF4ade80);
      case 'pending': return const Color(0xFFfbbf24);
      case 'failed': return const Color(0xFFf87171);
      default: return const Color(0xFF94a3b8);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0f172a),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1e293b),
        title: const Text('Receipt', style: TextStyle(color: Colors.white)),
        actions: [
          if (_tx != null)
            IconButton(
              icon: const Icon(Icons.share, color: Colors.white),
              onPressed: _share,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366f1)))
          : _error != null
              ? _buildError()
              : _buildReceipt(),
    );
  }

  Widget _buildError() => Center(
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Text('⚠️', style: TextStyle(fontSize: 40)),
        const SizedBox(height: 12),
        Text(_error!, style: const TextStyle(color: Color(0xFFf87171), fontSize: 15), textAlign: TextAlign.center),
        const SizedBox(height: 20),
        ElevatedButton(
          onPressed: _load,
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366f1)),
          child: const Text('Retry', style: TextStyle(color: Colors.white)),
        ),
      ],
    ),
  );

  Widget _buildReceipt() {
    final tx = _tx!;
    final status = tx['status'] as String? ?? 'unknown';
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          // Header
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Column(
              children: [
                Container(
                  width: 12, height: 12,
                  decoration: BoxDecoration(
                    color: _statusColor(status),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(height: 8),
                Text(status.toUpperCase(),
                    style: const TextStyle(color: Color(0xFF64748b), fontSize: 12, letterSpacing: 1.5, fontWeight: FontWeight.w700)),
                const SizedBox(height: 16),
                Text('${tx['fromCurrency']} ${tx['fromAmount']}',
                    style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('→ ${tx['toCurrency']} ${tx['toAmount']}',
                    style: const TextStyle(color: Color(0xFF6366f1), fontSize: 16, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          // Details card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFF1e293b),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFF334155)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Transaction Details',
                    style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 16),
                _row('Reference', tx['referenceNumber'] ?? '', mono: true),
                _row('Date', _formatDate(tx['createdAt'])),
                if (tx['completedAt'] != null)
                  _row('Completed', _formatDate(tx['completedAt'])),
                _row('You Sent', '${tx['fromCurrency']} ${tx['fromAmount']}'),
                _row('They Receive', '${tx['toCurrency']} ${tx['toAmount']}', highlight: true),
                _row('Exchange Rate', '1 ${tx['fromCurrency']} = ${tx['fxRate']} ${tx['toCurrency']}'),
                _row('Transfer Fee', '${tx['fromCurrency']} ${tx['fee']}'),
                if (tx['recipientName'] != null) _row('Recipient', tx['recipientName']),
                if (tx['recipientAccount'] != null) _row('Account', tx['recipientAccount'], mono: true),
                if (tx['paymentRail'] != null) _row('Payment Rail', (tx['paymentRail'] as String).toUpperCase()),
                if (tx['description'] != null) _row('Note', tx['description']),
              ],
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _share,
              icon: const Icon(Icons.share, color: Colors.white),
              label: const Text('Share Receipt', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366f1),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text('RemitFlow · Regulated payment infrastructure',
              style: TextStyle(color: Color(0xFF334155), fontSize: 12)),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool mono = false, bool highlight = false}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Color(0xFF64748b), fontSize: 13)),
        const SizedBox(width: 16),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: TextStyle(
              color: highlight ? const Color(0xFF6366f1) : const Color(0xFFcbd5e1),
              fontSize: highlight ? 15 : 13,
              fontWeight: highlight ? FontWeight.w700 : FontWeight.normal,
              fontFamily: mono ? 'monospace' : null,
            ),
          ),
        ),
      ],
    ),
  );

  String _formatDate(dynamic val) {
    if (val == null) return '';
    try {
      return DateTime.parse(val.toString()).toLocal().toString().substring(0, 16);
    } catch (_) {
      return val.toString();
    }
  }
}
