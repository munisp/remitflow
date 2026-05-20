/// FraudResolution Screen
/// Journey: Fraud Detection
/// ID: journey_28_fraud

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class FraudResolutionScreen extends StatefulWidget {
  const FraudResolutionScreen({Key? key}) : super(key: key);

  @override
  State<FraudResolutionScreen> createState() => _FraudResolutionScreenState();
}

class _FraudResolutionScreenState extends State<FraudResolutionScreen> {
  bool _isLoading = false;

  void _handlePrimaryAction() {
    // Haptic feedback
    HapticFeedback.mediumImpact();
    
    // TODO: Implement action logic
    print('FraudResolution: Primary action triggered');
    
    // Navigate to next screen
    // Navigator.push(context, MaterialPageRoute(builder: (context) => NextScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fraud Detection'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Text(
              'FraudResolution',
              style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Fraud Detection',
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
          'Screen: FraudResolution',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        
        // TODO: Implement FraudResolution UI
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
