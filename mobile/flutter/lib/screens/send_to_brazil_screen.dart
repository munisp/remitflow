import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class SendToBrazilScreen extends ConsumerStatefulWidget {
  const SendToBrazilScreen({super.key});
  @override
  ConsumerState<SendToBrazilScreen> createState() => _SendToBrazilScreenState();
}

class _SendToBrazilScreenState extends ConsumerState<SendToBrazilScreen> {
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
          _rate = (result is Map && result['rate'] != null) ? (result['rate'] as num).toDouble() : 5.15;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _rate = 5.15; _loading = false; });
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
        title: const Text('Send to Brazil', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const Text('🇧🇷', style: TextStyle(fontSize: 48)),
            const SizedBox(height: 8),
            const Text('Instant PIX transfers to Brazil', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
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
                    : Text('1 USD = ${_rate.toStringAsFixed(4)} BRL', style: const TextStyle(color: Color(0xFF6366F1), fontSize: 20, fontWeight: FontWeight.bold)),
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
                  const Text('Recipient Gets (BRL)', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                  const SizedBox(height: 4),
                  Text('R\$$converted', style: const TextStyle(color: Color(0xFF10B981), fontSize: 24, fontWeight: FontWeight.bold)),
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
                  Text('Why send to Brazil via PIX?', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                  SizedBox(height: 8),
                  Text('• PIX instant — arrives in seconds', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• 24/7 including weekends & holidays', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• Send to CPF, email, phone, or EVP key', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• All banks: Itaú, Nubank, Bradesco', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                  SizedBox(height: 4),
                  Text('• Flat fee from \$2.99', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
