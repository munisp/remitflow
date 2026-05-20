import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart'; // Assuming api_service.dart handles tRPC calls

// Define the tRPC endpoints for BusinessSavings
final businessSavingsListProvider = FutureProvider((ref) async {
  // Simulate API call
  await Future.delayed(const Duration(seconds: 1));
  // Replace with actual tRPC call: apiService.businessSavings.list.query()
  return [
    BusinessSavingsAccount(id: '1', name: 'Emergency Fund', balance: 5000.00, interestRate: 0.05, type: 'Fixed Deposit'),
    BusinessSavingsAccount(id: '2', name: 'Expansion Capital', balance: 25000.00, interestRate: 0.06, type: 'Yield Account'),
  ];
});

final businessSavingsOpenAccountProvider = FutureProvider.family<void, BusinessSavingsAccount>((ref, account) async {
  // Simulate API call
  await Future.delayed(const Duration(seconds: 1));
  // Replace with actual tRPC call: apiService.businessSavings.openAccount.mutate(account)
  print('Opening account: ${account.name}');
});

final businessSavingsDepositProvider = FutureProvider.family<void, Map<String, dynamic>>((ref, data) async {
  // Simulate API call
  await Future.delayed(const Duration(seconds: 1));
  // Replace with actual tRPC call: apiService.businessSavings.deposit.mutate(data)
  print('Depositing ${data['amount']} into ${data['accountId']}');
});

final businessSavingsWithdrawProvider = FutureProvider.family<void, Map<String, dynamic>>((ref, data) async {
  // Simulate API call
  await Future.delayed(const Duration(seconds: 1));
  // Replace with actual tRPC call: apiService.businessSavings.withdraw.mutate(data)
  print('Withdrawing ${data['amount']} from ${data['accountId']}');
});

class BusinessSavingsAccount {
  final String id;
  final String name;
  final double balance;
  final double interestRate;
  final String type;

  BusinessSavingsAccount({
    required this.id,
    required this.name,
    required this.balance,
    required this.interestRate,
    required this.type,
  });

  BusinessSavingsAccount copyWith({
    String? id,
    String? name,
    double? balance,
    double? interestRate,
    String? type,
  }) {
    return BusinessSavingsAccount(
      id: id ?? this.id,
      name: name ?? this.name,
      balance: balance ?? this.balance,
      interestRate: interestRate ?? this.interestRate,
      type: type ?? this.type,
    );
  }
}

class BusinessSavingsScreen extends ConsumerStatefulWidget {
  const BusinessSavingsScreen({super.key});

  @override
  ConsumerState<BusinessSavingsScreen> createState() => _BusinessSavingsScreenState();
}

class _BusinessSavingsScreenState extends ConsumerState<BusinessSavingsScreen> {
  final _formKey = GlobalKey<FormState>();
  String _accountName = '';
  double _initialDeposit = 0.0;
  String _accountType = 'Fixed Deposit';

  final Color _backgroundColor = const Color(0xFF0F0F1A);
  final Color _cardColor = const Color(0xFF1A1A2E);
  final Color _accentColor = const Color(0xFF6366F1);
  final Color _textColor = const Color(0xFFE2E8F0);
  final Color _mutedColor = const Color(0xFF9CA3AF);
  final Color _borderColor = const Color(0xFF2D2D4E);

