import 'dart:io';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/api_service.dart';
import '../services/offline_queue.dart';

class SendMoneyScreen extends StatefulWidget {
  const SendMoneyScreen({super.key});

  @override
  State<SendMoneyScreen> createState() => _SendMoneyScreenState();
}

class _SendMoneyScreenState extends State<SendMoneyScreen> {
  final _amountCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  String _fromCurrency = 'USD';
  String _toCurrency = 'NGN';
  double _rate = 1500.0;
  bool _loading = false;
  String _step = 'form';

  static const _currencies = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'CNY', 'INR', 'BRL'];

  @override
  void initState() {
    super.initState();
    _loadRates();
  }

  Future<void> _loadRates() async {
    try {
      final data = await apiService.query('paymentRails.getLiveRates', {'baseCurrency': _fromCurrency});
      final rates = data['rates'] as Map<String, dynamic>? ?? {};
      if (mounted) setState(() => _rate = double.tryParse(rates[_toCurrency]?.toString() ?? '1') ?? 1.0);
    } catch (_) {}
  }

  double get _converted => double.tryParse(_amountCtrl.text) != null ? double.parse(_amountCtrl.text) * _rate : 0;
  double get _fee => double.tryParse(_amountCtrl.text) != null ? double.parse(_amountCtrl.text) * 0.015 : 0;

  Future<bool> _checkConnectivity() async {
    try {
      final result = await InternetAddress.lookup('remitflow.com');
      return result.isNotEmpty && result[0].rawAddress.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  Future<void> _send() async {
    if (_step == 'form') { setState(() => _step = 'confirm'); return; }
    setState(() => _loading = true);

    final payload = {
      'amount': double.parse(_amountCtrl.text),
      'currency': _fromCurrency,
      'recipientEmail': _emailCtrl.text,
      'note': _noteCtrl.text,
      'rail': 'SWIFT',
    };

    final isOnline = await _checkConnectivity();
    if (!isOnline) {
      await OfflineQueue.enqueue(
        operationType: 'transfer',
        endpoint: 'transactions.send',
        payload: payload,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Transfer queued offline. Will send when connectivity is restored.'),
            backgroundColor: Colors.orange,
          ),
        );
        setState(() => _step = 'success');
      }
      return;
    }

    try {
      await apiService.mutate('transactions.send', payload);
      if (mounted) setState(() => _step = 'success');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_step == 'success') {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('✅', style: TextStyle(fontSize: 80)),
              const SizedBox(height: 16),
              const Text('Transfer Initiated!', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 8),
              Text('$_fromCurrency ${_amountCtrl.text} → $_toCurrency ${_converted.toStringAsFixed(2)}',
                  style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 16)),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: () { setState(() { _step = 'form'; _amountCtrl.clear(); _emailCtrl.clear(); }); },
                child: const Text('Send Another'),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Send Money')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: _step == 'confirm' ? _buildConfirm() : _buildForm(),
      ),
    );
  }

  Widget _buildForm() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _card(child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Amount', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
          const SizedBox(height: 8),
          TextField(controller: _amountCtrl, keyboardType: TextInputType.number,
              style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w800),
              decoration: const InputDecoration(border: InputBorder.none, hintText: '0.00', hintStyle: TextStyle(color: Color(0xFF6B7280), fontSize: 32))),
          const SizedBox(height: 12),
          Wrap(spacing: 8, children: _currencies.take(5).map((c) => _currencyChip(c, _fromCurrency, (v) { setState(() => _fromCurrency = v); _loadRates(); })).toList()),
        ],
      )),
      const SizedBox(height: 8),
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text('1 $_fromCurrency = ${_rate.toStringAsFixed(4)} $_toCurrency', style: const TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
        Text('$_toCurrency ${_converted.toStringAsFixed(2)}', style: const TextStyle(color: Color(0xFF10B981), fontSize: 16, fontWeight: FontWeight.w700)),
      ]),
      const SizedBox(height: 8),
      _card(child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Recipient receives', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: _currencies.skip(5).map((c) => _currencyChip(c, _toCurrency, (v) { setState(() => _toCurrency = v); _loadRates(); })).toList()),
        ],
      )),
      const SizedBox(height: 8),
      _card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Recipient email *', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
        const SizedBox(height: 8),
        TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress,
            style: const TextStyle(color: Colors.white), decoration: const InputDecoration(hintText: 'recipient@example.com', border: InputBorder.none)),
      ])),
      const SizedBox(height: 8),
      _card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Note (optional)', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
        const SizedBox(height: 8),
        TextField(controller: _noteCtrl, style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(hintText: "What's this for?", border: InputBorder.none)),
      ])),
      const SizedBox(height: 8),
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        const Text('Fee (1.5%)', style: TextStyle(color: Color(0xFF6B7280))),
        Text('$_fromCurrency ${_fee.toStringAsFixed(2)}', style: const TextStyle(color: Color(0xFFF59E0B), fontWeight: FontWeight.w600)),
      ]),
      const SizedBox(height: 16),
      SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _send, child: const Text('Review Transfer'))),
    ],
  );

  Widget _buildConfirm() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('Confirm Transfer', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white)),
      const SizedBox(height: 20),
      _card(child: Column(children: [
        _confirmRow('Amount', '$_fromCurrency ${_amountCtrl.text}'),
        _confirmRow('Recipient receives', '$_toCurrency ${_converted.toStringAsFixed(2)}', valueColor: const Color(0xFF10B981)),
        _confirmRow('Fee', '$_fromCurrency ${_fee.toStringAsFixed(2)}'),
        _confirmRow('To', _emailCtrl.text),
        _confirmRow('Rate', '1 $_fromCurrency = ${_rate.toStringAsFixed(4)} $_toCurrency'),
      ])),
      const SizedBox(height: 16),
      Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => setState(() => _step = 'form'), child: const Text('Edit'))),
        const SizedBox(width: 12),
        Expanded(child: ElevatedButton(
          onPressed: _loading ? null : _send,
          child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Confirm Send'),
        )),
      ]),
    ],
  );

  Widget _card({required Widget child}) => Container(
    width: double.infinity, padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF2D2D4E))),
    child: child,
  );

  Widget _currencyChip(String currency, String selected, void Function(String) onTap) => GestureDetector(
    onTap: () => onTap(currency),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: selected == currency ? const Color(0xFF6366F1) : const Color(0xFF0F0F1A),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: selected == currency ? const Color(0xFF6366F1) : const Color(0xFF2D2D4E)),
      ),
      child: Text(currency, style: TextStyle(color: selected == currency ? Colors.white : const Color(0xFF9CA3AF), fontSize: 13, fontWeight: FontWeight.w600)),
    ),
  );

  Widget _confirmRow(String label, String value, {Color? valueColor}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 14)),
      Text(value, style: TextStyle(color: valueColor ?? const Color(0xFFE2E8F0), fontSize: 14, fontWeight: FontWeight.w600)),
    ]),
  );
}
