import 'package:flutter/material.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({Key? key}) : super(key: key);
  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  bool _isLoading = true;
  String _search = '';
  Map<String, dynamic>? _info;
  List<dynamic> _leaderboard = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      if (mounted) setState(() { _info = null; _leaderboard = []; });
    } catch (e) {
      debugPrint('Error loading Referral Program: $e');
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
        title: const Text('Referral Program', style: TextStyle(color: Colors.white)),
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
                  if (_info != null) Container(
                    margin: const EdgeInsets.all(16),
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(color: const Color(0xFF1e1e2e), borderRadius: BorderRadius.circular(12), border: const Border(left: BorderSide(color: Color(0xFFf59e0b), width: 3))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('Your Referral Code', style: TextStyle(color: Colors.grey, fontSize: 13)),
                      const SizedBox(height: 8),
                      Text(_info!['referralCode'] ?? 'REMIT00', style: const TextStyle(color: Color(0xFFf59e0b), fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 4)),
                      const SizedBox(height: 8),
                      Text('\${_info!['totalReferrals'] ?? 0} referrals · \$\${(_info!['totalEarned'] ?? 0).toStringAsFixed(2)} earned', style: const TextStyle(color: Colors.grey)),
                    ]),
                  ),
                  ..._leaderboard.asMap().entries.where((e) => (e.value['name'] ?? '').toString().toLowerCase().contains(_search.toLowerCase())).map((e) => _card(
                    title: '#\${e.key + 1} \${e.value['name']}',
                    subtitle: '\${e.value['referrals']} referrals · \$\${(e.value['earned'] ?? 0).toStringAsFixed(2)} earned',
                  )).toList(),
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
