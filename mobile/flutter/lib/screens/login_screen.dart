import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../services/biometric_service.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  bool _obscure = true;
  bool _biometricEnabled = false;
  String _biometricType = 'none';
  bool _biometricLoading = false;

  @override
  void initState() {
    super.initState();
    _checkBiometric();
  }

  Future<void> _checkBiometric() async {
    final result = await BiometricService.checkAvailability();
    if (!result.available) return;
    final enabled = await BiometricService.isEnabled();
    if (mounted) {
      setState(() {
        _biometricType = result.type;
        _biometricEnabled = enabled;
      });
      if (enabled) _handleBiometricLogin();
    }
  }

  Future<void> _handleBiometricLogin() async {
    setState(() => _biometricLoading = true);
    try {
      final session = await BiometricService.getBiometricSession();
      if (session != null && mounted) {
        final success = await ref.read(authProvider.notifier).login(session);
        if (success && mounted) context.go('/dashboard');
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Biometric verification failed. Please use your session token.'), backgroundColor: Colors.red),
        );
      }
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Biometric authentication error.')));
    } finally {
      if (mounted) setState(() => _biometricLoading = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (_controller.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter your session token')),
      );
      return;
    }
    setState(() => _loading = true);
    final success = await ref.read(authProvider.notifier).login(_controller.text.trim());
    if (mounted) {
      setState(() => _loading = false);
      if (success) {
        context.go('/dashboard');
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Invalid session token. Please try again.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF0F0F1A), Color(0xFF1A1A2E), Color(0xFF16213E)],
          ),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const SizedBox(height: 60),
                const Text('💸', style: TextStyle(fontSize: 72)),
                const SizedBox(height: 16),
                const Text(
                  'RemitFlow',
                  style: TextStyle(fontSize: 36, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: -1),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Cross-Border Remittance Platform',
                  style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
                ),
                const SizedBox(height: 48),
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A2E),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFF2D2D4E)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Sign In', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white)),
                      const SizedBox(height: 8),
                      const Text(
                        'Enter your session token from the web app to continue',
                        style: TextStyle(fontSize: 13, color: Color(0xFF9CA3AF), height: 1.5),
                      ),
                      const SizedBox(height: 24),
                      TextField(
                        controller: _controller,
                        obscureText: _obscure,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Session token',
                          suffixIcon: IconButton(
                            icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility, color: const Color(0xFF6B7280)),
                            onPressed: () => setState(() => _obscure = !_obscure),
                          ),
                        ),
                        onSubmitted: (_) => _login(),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _loading ? null : _login,
                          child: _loading
                              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                              : const Text('Sign In'),
                        ),
                      ),
                      if (_biometricEnabled && _biometricType != 'none') ...[  
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton(
                            onPressed: _biometricLoading ? null : _handleBiometricLogin,
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: Color(0xFF6366F1)),
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                            child: _biometricLoading
                                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Color(0xFF6366F1), strokeWidth: 2))
                                : Text(
                                    '${_biometricType == 'face' ? '🪪' : '👆'} ${_biometricType == 'face' ? 'Sign in with Face ID' : 'Sign in with Fingerprint'}',
                                    style: const TextStyle(color: Color(0xFF6366F1), fontSize: 15, fontWeight: FontWeight.w600),
                                  ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 16),
                      const Text(
                        'Visit remitflow.manus.space on your browser to get your session token from Settings → API Access.',
                        style: TextStyle(fontSize: 12, color: Color(0xFF6B7280), height: 1.5),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 32),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  alignment: WrapAlignment.center,
                  children: ['150+ Countries', 'Real-time FX', 'Bank-grade Security', 'Instant Transfers']
                      .map((f) => Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1A1A2E),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: const Color(0xFF2D2D4E)),
                            ),
                            child: Text(f, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                          ))
                      .toList(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