  @override
  Widget build(BuildContext context) {
    final businessSavingsAsyncValue = ref.watch(businessSavingsListProvider);

    return Scaffold(
      backgroundColor: _backgroundColor,
      appBar: AppBar(
        title: Text('Business Savings', style: TextStyle(color: _textColor)),
        backgroundColor: _backgroundColor,
        iconTheme: IconThemeData(color: _accentColor), // Colored icon theme
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(businessSavingsListProvider.future),
        color: _accentColor,
        child: businessSavingsAsyncValue.when(
          loading: () => Center(child: CircularProgressIndicator(color: _accentColor)),
          error: (err, stack) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('Error: $err', style: TextStyle(color: _textColor)),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => ref.invalidate(businessSavingsListProvider),
                  style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
                  child: Text('Retry', style: TextStyle(color: _textColor)),
                ),
              ],
            ),
          ),
          data: (accounts) {
            if (accounts.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('🏦', style: TextStyle(fontSize: 64)),
                    const SizedBox(height: 16),
                    Text('No savings accounts yet!', style: TextStyle(color: _textColor, fontSize: 18)),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => _showCreateAccountDialog(context),
                      style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
                      child: Text('Open New Account', style: TextStyle(color: _textColor)),
                    ),
                  ],
                ),
              );
            }
            return ListView.builder(
              itemCount: accounts.length,
              itemBuilder: (context, index) {
                final account = accounts[index];
                return Card(
                  color: _cardColor,
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: _borderColor)),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(account.name, style: TextStyle(color: _textColor, fontSize: 20, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Text('Balance: \$${account.balance.toStringAsFixed(2)}', style: TextStyle(color: _textColor, fontSize: 16)),
                        Text('Interest Rate: ${(account.interestRate * 100).toStringAsFixed(2)}%', style: TextStyle(color: _mutedColor, fontSize: 14)),
                        Text('Type: ${account.type}', style: TextStyle(color: _mutedColor, fontSize: 14)),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            ElevatedButton(
                              onPressed: () => _showDepositWithdrawDialog(context, account, 'deposit'),
                              style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
                              child: Text('Deposit', style: TextStyle(color: _textColor)),
                            ),
                            const SizedBox(width: 8),
                            ElevatedButton(
                              onPressed: () => _showDepositWithdrawDialog(context, account, 'withdraw'),
                              style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
                              child: Text('Withdraw', style: TextStyle(color: _textColor)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
      floatingActionButton: businessSavingsAsyncValue.whenOrNull(
        data: (accounts) => FloatingActionButton(
          onPressed: () => _showCreateAccountDialog(context),
          backgroundColor: _accentColor,
          child: Icon(Icons.add, color: _textColor),
        ),
      ),
    );
  }

  void _showCreateAccountDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: _cardColor,
          title: Text('Open New Savings Account', style: TextStyle(color: _textColor)),
          content: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  decoration: InputDecoration(
                    labelText: 'Account Name',
                    labelStyle: TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: _borderColor)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: _accentColor)),
                  ),
                  style: TextStyle(color: _textColor),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter an account name';
                    }
                    return null;
                  },
                  onSaved: (value) => _accountName = value!,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  decoration: InputDecoration(
                    labelText: 'Initial Deposit',
                    labelStyle: TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: _borderColor)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: _accentColor)),
                  ),
                  style: TextStyle(color: _textColor),
                  keyboardType: TextInputType.number,
                  validator: (value) {
                    if (value == null || double.tryParse(value) == null || double.parse(value) <= 0) {
                      return 'Please enter a valid positive amount';
                    }
                    return null;
                  },
                  onSaved: (value) => _initialDeposit = double.parse(value!),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _accountType,
                  dropdownColor: _cardColor,
                  style: TextStyle(color: _textColor),
                  decoration: InputDecoration(
                    labelText: 'Account Type',
                    labelStyle: TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: _borderColor)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: _accentColor)),
                  ),
                  items: <String>['Fixed Deposit', 'Yield Account']
                      .map<DropdownMenuItem<String>>((String value) {
                    return DropdownMenuItem<String>(
                      value: value,
                      child: Text(value, style: TextStyle(color: _textColor)),
                    );
                  }).toList(),
                  onChanged: (String? newValue) {
                    setState(() {
                      _accountType = newValue!;
                    });
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('Cancel', style: TextStyle(color: _mutedColor)),
            ),
            ElevatedButton(
              onPressed: () async {
                if (_formKey.currentState!.validate()) {
                  _formKey.currentState!.save();
                  final newAccount = BusinessSavingsAccount(
                    id: DateTime.now().millisecondsSinceEpoch.toString(), // Unique ID
                    name: _accountName,
                    balance: _initialDeposit,
                    interestRate: _accountType == 'Fixed Deposit' ? 0.05 : 0.06, // Example rates
                    type: _accountType,
                  );
                  await ref.read(businessSavingsOpenAccountProvider(newAccount).future);
                  ref.invalidate(businessSavingsListProvider); // Refresh list
                  Navigator.of(context).pop();
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
              child: Text('Open Account', style: TextStyle(color: _textColor)),
            ),
          ],
        );
      },
    );
  }

  void _showDepositWithdrawDialog(BuildContext context, BusinessSavingsAccount account, String type) {
    final TextEditingController amountController = TextEditingController();
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: _cardColor,
          title: Text('${type == 'deposit' ? 'Deposit into' : 'Withdraw from'} ${account.name}', style: TextStyle(color: _textColor)),
          content: Form(
            key: _formKey,
            child: TextFormField(
              controller: amountController,
              decoration: InputDecoration(
                labelText: 'Amount',
                labelStyle: TextStyle(color: _mutedColor),
                enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: _borderColor)),
                focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: _accentColor)),
              ),
              style: TextStyle(color: _textColor),
              keyboardType: TextInputType.number,
              validator: (value) {
                if (value == null || double.tryParse(value) == null || double.parse(value) <= 0) {
                  return 'Please enter a valid positive amount';
                }
                if (type == 'withdraw' && double.parse(value) > account.balance) {
                  return 'Insufficient balance';
                }
                return null;
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('Cancel', style: TextStyle(color: _mutedColor)),
            ),
            ElevatedButton(
              onPressed: () async {
                if (_formKey.currentState!.validate()) {
                  final amount = double.parse(amountController.text);
                  if (type == 'deposit') {
                    await ref.read(businessSavingsDepositProvider({'accountId': account.id, 'amount': amount}).future);
                  } else {
                    await ref.read(businessSavingsWithdrawProvider({'accountId': account.id, 'amount': amount}).future);
                  }
                  ref.invalidate(businessSavingsListProvider); // Refresh list
                  Navigator.of(context).pop();
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
              child: Text(type == 'deposit' ? 'Deposit' : 'Withdraw', style: TextStyle(color: _textColor)),
            ),
          ],
        );
      },
    );
  }
}