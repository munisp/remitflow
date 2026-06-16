import 'package:flutter/material.dart';
import '../services/future_proofing_service.dart';

class MiddlewareHealthScreen extends StatefulWidget {
  const MiddlewareHealthScreen({super.key});

  @override
  State<MiddlewareHealthScreen> createState() => _MiddlewareHealthScreenState();
}

class _MiddlewareHealthScreenState extends State<MiddlewareHealthScreen> {
  Map<String, dynamic> _health = {};
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadHealth();
  }

  Future<void> _loadHealth() async {
    setState(() => _isLoading = true);
    try {
      final result = await futureProofingService.getMiddlewareHealth();
      setState(() { _health = result; _isLoading = false; });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final healthyCount = _health.values.where((v) => (v as Map)['status'] == 'healthy').length;
    final totalCount = _health.length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Middleware Health'),
        centerTitle: true,
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _loadHealth)],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadHealth,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _buildOverviewCard(healthyCount, totalCount),
                  const SizedBox(height: 16),
                  ..._health.entries.map(_buildServiceCard),
                ],
              ),
            ),
    );
  }

  Widget _buildOverviewCard(int healthy, int total) {
    final allHealthy = healthy == total && total > 0;
    return Card(
      color: allHealthy ? Colors.green[50] : Colors.amber[50],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(allHealthy ? Icons.check_circle : Icons.warning, color: allHealthy ? Colors.green : Colors.amber, size: 36),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(allHealthy ? 'All Systems Operational' : 'Some Systems Degraded',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: allHealthy ? Colors.green[800] : Colors.amber[800])),
                  const SizedBox(height: 4),
                  Text('$healthy / $total services healthy', style: const TextStyle(color: Colors.grey)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildServiceCard(MapEntry<String, dynamic> entry) {
    final data = entry.value as Map<String, dynamic>;
    final isHealthy = data['status'] == 'healthy';
    final latency = data['latencyMs'] as num? ?? -1;
    final icons = {
      'redis': Icons.memory,
      'openSearch': Icons.search,
      'keycloak': Icons.vpn_key,
      'permify': Icons.admin_panel_settings,
      'dapr': Icons.hub,
      'apisix': Icons.api,
      'tigerBeetle': Icons.account_balance,
      'fluvio': Icons.stream,
      'lakehouse': Icons.warehouse,
      'openAppSec': Icons.security,
      'mojaloop': Icons.swap_horiz,
      'kafka': Icons.message,
      'temporal': Icons.schedule,
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: isHealthy ? Colors.green[50] : Colors.red[50],
          child: Icon(icons[entry.key] ?? Icons.settings, color: isHealthy ? Colors.green : Colors.red, size: 20),
        ),
        title: Text(entry.key, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(isHealthy ? '${latency}ms latency' : 'Unavailable', style: TextStyle(fontSize: 12, color: isHealthy ? Colors.grey : Colors.red)),
        trailing: Container(
          width: 10, height: 10,
          decoration: BoxDecoration(shape: BoxShape.circle, color: isHealthy ? Colors.green : Colors.red),
        ),
      ),
    );
  }
}
