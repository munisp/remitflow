import '../services/api_service.dart';
import 'package:flutter/material.dart';

class SystemHealthDashboardV2 extends StatefulWidget {
  const SystemHealthDashboardV2({super.key});

  @override
  State<SystemHealthDashboardV2> createState() => _SystemHealthDashboardV2State();
}

class _SystemHealthDashboardV2State extends State<SystemHealthDashboardV2> {
  final _api = ApiService();
  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final result = await _api.query('systemHealth.getStatus');
      if (mounted) setState(() { _services = List<dynamic>.from(result['services'] ?? result['data'] ?? []); _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  final List<Map<String, String>> _systemMetrics = [
    {'name': 'API Gateway', 'status': 'Operational', 'latency': '50ms', 'uptime': '99.9%'},
    {'name': 'Database Service', 'status': 'Operational', 'latency': '20ms', 'uptime': '99.99%'},
    {'name': 'Payment Processor', 'status': 'Degraded Performance', 'latency': '200ms', 'uptime': '99.5%'},
    {'name': 'Fraud Detection', 'status': 'Operational', 'latency': '80ms', 'uptime': '99.8%'},
    {'name': 'Notification Service', 'status': 'Operational', 'latency': '30ms', 'uptime': '99.9%'},
    {'name': 'KYC Service', 'status': 'Operational', 'latency': '60ms', 'uptime': '99.9%'},
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('System Health Dashboard V2'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            Navigator.of(context).pop();
          },
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Overall System Status: Good', // Placeholder for overall status
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 20),
            Expanded(
              child: ListView.builder(
                itemCount: _systemMetrics.length,
                itemBuilder: (context, index) {
                  final metric = _systemMetrics[index];
                  return Card(
                    margin: const EdgeInsets.symmetric(vertical: 8.0),
                    elevation: 2,
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            metric['name']!,
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Status: ${metric['status']}'),
                              Text('Latency: ${metric['latency']}'),
                              Text('Uptime: ${metric['uptime']}'),
                            ],
                          ),
                          if (metric['status'] == 'Degraded Performance')
                            Padding(
                              padding: const EdgeInsets.only(top: 8.0),
                              child: Text(
                                'Action Required: Investigate payment processor latency.',
                                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
