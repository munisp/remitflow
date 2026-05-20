/// BillPaymentSuccess Screen
/// Journey: Bill Payment
/// ID: journey_08_bill_payment

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class BillPaymentSuccessScreen extends StatefulWidget {
  const BillPaymentSuccessScreen({Key? key}) : super(key: key);

  @override
  State<BillPaymentSuccessScreen> createState() => _BillPaymentSuccessScreenState();
}

class _BillPaymentSuccessScreenState extends State<BillPaymentSuccessScreen> {
  bool _isLoading = false;

  void _handlePrimaryAction() {
    // Haptic feedback
    HapticFeedback.mediumImpact();
    
    // TODO: Implement action logic
    print('BillPaymentSuccess: Primary action triggered');
    
    // Navigate to next screen
    // Navigator.push(context, MaterialPageRoute(builder: (context) => NextScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Bill Payment'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Text(
              'BillPaymentSuccess',
              style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Bill Payment',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: Colors.grey,
              ),
            ),
            const SizedBox(height: 24),
            
            // Content
            _buildContent(context),
            
            const SizedBox(height: 24),
            
            // Actions
            _buildActionButtons(context),
          ],
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Screen: BillPaymentSuccess',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        
        // TODO: Implement BillPaymentSuccess UI
        Container(
          height: 200,
          decoration: BoxDecoration(
            color: Colors.grey[200],
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ],
    );
  }

  Widget _buildActionButtons(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: _isLoading ? null : _handlePrimaryAction,
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.all(16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        child: Text(
          _isLoading ? 'Loading...' : 'Continue',
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
