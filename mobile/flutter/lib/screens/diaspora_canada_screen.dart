import 'package:flutter/material.dart';

class DiasporaCanadaScreen extends StatefulWidget {
  const DiasporaCanadaScreen({super.key});

  @override
  State<DiasporaCanadaScreen> createState() => _DiasporaCanadaScreenState();
}

class _DiasporaCanadaScreenState extends State<DiasporaCanadaScreen> {
  final _amountController = TextEditingController(text: '500');
  double _cadToNgn = 1185.50;
  double _fee = 7.50;

  double get _sendAmount => double.tryParse(_amountController.text) ?? 0;
  double get _receiveAmount => (_sendAmount - _fee) * _cadToNgn;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Send to Nigeria — Canada'),
        backgroundColor: const Color(0xFF1A237E),
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Rate card
            Card(
              color: const Color(0xFF1A237E),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('Exchange Rate', style: TextStyle(color: Colors.white70, fontSize: 12)),
                      Text('1 CAD = ₦${_cadToNgn.toStringAsFixed(2)}',
                          style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                    ]),
                    Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      const Text('Fee', style: TextStyle(color: Colors.white70, fontSize: 12)),
                      Text('CAD ${_fee.toStringAsFixed(2)}',
                          style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                    ]),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Send amount
            const Text('You Send (CAD)', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            TextField(
              controller: _amountController,
              keyboardType: TextInputType.number,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                prefixText: 'CAD ',
                border: OutlineInputBorder(),
                suffixText: '🇨🇦',
              ),
            ),
            const SizedBox(height: 16),

            // Receive amount
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.green.shade200),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Recipient Gets', style: TextStyle(fontWeight: FontWeight.bold)),
                  Text('₦${_receiveAmount.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}',
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.green)),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Recipient details
            const Text('Recipient Details', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const TextField(decoration: InputDecoration(labelText: 'Full Name', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            const TextField(decoration: InputDecoration(labelText: 'Bank Name', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            const TextField(decoration: InputDecoration(labelText: 'Account Number', border: OutlineInputBorder())),
            const SizedBox(height: 24),

            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {},
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF1A237E),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: const Text('Continue', style: TextStyle(fontSize: 16)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }
}
