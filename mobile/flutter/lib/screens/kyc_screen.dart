import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/api_service.dart';

class KycScreen extends StatefulWidget {
  const KycScreen({super.key});
  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  int _step = 0;
  bool _loading = false;
  final _formData = <String, String>{
    'firstName': '', 'lastName': '', 'dateOfBirth': '', 'nationality': '',
    'idType': 'passport', 'idNumber': '', 'addressLine1': '', 'city': '', 'country': '',
  };

  Future<void> _submit() async {
    setState(() => _loading = true);
    try {
      await apiService.mutate('kyc.submit', _formData);
      if (mounted) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('KYC submitted!'))); context.pop(); }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
    } finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('KYC Verification')),
      body: Column(children: [
        Expanded(child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (_step == 0) ...[
            _field('firstName', 'First Name', 'John'), _field('lastName', 'Last Name', 'Doe'),
            _field('dateOfBirth', 'Date of Birth', 'YYYY-MM-DD'), _field('nationality', 'Nationality', 'Nigerian'),
          ],
          if (_step == 1) ...[
            const Text('Document Type', style: TextStyle(color: Color(0xFF9CA3AF))),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: ['passport', 'national_id', 'drivers_license'].map((t) =>
              ChoiceChip(label: Text(t.replaceAll('_', ' ')), selected: _formData['idType'] == t, onSelected: (_) => setState(() => _formData['idType'] = t))
            ).toList()),
            const SizedBox(height: 16),
            _field('idNumber', 'Document Number', 'A12345678'),
          ],
          if (_step == 2) ...[
            _field('addressLine1', 'Address', '123 Main St'), _field('city', 'City', 'Lagos'), _field('country', 'Country', 'Nigeria'),
          ],
          if (_step == 3) ...(_formData.entries.map((e) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text(e.key, style: const TextStyle(color: Color(0xFF9CA3AF))),
              Text(e.value.isEmpty ? '—' : e.value, style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
            ]),
          ))),
        ]))),
        Padding(padding: const EdgeInsets.all(16), child: Row(children: [
          if (_step > 0) ...[Expanded(child: OutlinedButton(onPressed: () => setState(() => _step--), child: const Text('← Back'))), const SizedBox(width: 12)],
          Expanded(child: ElevatedButton(
            onPressed: _loading ? null : () { if (_step < 3) setState(() => _step++); else _submit(); },
            child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : Text(_step < 3 ? 'Next →' : 'Submit KYC'),
          )),
        ])),
      ]),
    );
  }

  Widget _field(String key, String label, String hint) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
      const SizedBox(height: 6),
      TextFormField(initialValue: _formData[key], style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(hintText: hint), onChanged: (v) => _formData[key] = v),
    ]),
  );
}
