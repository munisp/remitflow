import 'package:flutter/material.dart';

class DiasporaItalyScreen extends StatelessWidget {
  const DiasporaItalyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ColorScheme colorScheme = Theme.of(context).colorScheme;

    // Mock Data
    final double eurToNgnRate = 1500.00;
    final List<Map<String, dynamic>> recentTransfers = [
      {
        'recipient': 'Aisha Bello',
        'amountEur': 250.00,
        'amountNgn': 375000.00,
        'status': 'Completed',
        'date': '2026-05-08',
      },
      {
        'recipient': 'Chinedu Okoro',
        'amountEur': 150.00,
        'amountNgn': 225000.00,
        'status': 'Pending',
        'date': '2026-05-07',
      },
      {
        'recipient': 'Fatima Musa',
        'amountEur': 500.00,
        'amountNgn': 750000.00,
        'status': 'Completed',
        'date': '2026-05-05',
      },
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Italy Diaspora Remittance'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            Navigator.of(context).pop();
          },
        ),
        backgroundColor: colorScheme.primary,
        foregroundColor: colorScheme.onPrimary,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          // Exchange Rate Card
          Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Current Exchange Rate',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: colorScheme.primary,
                        ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '1 EUR',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      Icon(Icons.arrow_forward, color: colorScheme.secondary),
                      Text(
                        '${eurToNgnRate.toStringAsFixed(2)} NGN',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Rates are updated every 15 minutes.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Send Money Section
          Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Send Money to Nigeria',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: colorScheme.primary,
                        ),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    decoration: InputDecoration(
                      labelText: 'Amount in EUR',
                      hintText: 'e.g. 100.00',
                      prefixIcon: const Icon(Icons.euro),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      filled: true,
                      fillColor: colorScheme.surfaceVariant.withOpacity(0.2),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    decoration: InputDecoration(
                      labelText: 'Recipient Account Number',
                      hintText: 'e.g. 0123456789',
                      prefixIcon: const Icon(Icons.account_balance),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      filled: true,
                      fillColor: colorScheme.surfaceVariant.withOpacity(0.2),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        // TODO: Implement send money logic
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Send Money functionality coming soon!'))
                        );
                      },
                      icon: const Icon(Icons.send),
                      label: const Text('Initiate Transfer'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: colorScheme.primary,
                        foregroundColor: colorScheme.onPrimary,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        textStyle: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Recent Transfers Section
          Text(
            'Recent Transfers',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: colorScheme.onSurface,
                ),
          ),
          const SizedBox(height: 16),
          ...recentTransfers.map((transfer) {
            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              elevation: 1,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: colorScheme.secondaryContainer,
                  child: Icon(Icons.person, color: colorScheme.onSecondaryContainer),
                ),
                title: Text(
                  transfer['recipient'],
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                subtitle: Text(
                  '${transfer['date']} - ${transfer['status']}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                ),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '${transfer['amountEur'].toStringAsFixed(2)} EUR',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: colorScheme.primary,
                          ),
                    ),
                    Text(
                      '${transfer['amountNgn'].toStringAsFixed(2)} NGN',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
                onTap: () {
                  // TODO: Implement view transfer details logic
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Viewing details for ${transfer['recipient']}'))
                  );
                },
              ),
            );
          }).toList(),
        ],
      ),
    );
  }
}
