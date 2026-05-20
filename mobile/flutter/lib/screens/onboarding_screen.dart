import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/biometric_service.dart';
import '../services/push_notification_service.dart';

class OnboardingScreen extends StatefulWidget {
  final VoidCallback onComplete;
  const OnboardingScreen({super.key, required this.onComplete});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with TickerProviderStateMixin {
  int _step = 0;
  final List<String> _steps = ['welcome', 'pin', 'biometrics', 'notifications', 'done'];

  // PIN step
  final _pinController = TextEditingController();
  final _confirmPinController = TextEditingController();
  String _pinError = '';

  // Results
  bool _biometricEnabled = false;
  bool _notificationsEnabled = false;

  late AnimationController _slideController;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _slideController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 250),
    );
    _slideAnimation = Tween<Offset>(
      begin: Offset.zero,
      end: Offset.zero,
    ).animate(_slideController);
  }

  @override
  void dispose() {
    _slideController.dispose();
    _pinController.dispose();
    _confirmPinController.dispose();
    super.dispose();
  }

  void _nextStep() {
    if (_step < _steps.length - 1) {
      setState(() => _step++);
    }
  }

  Future<void> _handlePinSubmit() async {
    final pin = _pinController.text;
    final confirm = _confirmPinController.text;
    if (pin.length < 4) {
      setState(() => _pinError = 'PIN must be at least 4 digits');
      return;
    }
    if (pin != confirm) {
      setState(() => _pinError = 'PINs do not match');
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_pin', pin);
    await prefs.setBool('pin_enabled', true);
    setState(() => _pinError = '');
    _nextStep();
  }

  Future<void> _handleBiometrics(bool enable) async {
    if (enable) {
      final available = await BiometricService.isAvailable();
      if (!available) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Biometrics not available on this device')),
          );
        }
        _nextStep();
        return;
      }
      final success = await BiometricService.authenticate(
        'Enable biometric login for RemitFlow',
      );
      if (success) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool('biometric_enabled', true);
        setState(() => _biometricEnabled = true);
      }
    } else {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('biometric_enabled', false);
    }
    _nextStep();
  }

  Future<void> _handleNotifications(bool enable) async {
    if (enable) {
      final granted = await PushNotificationService.requestPermission();
      if (granted) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool('notifications_enabled', true);
        setState(() => _notificationsEnabled = true);
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('You can enable notifications later in Settings'),
            ),
          );
        }
      }
    }
    _nextStep();
  }

  Future<void> _handleComplete() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('onboarding_completed', true);
    widget.onComplete();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final progress = _step / (_steps.length - 1);

    return Scaffold(
      backgroundColor: const Color(0xFF0f0f1a),
      body: SafeArea(
        child: Column(
          children: [
            // Progress bar
            LinearProgressIndicator(
              value: progress,
              backgroundColor: const Color(0xFF1f1f2e),
              valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF7c3aed)),
              minHeight: 3,
            ),
            // Step dots
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(_steps.length - 1, (i) {
                  final isActive = i < _step;
                  final isCurrent = i == _step;
                  return AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    width: isCurrent ? 24 : 8,
                    height: 8,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(4),
                      color: isActive
                          ? const Color(0xFF7c3aed)
                          : isCurrent
                              ? const Color(0xFFa78bfa)
                              : const Color(0xFF2d2d3f),
                    ),
                  );
                }),
              ),
            ),
            // Content
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                transitionBuilder: (child, animation) => SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(1, 0),
                    end: Offset.zero,
                  ).animate(animation),
                  child: child,
                ),
                child: _buildStep(key: ValueKey(_step)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStep({required Key key}) {
    switch (_steps[_step]) {
      case 'welcome':
        return _WelcomeStep(key: key, onNext: _nextStep);
      case 'pin':
        return _PinStep(
          key: key,
          pinController: _pinController,
          confirmController: _confirmPinController,
          error: _pinError,
          onSubmit: _handlePinSubmit,
          onSkip: _nextStep,
        );
      case 'biometrics':
        return _BiometricsStep(key: key, onEnable: _handleBiometrics);
      case 'notifications':
        return _NotificationsStep(key: key, onEnable: _handleNotifications);
      case 'done':
        return _DoneStep(
          key: key,
          biometricEnabled: _biometricEnabled,
          notificationsEnabled: _notificationsEnabled,
          onComplete: _handleComplete,
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

// ─── Step Widgets ─────────────────────────────────────────────────────────────

class _WelcomeStep extends StatelessWidget {
  final VoidCallback onNext;
  const _WelcomeStep({super.key, required this.onNext});

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      emoji: '⚡',
      title: 'Welcome to RemitFlow',
      subtitle: 'Send money across borders instantly. Let\'s secure your account in 3 quick steps.',
      children: [
        const SizedBox(height: 8),
        ...[
          '🔒 Set a secure PIN',
          '👆 Enable biometric login',
          '🔔 Stay notified on transfers',
        ].map((f) => _FeatureTile(text: f)),
        const SizedBox(height: 16),
        _PrimaryButton(label: 'Get Started', onPressed: onNext),
      ],
    );
  }
}

class _PinStep extends StatelessWidget {
  final TextEditingController pinController;
  final TextEditingController confirmController;
  final String error;
  final VoidCallback onSubmit;
  final VoidCallback onSkip;

  const _PinStep({
    super.key,
    required this.pinController,
    required this.confirmController,
    required this.error,
    required this.onSubmit,
    required this.onSkip,
  });

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      emoji: '🔒',
      title: 'Set Your PIN',
      subtitle: 'Create a 4–6 digit PIN to secure your account',
      children: [
        _PinInput(controller: pinController, placeholder: 'Enter PIN'),
        const SizedBox(height: 12),
        _PinInput(controller: confirmController, placeholder: 'Confirm PIN'),
        if (error.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(error, style: const TextStyle(color: Color(0xFFf87171), fontSize: 13)),
        ],
        const SizedBox(height: 16),
        _PrimaryButton(label: 'Set PIN', onPressed: onSubmit),
        const SizedBox(height: 8),
        GestureDetector(
          onTap: onSkip,
          child: const Text('Skip for now',
              style: TextStyle(color: Color(0xFF6b7280), fontSize: 14)),
        ),
      ],
    );
  }
}

