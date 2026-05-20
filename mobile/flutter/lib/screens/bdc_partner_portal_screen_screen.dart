import 'package:flutter/material.dart';

class BDCPartnerPortalScreen extends StatefulWidget {
  const BDCPartnerPortalScreen({super.key});

  @override
  State<BDCPartnerPortalScreen> createState() => _BDCPartnerPortalScreenState();
}

class _BDCPartnerPortalScreenState extends State<BDCPartnerPortalScreen> {
  final List<Map<String, String>> fxRates = [
    {'pair': 'USD/NGN', 'buy': '1450.00', 'sell': '1465.00'},
    {'pair': 'GBP/NGN', 'buy': '1800.00', 'sell': '1820.00'},
    {'pair': 'EUR/NGN', 'buy': '1550.00', 'sell': '1570.00'},
    {'pair': 'CAD/NGN', 'buy': '1050.00', 'sell': '1070.00'},
  ];

  final List<Map<String, String>> tradeHistory = [
    {'date': '2026-05-09', 'pair': 'USD/NGN', 'amount': '10,000 USD', 'rate': '1460.00', 'status': 'Completed'},
    {'date': '2026-05-08', 'pair': 'GBP/NGN', 'amount': '5,000 GBP', 'rate': '1810.00', 'status': 'Completed'},
    {'date': '2026-05-07', 'pair': 'EUR/NGN', 'amount': '7,500 EUR', 'rate': '1560.00', 'status': 'Pending'},
    {'date': '2026-05-06', 'pair': 'CAD/NGN', 'amount': '2,000 CAD', 'rate': '1065.00', 'status': 'Completed'},
  ];

  final List<Map<String, String>> settlementStatus = [
    {'date': '2026-05-09', 'reference': 'SETL-001', 'amount': '14,600,000 NGN', 'status': 'Settled'},
    {'date': '2026-05-08', 'reference': 'SETL-002', 'amount': '9,050,000 NGN', 'status': 'Settled'},
    {'date': '2026-05-07', 'reference': 'SETL-003', 'amount': '11,700,000 NGN', 'status': 'Processing'},
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('BDC Partner Portal'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            Navigator.of(context).pop();
          },
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: <Widget>[
          // FX Rates Section
          Card(
            elevation: 2.0,
            margin: const EdgeInsets.only(bottom: 16.0),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Current FX Rates',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16.0),
                  DataTable(
                    columns: const <DataColumn>[
                      DataColumn(label: Text('Pair')),
                      DataColumn(label: Text('Buy')),
                      DataColumn(label: Text('Sell')),
                    ],
                    rows: fxRates
                        .map(
                          (rate) => DataRow(
                            cells: <DataCell>[
                              DataCell(Text(rate['pair']!)),
                              DataCell(Text(rate['buy']!)),
                              DataCell(Text(rate['sell']!)),
                            ],
                          ),
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
          ),

          // Trade History Section
          Card(
            elevation: 2.0,
            margin: const EdgeInsets.only(bottom: 16.0),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Trade History',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16.0),
                  ListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: tradeHistory.length,
                    itemBuilder: (context, index) {
                      final trade = tradeHistory[index];
                      return ListTile(
                        title: Text('${trade['pair']} - ${trade['amount']}'),
                        subtitle: Text('Rate: ${trade['rate']} | Status: ${trade['status']}'),
                        trailing: Text(trade['date']!),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),

          // Settlement Status Section
          Card(
            elevation: 2.0,
            margin: const EdgeInsets.only(bottom: 16.0),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Settlement Status',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16.0),
                  ListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: settlementStatus.length,
                    itemBuilder: (context, index) {
                      final settlement = settlementStatus[index];
                      return ListTile(
                        title: Text('Ref: ${settlement['reference']} - ${settlement['amount']}'),
                        subtitle: Text('Status: ${settlement['status']}'),
                        trailing: Text(settlement['date']!),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
