import 'package:flutter/material.dart';
import '../services/api_service.dart';

class RailsHealthDashboardScreen extends StatefulWidget {
  const RailsHealthDashboardScreen({super.key});
  @override
  State<RailsHealthDashboardScreen> createState() => _RailsHealthDashboardScreenState();
}

class _RailsHealthDashboardScreenState extends State<RailsHealthDashboardScreen> {
  final _api = ApiService();
  List<dynamic> _rails = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final result = await _api.query('railsHealth.getStatus');
      if (mounted) setState(() { _rails = List<dynamic>.from(result['rails'] ?? result['data'] ?? []); _loading = false; });
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
        title: const Text('Payment Rails Health', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [IconButton(icon: const Icon(Icons.refresh, color: Colors.white), onPressed: () { setState(() => _loading = true); _loadData(); })],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
        : _rails.isEmpty
          ? const Center(child: Text('No rails data', style: TextStyle(color: Color(0xFF94A3B8))))
          : RefreshIndicator(
              onRefresh: () async { setState(() => _loading = true); await _loadData(); },
              color: const Color(0xFF6366F1),
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _rails.length,
                itemBuilder: (context, i) {
                  final rail = _rails[i];
                  final status = rail['status'] ?? 'unknown';
                  final statusColor = status == 'operational' ? Colors.green : status == 'degraded' ? Colors.orange : Colors.red;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
                    child: Row(children: [
                      Container(width: 12, height: 12, decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle)),
                      const SizedBox(width: 12),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(rail['name'] ?? rail['rail'] ?? 'Rail', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                        Text('Latency: ${rail['latencyMs'] ?? rail['latency'] ?? 'N/A'}ms', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                      ])),
                      Text(status.toUpperCase(), style: TextStyle(color: statusColor, fontSize: 12, fontWeight: FontWeight.bold)),
                    ]),
                  );
                },
              ),
            ),
    );
  }
}
