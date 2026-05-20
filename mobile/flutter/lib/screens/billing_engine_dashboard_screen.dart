import 'package:flutter/material.dart';

class BillingEngineDashboard extends StatefulWidget {
  const BillingEngineDashboard({super.key});

  @override
  State<BillingEngineDashboard> createState() => _BillingEngineDashboardState();
}

class _BillingEngineDashboardState extends State<BillingEngineDashboard> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Billing Engine Dashboard'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            // Implement navigation back
            Navigator.of(context).pop();
          },
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Revenue Metrics
            _buildSectionTitle('Real-time Revenue Metrics'),
            const SizedBox(height: 16.0),
            _buildRevenueMetrics(),
            const SizedBox(height: 24.0),

            // Corridor Breakdown
            _buildSectionTitle('Corridor Breakdown'),
            const SizedBox(height: 16.0),
            _buildCorridorBreakdown(),
            const SizedBox(height: 24.0),

            // Platform/Partner Split
            _buildSectionTitle('Platform vs Partner Split'),
            const SizedBox(height: 16.0),
            _buildPlatformPartnerSplit(),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.bold,
          ),
    );
  }

  Widget _buildRevenueMetrics() {
    return Row(
      children: [
        Expanded(
          child: Card(
            elevation: 2,
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Total Revenue', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8.0),
                  Text('\$1,250,000', style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: Colors.green)),
                  const SizedBox(height: 4.0),
                  Text('+5.2% from last month', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.green)),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 16.0),
        Expanded(
          child: Card(
            elevation: 2,
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Net Profit', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8.0),
                  Text('\$380,000', style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: Colors.green)),
                  const SizedBox(height: 4.0),
                  Text('+7.1% from last month', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.green)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildCorridorBreakdown() {
    final List<Map<String, String>> corridorData = [
      {'corridor': 'USD-NGN', 'revenue': '\$700,000', 'profit': '\$210,000'},
      {'corridor': 'GBP-NGN', 'revenue': '\$300,000', 'profit': '\$90,000'},
      {'corridor': 'CAD-NGN', 'revenue': '\$150,000', 'profit': '\$45,000'},
      {'corridor': 'EUR-NGN', 'revenue': '\$100,000', 'profit': '\$35,000'},
    ];

    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: DataTable(
          columnSpacing: 24.0,
          horizontalMargin: 12.0,
          columns: const [
            DataColumn(label: Text('Corridor', style: TextStyle(fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Revenue', style: TextStyle(fontWeight: FontWeight.bold)), numeric: true),
            DataColumn(label: Text('Profit', style: TextStyle(fontWeight: FontWeight.bold)), numeric: true),
          ],
          rows: corridorData
              .map(
                (data) => DataRow(cells: [
                  DataCell(Text(data['corridor']!)),
                  DataCell(Text(data['revenue']!)),
                  DataCell(Text(data['profit']!)),
                ]),
              )
              .toList(),
        ),
      ),
    );
  }

  Widget _buildPlatformPartnerSplit() {
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Revenue Split', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 16.0),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('Platform', style: Theme.of(context).textTheme.bodyLarge),
                    const SizedBox(height: 4.0),
                    Text('65%', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.blue)),
                    Text('\$812,500', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
                Column(
                  children: [
                    Text('Partners', style: Theme.of(context).textTheme.bodyLarge),
                    const SizedBox(height: 4.0),
                    Text('35%', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.orange)),
                    Text('\$437,500', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 24.0),
            Text('Profit Split', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 16.0),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('Platform', style: Theme.of(context).textTheme.bodyLarge),
                    const SizedBox(height: 4.0),
                    Text('70%', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.blue)),
                    Text('\$266,000', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
                Column(
                  children: [
                    Text('Partners', style: Theme.of(context).textTheme.bodyLarge),
                    const SizedBox(height: 4.0),
                    Text('30%', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.orange)),
                    Text('\$114,000', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
