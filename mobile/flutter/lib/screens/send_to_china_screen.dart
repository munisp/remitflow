import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class SendToChinaScreen extends ConsumerStatefulWidget {
  const SendToChinaScreen({super.key});
  @override
  ConsumerState<SendToChinaScreen> createState() => _SendToChinaScreenState();
}

class _SendToChinaScreenState extends ConsumerState<SendToChinaScreen> {
  double _rate = 0;
  bool _loading = true;
  final _amountController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadRate();
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _loadRate() async {
    try {
      final result = await apiService.query('fx.getRates');
      if (mounted) {
        setState(() {
          _rate = (result is Map && result['rate'] != null) ? (result['rate'] as num).toDouble() : 7.25;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _rate = 7.25; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final amount = double.tryParse(_amountController.text) ?? 0;
    final converted = (amount * _rate).toStringAsFixed(2);
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Send to China', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const Text('🇨🇳', style: TextStyle(fontSize: 48)),
            const SizedBox(height: 8),
            const Text('Send money to China via CIPS', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Exchange Rate', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                  const SizedBox(height: 4),
                  _loading
                    ? const CircularProgressIndicator(color: Color(0xFF6366F1))
                    : Text('1 USD = ${_rate.toStringAsFixed(4)} CNY', style: const TextStyle(color: Color(0xFF6366F1), fontSize: 20, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Amount (USD)', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                  TextField(
                    controller: _amountController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white, fontSize: 18),
                    decoration: const InputDecoration(hintText: '0.00', hintStyle: TextStyle(color: Color(0xFF64748B)), border: InputBorder.none),
                    onChanged: (_) => setState(() {}),
                  ),
                  const Text('Recipient Gets (CNY)', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                  const SizedBox(height: 4),
                  Text('¥$converted', style: const TextStyle(color: Color(0xFF10B981), fontSize: 24, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1), padding: const EdgeInsets.symmetric(vertical: 16), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                onPressed: () => Navigator.pushNamed(context, '/send-money'),
                child: const Text('Continue to Send', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Why send to China via CIPS?', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                  SizedBox(height: 8),
                  Text('• CIPS settlement in 2-4 hours', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• Direct to ICBC, BOC, CCB, ABC', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• Alipay & WeChat Pay supported', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• Up to 70% cheaper than wire transfers', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• PBoC compliance handled automatically', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
