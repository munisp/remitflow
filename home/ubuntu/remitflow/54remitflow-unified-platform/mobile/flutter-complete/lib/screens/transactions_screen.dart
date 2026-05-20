import 'package:flutter/material.dart';
import '../services/analytics_service.dart';

class TransactionsScreen extends StatefulWidget {
  @override
  _TransactionsScreenState createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  String _filter = 'all';
  String _searchQuery = '';
  
  final List<Map<String, dynamic>> transactions = [
    {
      'id': '1',
      'recipient': 'Jane Doe',
      'amount': 5000,
      'currency': 'NGN',
      'type': 'debit',
      'status': 'completed',
      'date': '2025-10-29',
      'paymentSystem': 'NIBSS',
    },
    {
      'id': '2',
      'recipient': 'John Smith',
      'amount': 3000,
      'currency': 'NGN',
      'type': 'credit',
      'status': 'completed',
      'date': '2025-10-28',
      'paymentSystem': 'PAPSS',
    },
  ];

  @override
  void initState() {
    super.initState();
    AnalyticsService.trackScreenView('Transactions');
  }

  List<Map<String, dynamic>> get filteredTransactions {
    var filtered = transactions;
    
    if (_filter != 'all') {
      filtered = filtered.where((tx) => tx['type'] == _filter).toList();
    }
    
    if (_searchQuery.isNotEmpty) {
      filtered = filtered.where((tx) =>
        tx['recipient'].toLowerCase().contains(_searchQuery.toLowerCase())
      ).toList();
    }
    
    return filtered;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Transactions'),
        actions: [
          IconButton(
            icon: Icon(Icons.download),
            onPress: () {
              AnalyticsService.trackButtonClick('export_transactions');
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: EdgeInsets.all(16),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search transactions...',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              onChanged: (value) {
                setState(() {
                  _searchQuery = value;
                });
              },
            ),
          ),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                _buildFilterChip('All', 'all'),
                SizedBox(width: 8),
                _buildFilterChip('Debit', 'debit'),
                SizedBox(width: 8),
                _buildFilterChip('Credit', 'credit'),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: EdgeInsets.all(16),
              itemCount: filteredTransactions.length,
              itemBuilder: (context, index) {
                final tx = filteredTransactions[index];
                return _buildTransactionCard(tx);
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _filter == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (selected) {
        setState(() {
          _filter = value;
        });
      },
    );
  }

  Widget _buildTransactionCard(Map<String, dynamic> tx) {
    return Card(
      margin: EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: tx['type'] == 'debit' ? Colors.red[100] : Colors.green[100],
          child: Icon(
            tx['type'] == 'debit' ? Icons.arrow_upward : Icons.arrow_downward,
            color: tx['type'] == 'debit' ? Colors.red : Colors.green,
          ),
        ),
        title: Text(tx['recipient']),
        subtitle: Text('${tx['date']} • ${tx['paymentSystem']}'),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '${tx['type'] == 'debit' ? '-' : '+'}${tx['currency']} ${tx['amount']}',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: tx['type'] == 'debit' ? Colors.red : Colors.green,
              ),
            ),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.green[100],
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                tx['status'],
                style: TextStyle(fontSize: 10),
              ),
            ),
          ],
        ),
        onTap: () {
          Navigator.pushNamed(context, '/transaction-detail', arguments: tx);
        },
      ),
    );
  }
}
