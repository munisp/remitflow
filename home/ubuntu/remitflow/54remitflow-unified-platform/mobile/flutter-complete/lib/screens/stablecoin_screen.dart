import 'package:flutter/material.dart';

class StablecoinScreen extends StatefulWidget {
  const StablecoinScreen({Key? key}) : super(key: key);
  @override
  State<StablecoinScreen> createState() => _StablecoinScreenState();
}

class _StablecoinScreenState extends State<StablecoinScreen> {
  bool _isLoading = true;
  String _search = '';
  List<dynamic> _balances = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      if (mounted) setState(() => _balances = []);
    } catch (e) {
      debugPrint('Error loading Stablecoin Wallet: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0f0f1a),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1e1e2e),
        title: const Text('Stablecoin Wallet', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366f1)))
          : Column(children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: TextField(
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Search...',
                    hintStyle: const TextStyle(color: Colors.grey),
                    filled: true,
                    fillColor: const Color(0xFF1e1e2e),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                    prefixIcon: const Icon(Icons.search, color: Colors.grey),
                  ),
                  onChanged: (v) => setState(() => _search = v),
                ),
              ),
              Expanded(child: RefreshIndicator(
                onRefresh: _loadData,
                child: ListView(children: [
                  ..._balances.where((b) => (b['symbol'] ?? '').toString().toLowerCase().contains(_search.toLowerCase())).map((b) => _card(
                    title: b['symbol'] ?? 'Token',
                    subtitle: b['network'] ?? 'Ethereum',
                    amount: (b['balance'] ?? 0).toStringAsFixed(4),
                    actions: [
                      _actionBtn('Send', () => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Send \${b['symbol']}')))),
                      const SizedBox(width: 8),
                      _actionBtn('Receive', () => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Receive \${b['symbol']}'))), color: const Color(0xFF22c55e)),
                    ],
                  )).toList(),
                  if (_balances.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(40), child: Text('No stablecoin wallets.', style: TextStyle(color: Colors.grey)))),
                ]),
              )),
            ]),
    );
  }

  Widget _card({required String title, String? subtitle, String? amount, String? label, Color? borderColor, List<Widget>? actions}) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1e1e2e),
        borderRadius: BorderRadius.circular(12),
        border: borderColor != null ? Border(left: BorderSide(color: borderColor, width: 3)) : null,
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
        if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle, style: const TextStyle(color: Colors.grey, fontSize: 13))],
        if (amount != null) ...[const SizedBox(height: 8), Text(amount, style: const TextStyle(color: Color(0xFF6366f1), fontSize: 22, fontWeight: FontWeight.bold))],
        if (label != null) ...[const SizedBox(height: 4), Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12))],
        if (actions != null) ...[const SizedBox(height: 12), Row(children: actions)],
      ]),
    );
  }

  Widget _badge(String text, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
    child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
  );

  Widget _actionBtn(String label, VoidCallback onPressed, {Color? color}) => Expanded(
    child: ElevatedButton(
      onPressed: onPressed,
      style: ElevatedButton.styleFrom(backgroundColor: color ?? const Color(0xFF6366f1), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
      child: Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
    ),
  );
}
