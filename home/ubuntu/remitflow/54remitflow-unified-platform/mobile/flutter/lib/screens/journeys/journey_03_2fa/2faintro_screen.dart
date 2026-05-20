/// 2FAIntro Screen
/// Journey: Two-Factor Authentication Configuration
/// ID: journey_03_2fa

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class 2FAIntroScreen extends StatefulWidget {
  const 2FAIntroScreen({Key? key}) : super(key: key);

  @override
  State<2FAIntroScreen> createState() => _2FAIntroScreenState();
}

class _2FAIntroScreenState extends State<2FAIntroScreen> {
  bool _isLoading = false;

  void _handlePrimaryAction() {
    // Haptic feedback
    HapticFeedback.mediumImpact();
    
    // TODO: Implement action logic
    print('2FAIntro: Primary action triggered');
    
    // Navigate to next screen
    // Navigator.push(context, MaterialPageRoute(builder: (context) => NextScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Two-Factor Authentication Configuration'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Text(
              '2FAIntro',
              style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Two-Factor Authentication Configuration',
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
          'Screen: 2FAIntro',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        
        // TODO: Implement 2FAIntro UI
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
