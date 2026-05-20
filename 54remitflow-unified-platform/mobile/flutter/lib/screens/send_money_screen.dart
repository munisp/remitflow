import 'package:flutter/material.dart';
import '../services/beneficiary_service.dart';
import '../services/analytics_service.dart';

class SendMoneyScreen extends StatefulWidget {
  @override
  _SendMoneyScreenState createState() => _SendMoneyScreenState();
}

class _SendMoneyScreenState extends State<SendMoneyScreen> {
  int _currentStep = 0;
  String? _selectedBeneficiary;
  double _amount = 0;
  String _currency = 'NGN';
  String _paymentSystem = '';
  String _purpose = '';
  bool _loading = false;

  final List<Map<String, dynamic>> paymentSystems = [
    {'id': 'NIBSS', 'name': 'NIBSS', 'desc': 'Nigeria Inter-Bank Settlement', 'fee': 50, 'time': 'Instant'},
    {'id': 'PAPSS', 'name': 'PAPSS', 'desc': 'Pan-African Payment System', 'fee': 100, 'time': '1-2 hours'},
    {'id': 'PIX', 'name': 'PIX', 'desc': 'Brazil Instant Payment', 'fee': 75, 'time': 'Instant'},
    {'id': 'UPI', 'name': 'UPI', 'desc': 'Unified Payments Interface', 'fee': 60, 'time': 'Instant'},
    {'id': 'Mojaloop', 'name': 'Mojaloop', 'desc': 'Open-source Payment', 'fee': 80, 'time': '1 hour'},
    {'id': 'CIPS', 'name': 'CIPS', 'desc': 'China International Payment', 'fee': 120, 'time': '2-3 hours'},
  ];

