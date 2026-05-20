import 'package:flutter/material.dart';
import '../services/api_service.dart';

class PayrollRunScreen extends StatefulWidget {
  const PayrollRunScreen({super.key});
  @override
  State<PayrollRunScreen> createState() => _PayrollRunScreenState();
}

class _PayrollRunScreenState extends State<PayrollRunScreen> {
  final _api = ApiService();
  List<dynamic> _runs = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadRuns();
  }

  Future<void> _loadRuns() async {
    try {
      final result = await _api.query('globalPayroll.listRuns');
      if (mounted) setState(() { _runs = List<dynamic>.from(result['runs'] ?? result['data'] ?? []); _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Payroll Runs', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [IconButton(icon: const Icon(Icons.refresh, color: Colors.white), onPressed: () { setState(() => _loading = true); _loadRuns(); })],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
        : _runs.isEmpty
          ? const Center(child: Text('No payroll runs', style: TextStyle(color: Color(0xFF94A3B8))))
          : RefreshIndicator(
              onRefresh: () async { setState(() => _loading = true); await _loadRuns(); },
              color: const Color(0xFF6366F1),
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _runs.length,
                itemBuilder: (context, i) {
                  final run = _runs[i];
                  final status = run['status'] ?? 'draft';
                  final statusColor = status == 'completed' ? Colors.green : status == 'approved' ? const Color(0xFF6366F1) : status == 'failed' ? Colors.red : Colors.orange;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text('Run #${run['id']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16))),
                        Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(8)), child: Text(status.toUpperCase(), style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold))),
                      ]),
                      const SizedBox(height: 8),
                      Text('Period: ${run['periodStart'] ?? ''} — ${run['periodEnd'] ?? ''}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                      Text('Pay Date: ${run['payDate'] ?? ''}', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                      if (run['totalAmount'] != null) ...[
                        const SizedBox(height: 8),
                        Text('Total: \$${run['totalAmount']}', style: const TextStyle(color: Color(0xFF6366F1), fontWeight: FontWeight.bold, fontSize: 15)),
                      ],
                    ]),
                  );
                },
              ),
            ),
    );
  }
}
