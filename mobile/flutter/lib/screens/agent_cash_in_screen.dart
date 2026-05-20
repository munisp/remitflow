import '../services/api_service.dart';
import 'package:flutter/material.dart';

class AgentCashInScreen extends StatefulWidget {
  const AgentCashInScreen({super.key});

  @override
  State<AgentCashInScreen> createState() => _AgentCashInScreenState();
}

class _AgentCashInScreenState extends StatefulWidget {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _agentIdController = TextEditingController();
  final _customerPhoneController = TextEditingController();
  String _transactionType = 'cash_in';
  bool _isProcessing = false;

  List<dynamic> _transactions = [];
  bool _loading = true;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Agent Cash In / Cash Out'),
        backgroundColor: const Color(0xFF1A237E),
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Agent Balance Card
            Card(
              color: const Color(0xFF1A237E),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Agent Float Balance', style: TextStyle(color: Colors.white70, fontSize: 14)),
                    const SizedBox(height: 8),
                    const Text('₦ 2,450,000.00', style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        _buildStatChip('Today: ₦850K', Colors.green),
                        const SizedBox(width: 8),
                        _buildStatChip('Txns: 23', Colors.blue),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Transaction Type Toggle
            const Text('Transaction Type', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'cash_in', label: Text('Cash In'), icon: Icon(Icons.add_circle_outline)),
                ButtonSegment(value: 'cash_out', label: Text('Cash Out'), icon: Icon(Icons.remove_circle_outline)),
              ],
              selected: {_transactionType},
              onSelectionChanged: (val) => setState(() => _transactionType = val.first),
            ),
            const SizedBox(height: 20),

            // Transaction Form
            Form(
              key: _formKey,
              child: Column(
                children: [
                  TextFormField(
                    controller: _customerPhoneController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Customer Phone Number',
                      prefixIcon: Icon(Icons.phone),
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) => v?.isEmpty == true ? 'Required' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _amountController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Amount (₦)',
                      prefixIcon: Icon(Icons.attach_money),
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) => v?.isEmpty == true ? 'Required' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _agentIdController,
                    decoration: const InputDecoration(
                      labelText: 'Agent PIN',
                      prefixIcon: Icon(Icons.lock_outline),
                      border: OutlineInputBorder(),
                    ),
                    obscureText: true,
                    validator: (v) => v?.isEmpty == true ? 'Required' : null,
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _isProcessing ? null : _processTransaction,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1A237E),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                      child: _isProcessing
                          ? const CircularProgressIndicator(color: Colors.white)
                          : Text(_transactionType == 'cash_in' ? 'Process Cash In' : 'Process Cash Out',
                              style: const TextStyle(fontSize: 16)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Recent Transactions
            const Text('Recent Transactions', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            ..._recentTransactions.map((txn) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: txn['type'] == 'Cash In' ? Colors.green.shade100 : Colors.orange.shade100,
                  child: Icon(
                    txn['type'] == 'Cash In' ? Icons.arrow_downward : Icons.arrow_upward,
                    color: txn['type'] == 'Cash In' ? Colors.green : Colors.orange,
                  ),
                ),
                title: Text('${txn['type']} — ₦${(txn['amount'] as int).toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}'),
                subtitle: Text('${txn['customer']} • ${txn['time']}'),
                trailing: Chip(
                  label: Text(txn['status'].toString().toUpperCase()),
                  backgroundColor: txn['status'] == 'success' ? Colors.green.shade100 : Colors.orange.shade100,
                  labelStyle: TextStyle(
                    color: txn['status'] == 'success' ? Colors.green.shade800 : Colors.orange.shade800,
                    fontSize: 10,
                  ),
                ),
              ),
            )),
          ],
        ),
      ),
    );
  }

  Widget _buildStatChip(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold)),
    );
  }

  Future<void> _processTransaction() async {
    setState(() => _isProcessing = true);
    try {
      await _api.mutate('agent.processCashTransaction', {'type': _transactionType, 'amount': double.tryParse(_amountController.text) ?? 0});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Transaction processed successfully'), backgroundColor: Colors.green));
        setState(() => _loading = true);
        _loadData();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red));
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    _agentIdController.dispose();
    _customerPhoneController.dispose();
    super.dispose();
  }
}
