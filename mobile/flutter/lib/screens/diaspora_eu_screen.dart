import 'package:flutter/material.dart';

class DiasporaEU extends StatelessWidget {
  const DiasporaEU({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('EU Remittance Corridor'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            Navigator.of(context).pop();
          },
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Send money from Europe to Nigeria (EUR to NGN)',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 24.0),
            Card(
              elevation: 2.0,
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Current Exchange Rate',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8.0),
                    Text(
                      '1 EUR = 1,500.00 NGN',
                      style: Theme.of(context).textTheme.headlineMedium!.copyWith(
                            color: Theme.of(context).colorScheme.primary,
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    const SizedBox(height: 8.0),
                    Text(
                      'Last updated: May 10, 2026, 10:30 AM UTC',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24.0),
            Text(
              'Transfer Details',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16.0),
            TextField(
              decoration: InputDecoration(
                labelText: 'Amount to Send (EUR)',
                border: const OutlineInputBorder(),
                prefixIcon: const Icon(Icons.euro_symbol),
                suffixText: 'EUR',
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16.0),
            TextField(
              decoration: InputDecoration(
                labelText: 'Recipient receives (NGN)',
                border: const OutlineInputBorder(),
                prefixIcon: const Icon(Icons.currency_exchange),
                suffixText: 'NGN',
              ),
              keyboardType: TextInputType.number,
              readOnly: true,
              controller: TextEditingController(text: '15,000.00'), // Mock calculated value
            ),
            const SizedBox(height: 24.0),
            ElevatedButton.icon(
              onPressed: () {
                // Handle transfer initiation
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Initiating transfer...')),
                );
              },
              icon: const Icon(Icons.send),
              label: const Text('Initiate Transfer'),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size.fromHeight(50), // Make button full width
              ),
            ),
            const SizedBox(height: 24.0),
            Text(
              'Key Features:',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8.0),
            _buildFeatureListItem(context, 'Competitive EUR to NGN exchange rates.'),
            _buildFeatureListItem(context, 'Fast and secure transfers to Nigeria.'),
            _buildFeatureListItem(context, 'Low transaction fees.'),
            _buildFeatureListItem(context, '24/7 customer support.'),
          ],
        ),
      ),
    );
  }

  Widget _buildFeatureListItem(BuildContext context, String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.check_circle_outline,
            color: Theme.of(context).colorScheme.secondary,
            size: 20.0,
          ),
          const SizedBox(width: 8.0),
          Expanded(
            child: Text(
              text,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          ),
        ],
      ),
    );
  }
}