  @override
  void initState() {
    super.initState();
    AnalyticsService.trackScreenView('SendMoney');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Send Money'),
        elevation: 0,
      ),
      body: Column(
        children: [
          _buildProgressIndicator(),
          Expanded(
            child: _buildStepContent(),
          ),
          _buildNavigationButtons(),
        ],
      ),
    );
  }

  Widget _buildProgressIndicator() {
    return Container(
      padding: EdgeInsets.all(20),
      color: Colors.white,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: List.generate(4, (index) {
          return Expanded(
            child: Column(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _currentStep >= index ? Colors.blue : Colors.grey[300],
                  ),
                  child: Center(
                    child: Text(
                      '${index + 1}',
                      style: TextStyle(
                        color: _currentStep >= index ? Colors.white : Colors.grey[600],
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                SizedBox(height: 8),
                Text(
                  ['Beneficiary', 'Amount', 'Review', 'Confirm'][index],
                  style: TextStyle(fontSize: 12),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _buildStepContent() {
    switch (_currentStep) {
      case 0:
        return _buildStep1();
      case 1:
        return _buildStep2();
      case 2:
        return _buildStep3();
      case 3:
        return _buildStep4();
      default:
        return Container();
    }
  }

  Widget _buildStep1() {
    return ListView(
      padding: EdgeInsets.all(20),
      children: [
        Text('Select Beneficiary', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        SizedBox(height: 20),
        _buildBeneficiaryCard('Jane Doe', 'First Bank', '1234567890'),
        _buildBeneficiaryCard('John Smith', 'GTBank', '9876543210'),
      ],
    );
  }

  Widget _buildBeneficiaryCard(String name, String bank, String account) {
    return Card(
      margin: EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          child: Text(name.split(' ').map((n) => n[0]).join()),
        ),
        title: Text(name),
        subtitle: Text('$bank • $account'),
        onTap: () {
          setState(() {
            _selectedBeneficiary = name;
          });
        },
        selected: _selectedBeneficiary == name,
      ),
    );
  }

  Widget _buildStep2() {
    return ListView(
      padding: EdgeInsets.all(20),
      children: [
        Text('Enter Amount', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        SizedBox(height: 20),
        TextField(
          decoration: InputDecoration(
            labelText: 'Amount',
            border: OutlineInputBorder(),
            prefixText: '$_currency ',
          ),
          keyboardType: TextInputType.number,
          onChanged: (value) {
            setState(() {
              _amount = double.tryParse(value) ?? 0;
            });
          },
        ),
        SizedBox(height: 20),
        Text('Select Payment System', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        SizedBox(height: 12),
        ...paymentSystems.map((ps) => _buildPaymentSystemCard(ps)).toList(),
        SizedBox(height: 20),
        TextField(
          decoration: InputDecoration(
            labelText: 'Purpose (Optional)',
            border: OutlineInputBorder(),
          ),
          onChanged: (value) {
            setState(() {
              _purpose = value;
            });
          },
        ),
      ],
    );
  }

  Widget _buildPaymentSystemCard(Map<String, dynamic> ps) {
    bool isSelected = _paymentSystem == ps['id'];
    return Card(
      margin: EdgeInsets.only(bottom: 12),
      color: isSelected ? Colors.blue.withOpacity(0.1) : null,
      child: ListTile(
        title: Text(ps['name'], style: TextWeight.bold),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(ps['desc']),
            SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Fee: $_currency ${ps['fee']}', style: TextStyle(fontSize: 12)),
                Text(ps['time'], style: TextStyle(fontSize: 12, color: Colors.green)),
              ],
            ),
          ],
        ),
        onTap: () {
          setState(() {
            _paymentSystem = ps['id'];
          });
        },
      ),
    );
  }

  Widget _buildStep3() {
    var selectedPS = paymentSystems.firstWhere((ps) => ps['id'] == _paymentSystem, orElse: () => {});
    double fee = selectedPS['fee']?.toDouble() ?? 0;
    double total = _amount + fee;

    return ListView(
      padding: EdgeInsets.all(20),
      children: [
        Text('Review Transaction', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        SizedBox(height: 20),
        _buildReviewItem('Recipient', _selectedBeneficiary ?? ''),
        _buildReviewItem('Amount', '$_currency ${_amount.toStringAsFixed(2)}'),
        _buildReviewItem('Payment System', selectedPS['name'] ?? ''),
        _buildReviewItem('Fee', '$_currency ${fee.toStringAsFixed(2)}'),
        Container(
          padding: EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.blue,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Total', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              Text('$_currency ${total.toStringAsFixed(2)}', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildReviewItem(String label, String value) {
    return Container(
      padding: EdgeInsets.all(16),
      margin: EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.grey[100],
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[600])),
          Text(value, style: TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _buildStep4() {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(20),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Confirm Transaction', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            SizedBox(height: 16),
            Text(
              'Please review the details and confirm to proceed with the transaction.',
              textAlign: TextAlign.center,
            ),
            SizedBox(height: 12),
            Text(
              'This transaction will be processed securely using biometric authentication.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey[600]),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNavigationButtons() {
    return Container(
      padding: EdgeInsets.all(20),
      child: Row(
        children: [
          if (_currentStep > 0)
            Expanded(
              child: OutlinedButton(
                onPressed: () {
                  setState(() {
                    _currentStep--;
                  });
                },
                child: Text('Back'),
              ),
            ),
          if (_currentStep > 0) SizedBox(width: 12),
          Expanded(
            child: ElevatedButton(
              onPressed: _currentStep < 3 ? _handleNext : _handleSubmit,
              child: Text(_currentStep < 3 ? 'Next' : (_loading ? 'Processing...' : 'Confirm')),
            ),
          ),
        ],
      ),
    );
  }

  void _handleNext() {
    if (_currentStep < 3) {
      setState(() {
        _currentStep++;
      });
      AnalyticsService.trackButtonClick('send_money_step_${_currentStep}_next');
    }
  }

  Future<void> _handleSubmit() async {
    setState(() {
      _loading = true;
    });

    try {
      // Call appropriate payment system API
      await BeneficiaryService.processTransfer(_paymentSystem, {
        'beneficiary': _selectedBeneficiary,
        'amount': _amount,
        'currency': _currency,
        'purpose': _purpose,
      });

      AnalyticsService.trackRevenue(_amount, _currency, _paymentSystem);
      
      // Navigate to success screen
      Navigator.pushReplacementNamed(context, '/success');
    } catch (error) {
      AnalyticsService.trackError('send_money_failed', error.toString());
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Transaction failed. Please try again.')),
      );
    } finally {
      setState(() {
        _loading = false;
      });
    }
  }
}
