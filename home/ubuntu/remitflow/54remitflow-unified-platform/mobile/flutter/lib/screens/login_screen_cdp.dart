import 'package:flutter/material.dart';
import 'dart:async';
import '../services/cdp_auth_service.dart';

class LoginScreenCDP extends StatefulWidget {
  final VoidCallback onLoginSuccess;

  const LoginScreenCDP({
    Key? key,
    required this.onLoginSuccess,
  }) : super(key: key);

  @override
  State<LoginScreenCDP> createState() => _LoginScreenCDPState();
}

class _LoginScreenCDPState extends State<LoginScreenCDP> {
  final _cdpAuth = CDPAuthService();
  final _emailController = TextEditingController();
  final _otpController = TextEditingController();

  String? _flowId;
  bool _showOTPField = false;
  bool _isLoading = false;
  String? _errorMessage;
  int _resendCooldown = 0;
  Timer? _cooldownTimer;

  @override
  void dispose() {
    _emailController.dispose();
    _otpController.dispose();
    _cooldownTimer?.cancel();
    super.dispose();
  }

  void _startCooldown() {
    setState(() {
      _resendCooldown = 60;
    });

    _cooldownTimer?.cancel();
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_resendCooldown > 0) {
        setState(() {
          _resendCooldown--;
        });
      } else {
        timer.cancel();
      }
    });
  }

  Future<void> _sendOTP() async {
    if (_emailController.text.isEmpty) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final flowId = await _cdpAuth.sendOTP(_emailController.text);
      setState(() {
        _flowId = flowId;
        _showOTPField = true;
        _isLoading = false;
      });
      _startCooldown();
    } catch (e) {
      setState(() {
        _errorMessage = 'Failed to send OTP. Please try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _verifyOTP() async {
    if (_flowId == null || _otpController.text.length != 6) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await _cdpAuth.verifyOTP(
        _flowId!,
        _otpController.text,
        _emailController.text,
      );

      widget.onLoginSuccess();
    } catch (e) {
      setState(() {
        _errorMessage = 'Invalid OTP. Please try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _resendOTP() async {
    if (_resendCooldown > 0) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _otpController.clear();
    });

    try {
      final flowId = await _cdpAuth.sendOTP(_emailController.text);
      setState(() {
        _flowId = flowId;
        _isLoading = false;
      });
      _startCooldown();
    } catch (e) {
      setState(() {
        _errorMessage = 'Failed to resend OTP. Please try again.';
        _isLoading = false;
      });
    }
  }

  void _goBack() {
    setState(() {
      _showOTPField = false;
      _otpController.clear();
      _flowId = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFFE3F2FD), Color(0xFFC5CAE9)],
          ),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 60),

                // Logo
                Center(
                  child: Container(
                    width: 80,
                    height: 80,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [Color(0xFF2196F3), Color(0xFF3F51B5)],
                      ),
                    ),
                    child: const Icon(
                      Icons.email,
                      size: 36,
                      color: Colors.white,
                    ),
                  ),
                ),

                const SizedBox(height: 24),

                // Title
                const Text(
                  'Welcome Back',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1A237E),
                  ),
                  textAlign: TextAlign.center,
                ),

                const SizedBox(height: 8),

                Text(
                  _showOTPField
                      ? 'Enter the code sent to your email'
                      : 'Sign in with your email',
                  style: const TextStyle(
                    fontSize: 16,
                    color: Colors.grey,
                  ),
                  textAlign: TextAlign.center,
                ),

                const SizedBox(height: 24),

                // Error Message
                if (_errorMessage != null)
                  Container(
                    padding: const EdgeInsets.all(16),
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFEBEE),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.error_outline,
                          color: Color(0xFFD32F2F),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            _errorMessage!,
                            style: const TextStyle(
                              fontSize: 14,
                              color: Color(0xFFD32F2F),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                // Form
                if (!_showOTPField)
                  _buildEmailForm()
                else
                  _buildOTPForm(),

                const SizedBox(height: 32),

                // Info Banner
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE3F2FD),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: const [
                      Icon(
                        Icons.shield_outlined,
                        color: Color(0xFF2196F3),
                      ),
                      SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Secure email authentication powered by Coinbase. Your wallet is created automatically.',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey,
                            height: 1.3,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmailForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Email Address',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: Colors.grey,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _emailController,
          decoration: InputDecoration(
            hintText: 'you@example.com',
            prefixIcon: const Icon(Icons.email_outlined),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            filled: true,
            fillColor: Colors.white,
          ),
          keyboardType: TextInputType.emailAddress,
          enabled: !_isLoading,
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: _isLoading || _emailController.text.isEmpty
              ? null
              : _sendOTP,
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedRectangle(
              borderRadius: BorderRadius.circular(12),
            ),
            backgroundColor: const Color(0xFF2196F3),
          ),
          child: _isLoading
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                  ),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: const [
                    Text(
                      'Send Code',
                      style: TextStyle(fontSize: 16),
                    ),
                    SizedBox(width: 8),
                    Icon(Icons.arrow_forward, size: 20),
                  ],
                ),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              "Don't have an account? ",
              style: TextStyle(fontSize: 14, color: Colors.grey),
            ),
            TextButton(
              onPressed: () {
                // Navigate to register
              },
              child: const Text(
                'Sign up',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildOTPForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Verification Code',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: Colors.grey,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _otpController,
          decoration: InputDecoration(
            hintText: '000000',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            filled: true,
            fillColor: Colors.white,
          ),
          style: const TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w500,
            letterSpacing: 8,
          ),
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          maxLength: 6,
          enabled: !_isLoading,
        ),
        const SizedBox(height: 8),
        Text(
          'Code sent to ${_emailController.text}',
          style: const TextStyle(
            fontSize: 12,
            color: Colors.grey,
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: _isLoading || _otpController.text.length != 6
              ? null
              : _verifyOTP,
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedCornerBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            backgroundColor: const Color(0xFF2196F3),
          ),
          child: _isLoading
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                  ),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: const [
                    Text(
                      'Verify & Sign In',
                      style: TextStyle(fontSize: 16),
                    ),
                    SizedBox(width: 8),
                    Icon(Icons.arrow_forward, size: 20),
                  ],
                ),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton.icon(
              onPressed: _goBack,
              icon: const Icon(Icons.arrow_back, size: 16),
              label: const Text('Change email'),
              style: TextButton.styleFrom(
                foregroundColor: Colors.grey,
              ),
            ),
            TextButton(
              onPressed: _resendCooldown > 0 ? null : _resendOTP,
              child: Text(
                _resendCooldown > 0
                    ? 'Resend in ${_resendCooldown}s'
                    : 'Resend code',
                style: TextStyle(
                  fontWeight: FontWeight.w500,
                  color: _resendCooldown > 0
                      ? Colors.grey
                      : const Color(0xFF2196F3),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
