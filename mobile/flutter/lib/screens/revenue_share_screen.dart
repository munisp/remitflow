import 'package:flutter/material.dart';
import '../services/api_service.dart';

class RevenueShareScreen extends StatefulWidget {
  const RevenueShareScreen({super.key});
  @override
  State<RevenueShareScreen> createState() => _RevenueShareScreenState();
}

class _RevenueShareScreenState extends State<RevenueShareScreen> {
  Map<String, dynamic> _summary = {};
  List<dynamic> _payouts = [];
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final summary = await apiService.query('revenueShare.getSummary');
      final payouts = await apiService.query('revenueShare.getPayouts', {'limit': 10});
      setState(() { _summary = summary; _payouts = payouts as List? ?? []; _loading = false; });
    } catch (e) { setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final pending = double.tryParse(_summary['pendingPayout']?.toString() ?? '0') ?? 0;
    return Scaffold(
      appBar: AppBar(title: const Text('Revenue Share')),
      body: _loading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : ListView(padding: const EdgeInsets.all(16), children: [
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]), borderRadius: BorderRadius.circular(20)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Total Earned', style: TextStyle(color: Colors.white70, fontSize: 13)),
                  Text('\$${double.tryParse(_summary['totalEarned']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00'}',
                      style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 16),
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    _stat('Pending', '\$${pending.toStringAsFixed(2)}'),
                    _stat('This Month', '\$${double.tryParse(_summary['thisMonth']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00'}'),
                    _stat('Tier', _summary['tier']?.toString() ?? 'Bronze', color: const Color(0xFFF59E0B)),
                  ]),
                ]),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: pending >= 50 ? const Color(0xFF10B981) : const Color(0xFF1A1A2E)),
                onPressed: pending >= 50 ? () async {
                  try {
                    await apiService.mutate('revenueShare.requestPayout', {'amount': pending});
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Payout requested!')));
                    _load();
                  } catch (e) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
                } : null,
                child: Text(pending >= 50 ? 'Request Payout' : 'Min \$50 required (\$${pending.toStringAsFixed(2)} pending)'),
              ),
              const SizedBox(height: 24),
              const Text('Payout History', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Colors.white)),
              const SizedBox(height: 12),
              Container(
                decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(16)),
                child: _payouts.isEmpty ? const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No payouts yet', style: TextStyle(color: Color(0xFF6B7280)))))
                    : Column(children: (_payouts as List).map((p) {
                        final payout = p as Map<String, dynamic>;
                        return ListTile(
                          title: Text(payout['createdAt']?.toString().substring(0, 10) ?? '', style: const TextStyle(color: Color(0xFFE2E8F0))),
                          subtitle: Text(payout['status']?.toString() ?? '', style: const TextStyle(color: Color(0xFF9CA3AF))),
                          trailing: Text('\$${double.tryParse(payout['amount']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00'}',
                              style: TextStyle(color: payout['status'] == 'paid' ? const Color(0xFF10B981) : const Color(0xFFF59E0B), fontWeight: FontWeight.w700)),
                        );
                      }).toList()),
              ),
            ]),
    );
  }

  Widget _stat(String label, String value, {Color? color}) => Column(children: [
    Text(label, style: const TextStyle(color: Colors.white60, fontSize: 12)),
    const SizedBox(height: 4),
    Text(value, style: TextStyle(color: color ?? Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
  ]);
}
