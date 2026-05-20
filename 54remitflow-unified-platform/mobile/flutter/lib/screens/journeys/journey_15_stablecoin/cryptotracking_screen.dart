/// CryptoTracking Screen
/// Journey: Cryptocurrency Remittance
/// ID: journey_15_stablecoin

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class CryptoTrackingScreen extends StatefulWidget {
  const CryptoTrackingScreen({Key? key}) : super(key: key);

  @override
  State<CryptoTrackingScreen> createState() => _CryptoTrackingScreenState();
}

class _CryptoTrackingScreenState extends State<CryptoTrackingScreen> {
  bool _isLoading = false;

  void _handlePrimaryAction() {
    // Haptic feedback
    HapticFeedback.mediumImpact();
    
    // TODO: Implement action logic
    print('CryptoTracking: Primary action triggered');
    
    // Navigate to next screen
    // Navigator.push(context, MaterialPageRoute(builder: (context) => NextScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cryptocurrency Remittance'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Text(
              'CryptoTracking',
              style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Cryptocurrency Remittance',
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
          'Screen: CryptoTracking',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        
        // TODO: Implement CryptoTracking UI
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
