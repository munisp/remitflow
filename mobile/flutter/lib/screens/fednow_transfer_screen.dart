import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/future_proofing_service.dart';

class FedNowTransferScreen extends StatefulWidget {
  const FedNowTransferScreen({super.key});

  @override
  State<FedNowTransferScreen> createState() => _FedNowTransferScreenState();
}

class _FedNowTransferScreenState extends State<FedNowTransferScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _routingController = TextEditingController();
  final _accountController = TextEditingController();
  final _nameController = TextEditingController();
  bool _isSubmitting = false;
  Map<String, dynamic>? _result;

  Future<void> _submitTransfer() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      final result = await futureProofingService.submitFedNowTransfer(
        amount: double.parse(_amountController.text),
        routingNumber: _routingController.text,
        accountNumber: _accountController.text,
        creditorName: _nameController.text,
      );

      setState(() => _result = result);
      HapticFeedback.heavyImpact();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('FedNow transfer submitted: ${result['transactionId']}'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Transfer failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('FedNow Instant Transfer'),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildInfoBanner(),
              const SizedBox(height: 24),
              _buildAmountField(),
              const SizedBox(height: 16),
              _buildTextField(
                controller: _routingController,
                label: 'ABA Routing Number',
                hint: '9 digits',
                icon: Icons.account_balance,
                keyboardType: TextInputType.number,
                maxLength: 9,
                validator: (v) {
                  if (v == null || v.length != 9) return 'Routing number must be 9 digits';
                  if (!RegExp(r'^\d{9}$').hasMatch(v)) return 'Must be numeric';
                  return null;
                },
              ),
              const SizedBox(height: 16),
              _buildTextField(
                controller: _accountController,
                label: 'Account Number',
                hint: 'Recipient account number',
                icon: Icons.credit_card,
                keyboardType: TextInputType.number,
                validator: (v) {
                  if (v == null || v.isEmpty) return 'Account number required';
                  return null;
                },
              ),
              const SizedBox(height: 16),
              _buildTextField(
                controller: _nameController,
                label: 'Creditor Name',
                hint: 'Full name of recipient',
                icon: Icons.person,
                validator: (v) {
                  if (v == null || v.isEmpty) return 'Creditor name required';
                  return null;
                },
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _isSubmitting ? null : _submitTransfer,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0052CC),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: _isSubmitting
                      ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : const Text('Submit FedNow Transfer', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                ),
              ),
              if (_result != null) ...[
                const SizedBox(height: 24),
                _buildResultCard(),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInfoBanner() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFF0052CC), Color(0xFF003D99)]),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: [
          Icon(Icons.flash_on, color: Colors.white, size: 32),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('FedNow Instant Payments', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                SizedBox(height: 4),
                Text('Real-time settlement via the Federal Reserve • USD only • Max \$500,000',
                    style: TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAmountField() {
    return TextFormField(
      controller: _amountController,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(
        labelText: 'Amount (USD)',
        prefixText: '\$ ',
        prefixIcon: const Icon(Icons.attach_money),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        filled: true,
        fillColor: Colors.grey[50],
      ),
      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
      validator: (v) {
        if (v == null || v.isEmpty) return 'Amount required';
        final amount = double.tryParse(v);
        if (amount == null || amount <= 0) return 'Invalid amount';
        if (amount > 500000) return 'Max \$500,000 per FedNow transfer';
        return null;
      },
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    TextInputType? keyboardType,
    int? maxLength,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      maxLength: maxLength,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        filled: true,
        fillColor: Colors.grey[50],
      ),
      validator: validator,
    );
  }

  Widget _buildResultCard() {
    final status = _result!['status'] ?? 'UNKNOWN';
    final isSuccess = status == 'ACSP' || status == 'ACSC';
    return Card(
      color: isSuccess ? Colors.green[50] : Colors.red[50],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(isSuccess ? Icons.check_circle : Icons.error, color: isSuccess ? Colors.green : Colors.red),
                const SizedBox(width: 8),
                Text(isSuccess ? 'Transfer Submitted' : 'Transfer Failed',
                    style: TextStyle(fontWeight: FontWeight.bold, color: isSuccess ? Colors.green[800] : Colors.red[800])),
              ],
            ),
            const SizedBox(height: 12),
            _resultRow('Transaction ID', _result!['transactionId'] ?? 'N/A'),
            _resultRow('End-to-End ID', _result!['endToEndId'] ?? 'N/A'),
            _resultRow('Status', status.toString()),
            _resultRow('ISO 20022', 'pacs.008 generated'),
          ],
        ),
      ),
    );
  }

  Widget _resultRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Colors.grey, fontSize: 13))),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13))),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _amountController.dispose();
    _routingController.dispose();
    _accountController.dispose();
    _nameController.dispose();
    super.dispose();
  }
}
