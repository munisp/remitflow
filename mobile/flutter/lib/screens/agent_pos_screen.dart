import '../services/api_service.dart';
import 'package:flutter/material.dart';

class AgentPOSScreen extends StatefulWidget {
  const AgentPOSScreen({super.key});

  @override
  State<AgentPOSScreen> createState() => _AgentPOSScreenState();
}

class _AgentPOSScreenState extends State<AgentPOSScreen> {
  final _api = ApiService();
  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final result = await _api.query('agent.getPosTransactions');
      if (mounted) setState(() { _transactions = List<dynamic>.from(result['transactions'] ?? result['data'] ?? []); _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  // Placeholder data for terminals
  final List<Map<String, dynamic>> _terminals = [
    {
      'id': 'POS001',
      'location': 'Main Branch',
      'status': 'Online',
      'lastSync': '2026-05-10 10:30 AM',
      'battery': 85,
    },
    {
      'id': 'POS002',
      'location': 'Satellite Office A',
      'status': 'Offline',
      'lastSync': '2026-05-09 05:00 PM',
      'battery': 20,
    },
    {
      'id': 'POS003',
      'location': 'Kiosk B',
      'status': 'Online',
      'lastSync': '2026-05-10 11:00 AM',
      'battery': 95,
    },
  ];

  // Placeholder data for transactions
  final List<Map<String, dynamic>> _transactions = [
    {
      'id': 'TRX001',
      'terminalId': 'POS001',
      'type': 'Cash-In',
      'amount': 1500.00,
      'currency': 'NGN',
      'date': '2026-05-10 10:25 AM',
      'status': 'Completed',
    },
    {
      'id': 'TRX002',
      'terminalId': 'POS003',
      'type': 'Cash-Out',
      'amount': 500.00,
      'currency': 'NGN',
      'date': '2026-05-10 10:55 AM',
      'status': 'Completed',
    },
    {
      'id': 'TRX003',
      'terminalId': 'POS002',
      'type': 'Cash-In',
      'amount': 2000.00,
      'currency': 'NGN',
      'date': '2026-05-09 04:30 PM',
      'status': 'Pending',
    },
    {
      'id': 'TRX004',
      'terminalId': 'POS001',
      'type': 'Cash-Out',
      'amount': 750.00,
      'currency': 'NGN',
      'date': '2026-05-09 03:00 PM',
      'status': 'Failed',
    },
  ];

  @override
  Widget build(BuildContext context) {
    final ColorScheme colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Agent POS Management'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Terminal Status Indicators',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16.0),
            _buildStatusIndicators(colorScheme),
            const SizedBox(height: 32.0),
            Text(
              'Terminal List',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16.0),
            _buildTerminalList(colorScheme),
            const SizedBox(height: 32.0),
            Text(
              'Transaction History',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16.0),
            _buildTransactionHistory(colorScheme),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusIndicators(ColorScheme colorScheme) {
    final int onlineTerminals = _terminals.where((t) => t['status'] == 'Online').length;
    final int offlineTerminals = _terminals.where((t) => t['status'] == 'Offline').length;

    return Wrap(
      spacing: 8.0,
      runSpacing: 8.0,
      children: [
        Chip(
          avatar: Icon(Icons.check_circle, color: colorScheme.onPrimaryContainer),
          label: Text('Online: $onlineTerminals'),
          backgroundColor: colorScheme.primaryContainer,
          labelStyle: TextStyle(color: colorScheme.onPrimaryContainer),
        ),
        Chip(
          avatar: Icon(Icons.cancel, color: colorScheme.onErrorContainer),
          label: Text('Offline: $offlineTerminals'),
          backgroundColor: colorScheme.errorContainer,
          labelStyle: TextStyle(color: colorScheme.onErrorContainer),
        ),
        Chip(
          avatar: Icon(Icons.receipt_long, color: colorScheme.onSecondaryContainer),
          label: Text('Total Transactions: ${_transactions.length}'),
          backgroundColor: colorScheme.secondaryContainer,
          labelStyle: TextStyle(color: colorScheme.onSecondaryContainer),
        ),
      ],
    );
  }

  Widget _buildTerminalList(ColorScheme colorScheme) {
    return Card(
      elevation: 2,
      child: ListView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _terminals.length,
        itemBuilder: (context, index) {
          final terminal = _terminals[index];
          return ListTile(
            leading: Icon(
              terminal['status'] == 'Online' ? Icons.wifi : Icons.wifi_off,
              color: terminal['status'] == 'Online' ? colorScheme.primary : colorScheme.error,
            ),
            title: Text('Terminal ID: ${terminal['id']}'),
            subtitle: Text('Location: ${terminal['location']} - Last Sync: ${terminal['lastSync']}'),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('${terminal['battery']}% Battery'),
                Icon(
                  terminal['battery'] > 75 ? Icons.battery_full : terminal['battery'] > 20 ? Icons.battery_half : Icons.battery_alert,
                  color: terminal['battery'] > 20 ? Colors.green : Colors.red,
                  size: 18,
                ),
              ],
            ),
            onTap: () {
              // Handle terminal tap, e.g., show terminal details
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Tapped on Terminal ${terminal['id']}')),
              );
            },
          );
        },
      ),
    );
  }

  Widget _buildTransactionHistory(ColorScheme colorScheme) {
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columns: const [
                  DataColumn(label: Text('ID')),
                  DataColumn(label: Text('Terminal')),
                  DataColumn(label: Text('Type')),
                  DataColumn(label: Text('Amount')),
                  DataColumn(label: Text('Date')),
                  DataColumn(label: Text('Status')),
                ],
                rows: _transactions.map((transaction) {
                  return DataRow(
                    cells: [
                      DataCell(Text(transaction['id'])),
                      DataCell(Text(transaction['terminalId'])),
                      DataCell(Text(transaction['type'])),
                      DataCell(Text('${transaction['currency']} ${transaction['amount'].toStringAsFixed(2)}')),
                      DataCell(Text(transaction['date'])),
                      DataCell(
                        Chip(
                          label: Text(transaction['status']),
                          backgroundColor: transaction['status'] == 'Completed'
                              ? colorScheme.primaryContainer
                              : transaction['status'] == 'Pending'
                                  ? colorScheme.secondaryContainer
                                  : colorScheme.errorContainer,
                          labelStyle: TextStyle(
                            color: transaction['status'] == 'Completed'
                                ? colorScheme.onPrimaryContainer
                                : transaction['status'] == 'Pending'
                                    ? colorScheme.onSecondaryContainer
                                    : colorScheme.onErrorContainer,
                          ),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 8.0),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('View all transactions')),
                  );
                },
                child: const Text('View All Transactions'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
