import 'package:flutter/material.dart';

class SavingsGoalsScreen extends StatefulWidget {
  const SavingsGoalsScreen({Key? key}) : super(key: key);
  @override
  State<SavingsGoalsScreen> createState() => _SavingsGoalsScreenState();
}

class _SavingsGoalsScreenState extends State<SavingsGoalsScreen> {
  bool _isLoading = true;
  String _search = '';
  List<dynamic> _goals = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      // In production: fetch from /api/trpc/savings.list
      await Future.delayed(const Duration(milliseconds: 300));
      if (mounted) setState(() => _goals = []);
    } catch (e) {
      debugPrint('Error loading Savings Goals: $e');
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
        title: const Text('Savings Goals', style: TextStyle(color: Colors.white)),
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
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: ElevatedButton.icon(
                      onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Create goals from the web app'))),
                      icon: const Icon(Icons.add),
                      label: const Text('New Savings Goal'),
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366f1), minimumSize: const Size.fromHeight(44)),
                    ),
                  ),
                  ..._goals.where((g) => (g['name'] ?? '').toString().toLowerCase().contains(_search.toLowerCase())).map((g) {
                    final progress = ((g['currentAmount'] ?? 0) / ((g['targetAmount'] ?? 1) as num)).clamp(0.0, 1.0);
                    return _card(
                      title: g['name'] ?? 'Goal',
                      subtitle: '\${g['currency'] ?? 'USD'} \${(g['currentAmount'] ?? 0).toStringAsFixed(2)} of \${(g['targetAmount'] ?? 0).toStringAsFixed(2)}',
                      label: '\${(progress * 100).toStringAsFixed(0)}% complete',
                    );
                  }).toList(),
                  if (_goals.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(40), child: Text('No savings goals yet.', style: TextStyle(color: Colors.grey)))),
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
