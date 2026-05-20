import 'package:flutter/material.dart';
import '../services/api_service.dart';

class PaymentRailsScreen extends StatefulWidget {
  const PaymentRailsScreen({super.key});
  @override
  State<PaymentRailsScreen> createState() => _PaymentRailsScreenState();
}

class _PaymentRailsScreenState extends State<PaymentRailsScreen> {
  Map<String, dynamic> _rates = {};
  bool _loading = true;
  String _selected = 'SWIFT';

  static const _rails = [
    ('CIPS', '🇨🇳', 'China Cross-Border Interbank Payment', Color(0xFFEF4444)),
    ('UPI', '🇮🇳', 'Unified Payments Interface', Color(0xFFF97316)),
    ('PIX', '🇧🇷', 'Brazilian Instant Payment', Color(0xFF22C55E)),
    ('SWIFT', '🌐', 'International Wire Transfer', Color(0xFF3B82F6)),
    ('SEPA', '🇪🇺', 'Single Euro Payments Area', Color(0xFF6366F1)),
    ('MOJALOOP', '🌍', 'Open-source inclusive payments', Color(0xFF8B5CF6)),
  ];

  @override
  void initState() { super.initState(); _loadRates(); }

  Future<void> _loadRates() async {
    try {
      final data = await apiService.query('paymentRails.getLiveRates', {'baseCurrency': 'USD'});
      setState(() { _rates = data['rates'] as Map<String, dynamic>? ?? {}; _loading = false; });
    } catch (e) { setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payment Rails')),
      body: _loading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : ListView(padding: const EdgeInsets.all(16), children: [
              ..._rails.map((r) => GestureDetector(
                onTap: () => setState(() => _selected = r.$1),
                child: Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A2E),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: _selected == r.$1 ? const Color(0xFF6366F1) : const Color(0xFF2D2D4E), width: _selected == r.$1 ? 2 : 1),
                  ),
                  child: Row(children: [
                    Text(r.$2, style: const TextStyle(fontSize: 32)),
                    const SizedBox(width: 12),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(r.$1, style: TextStyle(color: r.$4, fontSize: 16, fontWeight: FontWeight.w700)),
                      Text(r.$3, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
                    ])),
                    Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(color: const Color(0xFF10B981).withOpacity(0.1), borderRadius: BorderRadius.circular(20)),
                        child: const Text('● Active', style: TextStyle(color: Color(0xFF10B981), fontSize: 12, fontWeight: FontWeight.w600))),
                  ]),
                ),
              )),
              const Text('Live Exchange Rates (USD)', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Colors.white)),
              const SizedBox(height: 12),
              Container(
                decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(16)),
                child: Column(children: _rates.entries.take(10).map((e) => ListTile(
                  title: Text(e.key, style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                  trailing: Text(double.tryParse(e.value.toString())?.toStringAsFixed(4) ?? e.value.toString(),
                      style: const TextStyle(color: Color(0xFF9CA3AF))),
                )).toList()),
              ),
            ]),
    );
  }
}