class _BiometricsStep extends StatelessWidget {
  final Function(bool) onEnable;
  const _BiometricsStep({super.key, required this.onEnable});

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      emoji: '👆',
      title: 'Enable Biometric Login',
      subtitle: 'Use fingerprint or face recognition to log in faster and more securely',
      children: [
        _PrimaryButton(label: 'Enable Biometrics', onPressed: () => onEnable(true)),
        const SizedBox(height: 12),
        _SecondaryButton(label: 'Not Now', onPressed: () => onEnable(false)),
      ],
    );
  }
}

class _NotificationsStep extends StatelessWidget {
  final Function(bool) onEnable;
  const _NotificationsStep({super.key, required this.onEnable});

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      emoji: '🔔',
      title: 'Stay Informed',
      subtitle: 'Get instant notifications for transfers, FX alerts, and KYC updates',
      children: [
        ...[
          '✅ Transfer confirmations',
          '💱 Favourable exchange rates',
          '📋 KYC status updates',
          '🚨 Security alerts',
        ].map((n) => _FeatureTile(text: n)),
        const SizedBox(height: 16),
        _PrimaryButton(label: 'Enable Notifications', onPressed: () => onEnable(true)),
        const SizedBox(height: 12),
        _SecondaryButton(label: 'Not Now', onPressed: () => onEnable(false)),
      ],
    );
  }
}

class _DoneStep extends StatelessWidget {
  final bool biometricEnabled;
  final bool notificationsEnabled;
  final VoidCallback onComplete;

  const _DoneStep({
    super.key,
    required this.biometricEnabled,
    required this.notificationsEnabled,
    required this.onComplete,
  });

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      emoji: '🎉',
      title: 'You\'re All Set!',
      subtitle: 'Your account is secured and ready to use',
      children: [
        ...[
          '🔒 PIN: Enabled',
          '👆 Biometrics: ${biometricEnabled ? "Enabled" : "Skipped"}',
          '🔔 Notifications: ${notificationsEnabled ? "Enabled" : "Skipped"}',
        ].map((s) => _FeatureTile(text: s)),
        const SizedBox(height: 16),
        _PrimaryButton(label: 'Start Using RemitFlow', onPressed: onComplete),
      ],
    );
  }
}

// ─── Shared UI Primitives ─────────────────────────────────────────────────────

class _StepScaffold extends StatelessWidget {
  final String emoji;
  final String title;
  final String subtitle;
  final List<Widget> children;

  const _StepScaffold({
    required this.emoji,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const SizedBox(height: 16),
          Text(emoji, style: const TextStyle(fontSize: 64)),
          const SizedBox(height: 16),
          Text(title,
              style: const TextStyle(
                  fontSize: 28, fontWeight: FontWeight.w700, color: Color(0xFFf9fafb)),
              textAlign: TextAlign.center),
          const SizedBox(height: 12),
          Text(subtitle,
              style: const TextStyle(fontSize: 16, color: Color(0xFF9ca3af), height: 1.5),
              textAlign: TextAlign.center),
          const SizedBox(height: 24),
          ...children,
        ],
      ),
    );
  }
}

class _FeatureTile extends StatelessWidget {
  final String text;
  const _FeatureTile({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1f1f2e),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(text, style: const TextStyle(color: Color(0xFFe5e7eb), fontSize: 15)),
    );
  }
}

class _PinInput extends StatelessWidget {
  final TextEditingController controller;
  final String placeholder;
  const _PinInput({required this.controller, required this.placeholder});

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: true,
      keyboardType: TextInputType.number,
      maxLength: 6,
      textAlign: TextAlign.center,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      style: const TextStyle(
          color: Color(0xFFf9fafb), fontSize: 24, letterSpacing: 12),
      decoration: InputDecoration(
        hintText: placeholder,
        hintStyle: const TextStyle(color: Color(0xFF9ca3af), letterSpacing: 0, fontSize: 16),
        counterText: '',
        filled: true,
        fillColor: const Color(0xFF1f1f2e),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF2d2d3f)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF2d2d3f)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF7c3aed)),
        ),
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback onPressed;
  const _PrimaryButton({required this.label, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF7c3aed),
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        child: Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      ),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  final String label;
  final VoidCallback onPressed;
  const _SecondaryButton({required this.label, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFF9ca3af),
          side: const BorderSide(color: Color(0xFF2d2d3f)),
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        child: Text(label, style: const TextStyle(fontSize: 16)),
      ),
    );
  }
}
