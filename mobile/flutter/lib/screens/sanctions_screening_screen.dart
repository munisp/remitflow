import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/future_proofing_service.dart';

class SanctionsScreeningScreen extends StatefulWidget {
  const SanctionsScreeningScreen({super.key});

  @override
  State<SanctionsScreeningScreen> createState() => _SanctionsScreeningScreenState();
}

class _SanctionsScreeningScreenState extends State<SanctionsScreeningScreen> {
  final _nameController = TextEditingController();
  final _countryController = TextEditingController();
  final _dobController = TextEditingController();
  bool _isScreening = false;
  Map<String, dynamic>? _result;

  Future<void> _runScreening() async {
    if (_nameController.text.trim().isEmpty) return;
    setState(() { _isScreening = true; _result = null; });
    HapticFeedback.mediumImpact();

    try {
      final result = await futureProofingService.screenSanctions(
        _nameController.text.trim(),
        country: _countryController.text.trim().isNotEmpty ? _countryController.text.trim() : null,
        dateOfBirth: _dobController.text.trim().isNotEmpty ? _dobController.text.trim() : null,
      );
      setState(() => _result = result);
      HapticFeedback.heavyImpact();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Screening failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      setState(() => _isScreening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sanctions Screening'), centerTitle: true),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildInfoCard(),
            const SizedBox(height: 24),
            _buildTextField(_nameController, 'Full Name', 'Enter name to screen', Icons.person, required: true),
            const SizedBox(height: 12),
            _buildTextField(_countryController, 'Country (optional)', 'e.g., Nigeria', Icons.public),
            const SizedBox(height: 12),
            _buildTextField(_dobController, 'Date of Birth (optional)', 'YYYY-MM-DD', Icons.calendar_today),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton.icon(
                onPressed: _isScreening ? null : _runScreening,
                icon: _isScreening
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.search),
                label: Text(_isScreening ? 'Screening...' : 'Run Screening'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.deepOrange,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
            if (_result != null) ...[
              const SizedBox(height: 24),
              _buildResultCard(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.orange[50],
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.orange[200]!),
      ),
      child: const Row(
        children: [
          Icon(Icons.security, color: Colors.deepOrange),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Multi-list screening: OFAC SDN, UN, EU, UK sanctions, NFIU Nigeria. Uses Jaro-Winkler fuzzy matching.',
              style: TextStyle(fontSize: 13, color: Colors.black87),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, String label, String hint, IconData icon, {bool required = false}) {
    return TextField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        filled: true,
        fillColor: Colors.grey[50],
        suffixText: required ? '*' : null,
      ),
    );
  }

  Widget _buildResultCard() {
    final isHit = (_result!['hits'] as List?)?.isNotEmpty ?? false;
    final riskLevel = _result!['riskLevel']?.toString() ?? 'unknown';
    final isHighRisk = riskLevel == 'high' || riskLevel == 'critical';

    return Card(
      color: isHit ? Colors.red[50] : Colors.green[50],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(isHit ? Icons.warning : Icons.check_circle, color: isHit ? Colors.red : Colors.green, size: 28),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    isHit ? 'Potential Match Found' : 'No Matches Found',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isHit ? Colors.red[800] : Colors.green[800]),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _resultRow('Risk Level', riskLevel.toUpperCase()),
            _resultRow('Lists Checked', (_result!['listsChecked'] ?? 5).toString()),
            _resultRow('Screening ID', _result!['screeningId']?.toString() ?? 'N/A'),
            _resultRow('Timestamp', _result!['timestamp']?.toString() ?? DateTime.now().toIso8601String()),
            if (isHit && (_result!['hits'] as List).isNotEmpty) ...[
              const SizedBox(height: 12),
              const Divider(),
              const SizedBox(height: 8),
              const Text('Match Details', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              ...(_result!['hits'] as List).map<Widget>((hit) {
                final matchScore = ((hit['score'] as num?)?.toDouble() ?? 0) * 100;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red[200]!),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(hit['name']?.toString() ?? 'Unknown', style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Text('List: ${hit['list'] ?? 'N/A'} • Score: ${matchScore.toStringAsFixed(0)}%',
                          style: TextStyle(fontSize: 12, color: Colors.grey[600])),
                    ],
                  ),
                );
              }),
            ],
          ],
        ),
      ),
    );
  }

  Widget _resultRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(width: 110, child: Text(label, style: TextStyle(color: Colors.grey[600], fontSize: 13))),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13))),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _countryController.dispose();
    _dobController.dispose();
    super.dispose();
  }
}
