import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class ExpenseManagementScreen extends ConsumerStatefulWidget {
  const ExpenseManagementScreen({super.key});
  @override
  ConsumerState<ExpenseManagementScreen> createState() => _ExpenseManagementScreenState();
}

class _ExpenseManagementScreenState extends ConsumerState<ExpenseManagementScreen> {
  bool _isLoading = true;
  List<dynamic> _reports = [];
  String? _error;
  final _titleCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  String _category = 'travel';
  bool _submitting = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('/trpc/expenseManagement.list');
      setState(() { _reports = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }

  Future<void> _submit() async {
    if (_titleCtrl.text.isEmpty || _amountCtrl.text.isEmpty) return;
    setState(() { _submitting = true; });
    try {
      final api = ref.read(apiServiceProvider);
      await api.post('/trpc/expenseManagement.submitReport', {
        'title': _titleCtrl.text, 'amount': double.parse(_amountCtrl.text),
        'currency': 'USD', 'category': _category,
      });
      _titleCtrl.clear(); _amountCtrl.clear();
      Navigator.pop(context); _load();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red));
    } finally { setState(() { _submitting = false; }); }
  }

  void _showCreate() => showModalBottomSheet(
    context: context, isScrollControlled: true,
    backgroundColor: const Color(0xFF1A1A2E),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('New Expense Report', style: TextStyle(color: Color(0xFFE2E8F0), fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        TextField(controller: _titleCtrl, style: const TextStyle(color: Color(0xFFE2E8F0)),
          decoration: _dec('Title (e.g. Team Lunch)')),
        const SizedBox(height: 12),
        TextField(controller: _amountCtrl, keyboardType: TextInputType.number,
          style: const TextStyle(color: Color(0xFFE2E8F0)), decoration: _dec('Amount (USD)')),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(value: _category, dropdownColor: const Color(0xFF1A1A2E),
          style: const TextStyle(color: Color(0xFFE2E8F0)), decoration: _dec('Category'),
          items: ['travel','meals','accommodation','equipment','software','other']
              .map((c) => DropdownMenuItem(value: c, child: Text(c[0].toUpperCase()+c.substring(1)))).toList(),
          onChanged: (v) => setState(() { _category = v!; })),
        const SizedBox(height: 20),
        SizedBox(width: double.infinity, child: ElevatedButton(
          onPressed: _submitting ? null : _submit,
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1), padding: const EdgeInsets.symmetric(vertical: 14)),
          child: _submitting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Submit Report', style: TextStyle(fontWeight: FontWeight.w700)),
        )),
      ]),
    ),
  );

  InputDecoration _dec(String label) => InputDecoration(
    labelText: label, labelStyle: const TextStyle(color: Color(0xFF9CA3AF)), filled: true,
    fillColor: const Color(0xFF0F0F1A),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF2D2D4E))),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF2D2D4E))),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF6366F1))),
  );

  Color _sc(String? s) => s == 'approved' ? const Color(0xFF10B981) : s == 'rejected' ? const Color(0xFFEF4444) : const Color(0xFFF59E0B);

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFF0F0F1A),
    appBar: AppBar(
      backgroundColor: const Color(0xFF1A1A2E), elevation: 0,
      title: const Text('Expense Management', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
      iconTheme: const IconThemeData(color: Color(0xFF6366F1)),
      bottom: PreferredSize(preferredSize: const Size.fromHeight(1), child: Container(height: 1, color: const Color(0xFF2D2D4E))),
      actions: [IconButton(icon: const Icon(Icons.add, color: Color(0xFF6366F1)), onPressed: _showCreate)],
    ),
    body: _isLoading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
        : _error != null ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Text('⚠️', style: TextStyle(fontSize: 40)), const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF)), textAlign: TextAlign.center),
            const SizedBox(height: 16), ElevatedButton(onPressed: _load, child: const Text('Retry')),
          ]))
        : _reports.isEmpty ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Text('🧾', style: TextStyle(fontSize: 48)), const SizedBox(height: 12),
            const Text('No expense reports yet', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 16)),
            const SizedBox(height: 16),
            ElevatedButton.icon(onPressed: _showCreate, icon: const Icon(Icons.add), label: const Text('Submit Expense'),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1))),
          ]))
        : RefreshIndicator(onRefresh: _load, color: const Color(0xFF6366F1),
            child: ListView.builder(padding: const EdgeInsets.all(16), itemCount: _reports.length,
              itemBuilder: (context, i) {
                final r = _reports[i]; final s = r['status']?.toString() ?? 'pending';
                return Card(color: const Color(0xFF1A1A2E), margin: const EdgeInsets.only(bottom: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFF2D2D4E))),
                  child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      Expanded(child: Text(r['title']?.toString() ?? 'Report #${r["id"]}',
                          style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600, fontSize: 15))),
                      Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(color: _sc(s).withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
                        child: Text(s.toUpperCase(), style: TextStyle(color: _sc(s), fontSize: 11, fontWeight: FontWeight.w700))),
                    ]),
                    const SizedBox(height: 8),
                    Row(children: [
                      const Icon(Icons.attach_money, size: 14, color: Color(0xFF6366F1)), const SizedBox(width: 4),
                      Text('${r["currency"] ?? "USD"} ${r["amount"] ?? 0}',
                          style: const TextStyle(color: Color(0xFF6366F1), fontWeight: FontWeight.w700, fontSize: 16)),
                      const SizedBox(width: 12),
                      const Icon(Icons.category, size: 14, color: Color(0xFF9CA3AF)), const SizedBox(width: 4),
                      Text(r['category']?.toString() ?? '', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
                    ]),
                  ])),
                );
              })),
    floatingActionButton: FloatingActionButton(onPressed: _showCreate, backgroundColor: const Color(0xFF6366F1),
      child: const Icon(Icons.add, color: Colors.white)),
  );
}
