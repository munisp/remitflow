import 'package:flutter/material.dart';

class DiasporaUSA extends StatefulWidget {
  const DiasporaUSA({super.key});

  @override
  State<DiasporaUSA> createState() => _DiasporaUSAState();
}

class _DiasporaUSAState extends State<DiasporaUSA> {
  final List<Map<String, String>> recentTransfers = [
    {
      'sender': 'John Doe',
      'amount_usd': '500.00',
      'amount_ngn': '750,000.00',
      'status': 'Completed',
      'date': '2026-05-08'
    },
    {
      'sender': 'Jane Smith',
      'amount_usd': '300.00',
      'amount_ngn': '450,000.00',
      'status': 'Pending',
      'date': '2026-05-07'
    },
    {
      'sender': 'Peter Jones',
      'amount_usd': '1000.00',
      'amount_ngn': '1,500,000.00',
      'status': 'Completed',
      'date': '2026-05-06'
    },
    {
      'sender': 'Alice Brown',
      'amount_usd': '250.00',
      'amount_ngn': '375,000.00',
      'status': 'Failed',
      'date': '2026-05-05'
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Diaspora USA (USD → NGN)'),
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
          children: [
            Text(
              'Send Money to Nigeria from USA',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16.0),
            Card(
              elevation: 2.0,
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Current Exchange Rate',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8.0),
                    Text(
                      '1 USD = 1500 NGN (Mock Rate)',
                      style: Theme.of(context).textTheme.headlineMedium!.copyWith(
                            color: Theme.of(context).colorScheme.primary,
                          ),
                    ),
                    const SizedBox(height: 16.0),
                    ElevatedButton.icon(
                      onPressed: () {
                        // TODO: Implement send money functionality
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Initiate new transfer')),
                        );
                      },
                      icon: const Icon(Icons.send),
                      label: const Text('Send New Transfer'),
                      style: ElevatedButton.styleFrom(
                        minimumSize: const Size.fromHeight(40), // Make button full width
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24.0),
            Text(
              'Recent Transfers',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16.0),
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: recentTransfers.length,
              itemBuilder: (context, index) {
                final transfer = recentTransfers[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 12.0),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Sender: ${transfer['sender']}',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 4.0),
                        Text('Amount Sent: USD ${transfer['amount_usd']}'),
                        Text('Amount Received: NGN ${transfer['amount_ngn']}'),
                        Text('Status: ${transfer['status']}'),
                        Text('Date: ${transfer['date']}'),
                      ],
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
