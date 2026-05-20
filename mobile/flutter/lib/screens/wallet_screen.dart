import 'package:flutter/material.dart';
import '../services/api_service.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});
  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  List<dynamic> _wallets = [];
  bool _loading = true;

  static const _flags = {'USD': '🇺🇸', 'EUR': '🇪🇺', 'GBP': '🇬🇧', 'NGN': '🇳🇬', 'KES': '🇰🇪', 'GHS': '🇬🇭', 'ZAR': '🇿🇦', 'CNY': '🇨🇳', 'INR': '🇮🇳', 'BRL': '🇧🇷'};

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final data = await apiService.query('wallet.list');
      setState(() { _wallets = data as List? ?? []; _loading = false; });
    } catch (e) { setState(() => _loading = false); }
  }

  double get _total => _wallets.fold(0.0, (s, w) => s + (double.tryParse((w as Map)['balanceUsd']?.toString() ?? '0') ?? 0));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Wallets')),
      body: _loading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    width: double.infinity, padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]), borderRadius: BorderRadius.circular(20)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('Total Portfolio (USD)', style: TextStyle(color: Colors.white70, fontSize: 13)),
                      Text('\$${_total.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w800)),
                    ]),
                  ),
                  const SizedBox(height: 16),
                  ..._wallets.map((w) {
                    final wallet = w as Map<String, dynamic>;
                    return Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF2D2D4E))),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(_flags[wallet['currency']] ?? '💱', style: const TextStyle(fontSize: 32)),
                        const SizedBox(height: 8),
                        Text(wallet['currency']?.toString() ?? '', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 13, fontWeight: FontWeight.w600)),
                        Text(double.tryParse(wallet['balance']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00',
                            style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800)),
                        Text('\$${double.tryParse(wallet['balanceUsd']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00'} USD',
                            style: const TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
                        const SizedBox(height: 16),
                        Row(children: [
                          Expanded(child: ElevatedButton(onPressed: () {}, child: const Text('Top Up'))),
                          const SizedBox(width: 8),
                          Expanded(child: OutlinedButton(onPressed: () {}, child: const Text('Withdraw'))),
                        ]),
                      ]),
                    );
                  }),
                ],
              ),
            ),
    );
  }
}
