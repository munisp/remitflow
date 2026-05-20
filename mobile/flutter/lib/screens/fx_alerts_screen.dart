import 'package:flutter/material.dart';
import '../services/api_service.dart';

class FxAlertsScreen extends StatefulWidget {
  const FxAlertsScreen({super.key});
  @override
  State<FxAlertsScreen> createState() => _FxAlertsScreenState();
}

class _FxAlertsScreenState extends State<FxAlertsScreen> {
  List<dynamic> _alerts = [];
  bool _loading = true;
  String _from = 'USD', _to = 'NGN', _direction = 'above';
  final _rateCtrl = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final data = await apiService.query('fxAlerts.list');
      setState(() { _alerts = data as List? ?? []; _loading = false; });
    } catch (e) { setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('FX Alerts'), actions: [
        IconButton(icon: const Icon(Icons.add), onPressed: () => _showCreateSheet()),
      ]),
      body: _loading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _alerts.isEmpty ? const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Text('📈', style: TextStyle(fontSize: 48)),
              SizedBox(height: 12),
              Text('No FX alerts yet', style: TextStyle(color: Color(0xFF6B7280))),
            ]))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _alerts.length,
              itemBuilder: (ctx, i) {
                final a = _alerts[i] as Map<String, dynamic>;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2D2D4E))),
                  child: Row(children: [
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${a['fromCurrency']}/${a['toCurrency']}', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                      Text('${a['direction'] == 'above' ? '↑ Above' : '↓ Below'} ${double.tryParse(a['targetRate']?.toString() ?? '0')?.toStringAsFixed(4) ?? '0'}',
                          style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 14)),
                    ])),
                    Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(color: (a['triggered'] == true ? const Color(0xFF10B981) : const Color(0xFFF59E0B)).withOpacity(0.1), borderRadius: BorderRadius.circular(20)),
                        child: Text(a['triggered'] == true ? '✓ Triggered' : '⏳ Watching',
                            style: TextStyle(color: a['triggered'] == true ? const Color(0xFF10B981) : const Color(0xFFF59E0B), fontSize: 12, fontWeight: FontWeight.w600))),
                    IconButton(icon: const Icon(Icons.delete_outline, color: Color(0xFFEF4444)), onPressed: () async {
                      await apiService.mutate('fxAlerts.delete', {'id': a['id']}); _load();
                    }),
                  ]),
                );
              },
            ),
    );
  }

  void _showCreateSheet() => showModalBottomSheet(
    context: context, isScrollControlled: true, backgroundColor: const Color(0xFF1A1A2E),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (ctx) => StatefulBuilder(builder: (ctx, setModalState) => Padding(
      padding: EdgeInsets.only(left: 24, right: 24, top: 24, bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Create FX Alert', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white)),
        const SizedBox(height: 16),
        const Text('From Currency', style: TextStyle(color: Color(0xFF9CA3AF))),
        Wrap(spacing: 8, children: ['USD', 'EUR', 'GBP', 'NGN', 'KES'].map((c) => ChoiceChip(
          label: Text(c), selected: _from == c, onSelected: (_) => setModalState(() => _from = c),
        )).toList()),
        const SizedBox(height: 12),
        const Text('To Currency', style: TextStyle(color: Color(0xFF9CA3AF))),
        Wrap(spacing: 8, children: ['GHS', 'ZAR', 'CNY', 'INR', 'BRL'].map((c) => ChoiceChip(
          label: Text(c), selected: _to == c, onSelected: (_) => setModalState(() => _to = c),
        )).toList()),
        const SizedBox(height: 12),
        const Text('Direction', style: TextStyle(color: Color(0xFF9CA3AF))),
        Row(children: ['above', 'below'].map((d) => Padding(
          padding: const EdgeInsets.only(right: 8),
          child: ChoiceChip(label: Text(d == 'above' ? '↑ Above' : '↓ Below'), selected: _direction == d, onSelected: (_) => setModalState(() => _direction = d)),
        )).toList()),
        const SizedBox(height: 12),
        TextField(controller: _rateCtrl, keyboardType: TextInputType.number, style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(labelText: 'Target Rate')),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel'))),
          const SizedBox(width: 12),
          Expanded(child: ElevatedButton(onPressed: () async {
            await apiService.mutate('fxAlerts.create', {'fromCurrency': _from, 'toCurrency': _to, 'direction': _direction, 'targetRate': double.parse(_rateCtrl.text)});
            Navigator.pop(ctx); _load();
          }, child: const Text('Create'))),
        ]),
      ]),
    )),
  );
}
