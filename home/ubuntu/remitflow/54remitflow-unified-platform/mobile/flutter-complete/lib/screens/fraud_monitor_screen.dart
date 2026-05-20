import 'package:flutter/material.dart';

class FraudMonitorScreen extends StatefulWidget {
  const FraudMonitorScreen({Key? key}) : super(key: key);
  @override
  State<FraudMonitorScreen> createState() => _FraudMonitorScreenState();
}

class _FraudMonitorScreenState extends State<FraudMonitorScreen> {
  bool _isLoading = true;
  String _search = '';
  List<dynamic> _alerts = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      if (mounted) setState(() => _alerts = []);
    } catch (e) {
      debugPrint('Error loading Fraud Monitor: $e');
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
        title: const Text('Fraud Monitor', style: TextStyle(color: Colors.white)),
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
                  ..._alerts.where((a) => (a['description'] ?? '').toString().toLowerCase().contains(_search.toLowerCase())).map((a) {
                    final color = a['riskLevel'] == 'high' ? const Color(0xFFef4444) : a['riskLevel'] == 'medium' ? const Color(0xFFf59e0b) : const Color(0xFF22c55e);
                    return _card(
                      title: a['description'] ?? 'Fraud Alert',
                      subtitle: 'Risk Score: \${a['riskScore'] ?? 0}/100 · \$\${(a['amount'] ?? 0).toStringAsFixed(2)}',
                      label: a['createdAt'] ?? 'N/A',
                      borderColor: color,
                      actions: a['status'] == 'pending' ? [
                        _actionBtn('Approve', () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Approved'))), color: const Color(0xFF22c55e)),
                        const SizedBox(width: 8),
                        _actionBtn('Block', () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Blocked'))), color: const Color(0xFFef4444)),
                      ] : null,
                    );
                  }).toList(),
                  if (_alerts.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(40), child: Text('No fraud alerts. System is clean.', style: TextStyle(color: Colors.grey)))),
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
