import 'package:flutter/material.dart';
import '../services/api_service.dart';

class BeneficiaryScreen extends StatefulWidget {
  const BeneficiaryScreen({super.key});
  @override
  State<BeneficiaryScreen> createState() => _BeneficiaryScreenState();
}

class _BeneficiaryScreenState extends State<BeneficiaryScreen> {
  List<dynamic> _beneficiaries = [];
  bool _loading = true;
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _bankCtrl = TextEditingController();
  final _accountCtrl = TextEditingController();
  final _countryCtrl = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final data = await apiService.query('beneficiaries.list');
      setState(() { _beneficiaries = data as List? ?? []; _loading = false; });
    } catch (e) { setState(() => _loading = false); }
  }

  Future<void> _add() async {
    try {
      await apiService.mutate('beneficiaries.create', {
        'name': _nameCtrl.text, 'email': _emailCtrl.text,
        'bankName': _bankCtrl.text, 'accountNumber': _accountCtrl.text,
        'country': _countryCtrl.text, 'currency': 'USD',
      });
      Navigator.pop(context);
      _load();
    } catch (e) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Beneficiaries'), actions: [
        IconButton(icon: const Icon(Icons.add), onPressed: () => _showAddSheet()),
      ]),
      body: _loading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _beneficiaries.isEmpty ? const Center(child: Text('No beneficiaries yet', style: TextStyle(color: Color(0xFF6B7280))))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _beneficiaries.length,
              itemBuilder: (ctx, i) {
                final b = _beneficiaries[i] as Map<String, dynamic>;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: const Color(0xFF1A1A2E), borderRadius: BorderRadius.circular(12)),
                  child: Row(children: [
                    CircleAvatar(backgroundColor: const Color(0xFF6366F1), child: Text(b['name']?.toString()[0].toUpperCase() ?? 'U', style: const TextStyle(color: Colors.white))),
                    const SizedBox(width: 12),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(b['name']?.toString() ?? '', style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                      Text(b['email']?.toString() ?? '', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                      Text('${b['bankName']} · ${b['currency']}', style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
                    ])),
                    IconButton(icon: const Icon(Icons.delete_outline, color: Color(0xFFEF4444)), onPressed: () async {
                      await apiService.mutate('beneficiaries.delete', {'id': b['id']});
                      _load();
                    }),
                  ]),
                );
              },
            ),
    );
  }

  void _showAddSheet() => showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF1A1A2E),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(left: 24, right: 24, top: 24, bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Add Beneficiary', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white)),
        const SizedBox(height: 16),
        ...[(_nameCtrl, 'Full Name', 'John Doe'), (_emailCtrl, 'Email', 'john@example.com'),
            (_bankCtrl, 'Bank Name', 'First Bank'), (_accountCtrl, 'Account Number', '0123456789'),
            (_countryCtrl, 'Country', 'Nigeria')].map((f) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextField(controller: f.$1, style: const TextStyle(color: Colors.white), decoration: InputDecoration(labelText: f.$2, hintText: f.$3)),
        )),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel'))),
          const SizedBox(width: 12),
          Expanded(child: ElevatedButton(onPressed: _add, child: const Text('Save'))),
        ]),
      ]),
    ),
  );
}
