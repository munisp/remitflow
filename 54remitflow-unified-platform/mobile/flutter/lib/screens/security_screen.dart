// File: /home/ubuntu/NIGERIAN_REMITTANCE_100_PARITY/mobile/flutter/lib/screens/security_screen.dart

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert'; // For mock API response
import 'dart:async'; // For Future/async operations

// --- 1. State Management (Provider) ---

/// Mock API Service
class ApiService {
  Future<Map<String, dynamic>> fetchSecuritySettings() async {
    // Mock API call delay
    await Future.delayed(const Duration(seconds: 1));
    // Mock successful response
    return {
      'is2faEnabled': true,
      'isPinSet': true,
      'isBiometricEnabled': false,
      'devices': [
        {'id': '1', 'name': 'Current Device (Android)', 'lastActive': 'Just now'},
        {'id': '2', 'name': 'Old iPhone 12', 'lastActive': '2 days ago'},
      ],
    };
  }

  Future<bool> updateSetting(String setting, bool value) async {
    // Mock API call delay
    await Future.delayed(const Duration(seconds: 1));
    // Mock successful update
    return true;
  }

  Future<bool> removeDevice(String deviceId) async {
    // Mock API call delay
    await Future.delayed(const Duration(seconds: 1));
    // Mock successful removal
    return true;
  }

  Future<bool> processPayment() async {
    // Mock payment gateway integration
    await Future.delayed(const Duration(seconds: 2));
    // Mock successful payment
    return true;
  }
}

/// Security Settings Model
class SecuritySettings {
  bool is2faEnabled;
  bool isPinSet;
  bool isBiometricEnabled;
  List<Map<String, String>> devices;

  SecuritySettings({
    required this.is2faEnabled,
    required this.isPinSet,
    required this.isBiometricEnabled,
    required this.devices,
  });

  factory SecuritySettings.fromJson(Map<String, dynamic> json) {
    return SecuritySettings(
      is2faEnabled: json['is2faEnabled'] as bool,
      isPinSet: json['isPinSet'] as bool,
      isBiometricEnabled: json['isBiometricEnabled'] as bool,
      devices: (json['devices'] as List)
          .map((e) => Map<String, String>.from(e))
          .toList(),
    );
  }
}

/// Security Provider (State Management)
class SecurityProvider with ChangeNotifier {
  final ApiService _apiService = ApiService();
  final LocalAuthentication _localAuth = LocalAuthentication();
  SecuritySettings? _settings;
  bool _isLoading = false;
  String? _errorMessage;

  SecuritySettings? get settings => _settings;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  SecurityProvider() {
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      // Try to load from offline storage first
      final prefs = await SharedPreferences.getInstance();
      final offlineData = prefs.getString('security_settings');

      if (offlineData != null) {
        _settings = SecuritySettings.fromJson(json.decode(offlineData));
        // Use offline data while fetching fresh data in the background
      }

      // Fetch fresh data from API
      final apiData = await _apiService.fetchSecuritySettings();
      _settings = SecuritySettings.fromJson(apiData);

      // Save to offline storage
      await prefs.setString('security_settings', json.encode(apiData));
    } catch (e) {
      _errorMessage = 'Failed to load settings. Check your connection.';
      // If offline data exists, keep it. Otherwise, settings will be null.
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> toggle2FA(bool value) async {
    if (_settings == null) return;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final success = await _apiService.updateSetting('is2faEnabled', value);
      if (success) {
        _settings!.is2faEnabled = value;
        // Update offline storage
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('security_settings', json.encode({
          'is2faEnabled': _settings!.is2faEnabled,
          'isPinSet': _settings!.isPinSet,
          'isBiometricEnabled': _settings!.isBiometricEnabled,
          'devices': _settings!.devices,
        }));
      } else {
        _errorMessage = 'Failed to update 2FA setting.';
      }
    } catch (e) {
      _errorMessage = 'An error occurred while updating 2FA.';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> authenticateBiometric() async {
    try {
      final bool canAuthenticate = await _localAuth.canCheckBiometrics;
      if (!canAuthenticate) {
        _errorMessage = 'Biometric authentication not available on this device.';
        notifyListeners();
        return false;
      }

      final bool didAuthenticate = await _localAuth.authenticate(
        localizedReason: 'Please authenticate to enable/disable biometric login',
        options: const AuthenticationOptions(
          stickyAuth: true,
        ),
      );

      if (didAuthenticate) {
        // Mock API update for biometric setting
        await _apiService.updateSetting('isBiometricEnabled', !_settings!.isBiometricEnabled);
        _settings!.isBiometricEnabled = !_settings!.isBiometricEnabled;
        notifyListeners();
      }
      return didAuthenticate;
    } catch (e) {
      _errorMessage = 'Biometric authentication failed: $e';
      notifyListeners();
      return false;
    }
  }

  Future<void> removeDevice(String deviceId) async {
    if (_settings == null) return;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final success = await _apiService.removeDevice(deviceId);
      if (success) {
        _settings!.devices.removeWhere((device) => device['id'] == deviceId);
        // Update offline storage
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('security_settings', json.encode({
          'is2faEnabled': _settings!.is2faEnabled,
          'isPinSet': _settings!.isPinSet,
          'isBiometricEnabled': _settings!.isBiometricEnabled,
          'devices': _settings!.devices,
        }));
      } else {
        _errorMessage = 'Failed to remove device.';
      }
    } catch (e) {
      _errorMessage = 'An error occurred while removing device.';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> makePayment() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final success = await _apiService.processPayment();
      if (success) {
        // Payment successful logic
        _errorMessage = 'Payment processed successfully (Mock).';
      } else {
        _errorMessage = 'Payment failed (Mock).';
      }
    } catch (e) {
      _errorMessage = 'An error occurred during payment.';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}

// --- 2. Screen Implementation (StatefulWidget) ---

/// The main security settings screen.
class SecurityScreen extends StatefulWidget {
  /// A constant constructor for the SecurityScreen.
  const SecurityScreen({super.key});

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  final _pinFormKey = GlobalKey<FormState>();
  final TextEditingController _pinController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Fetch settings on initial load
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<SecurityProvider>(context, listen: false)._loadSettings();
    });
  }

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  /// Handles the PIN setup/change logic.
  void _handlePinSetup() {
    if (_pinFormKey.currentState!.validate()) {
      // Mock PIN setup logic
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('PIN updated to ${_pinController.text} (Mock)')),
      );
      // In a real app, this would involve an API call and state update
      Navigator.of(context).pop();
    }
  }

  /// Shows a dialog for PIN setup/change.
  void _showPinDialog(bool isSet) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(isSet ? 'Change PIN' : 'Set PIN'),
          content: Form(
            key: _pinFormKey,
            child: TextFormField(
              controller: _pinController,
              keyboardType: TextInputType.number,
              obscureText: true,
              maxLength: 4,
              decoration: const InputDecoration(
                labelText: 'New PIN',
                border: OutlineInputBorder(),
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Please enter a PIN.';
                }
                if (value.length != 4) {
                  return 'PIN must be 4 digits.';
                }
                return null;
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: _handlePinSetup,
              child: Text(isSet ? 'Change' : 'Set'),
            ),
          ],
        );
      },
    );
  }

  /// Builds the main content of the screen.
  Widget _buildContent(SecurityProvider provider) {
    if (provider.isLoading && provider.settings == null) {
      return const Center(child: CircularProgressIndicator(key: Key('loadingIndicator')));
    }

    if (provider.errorMessage != null && provider.settings == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                provider.errorMessage!,
                style: const TextStyle(color: Colors.red),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              ElevatedButton(
                onPressed: provider._loadSettings,
                child: const Text('Retry Load'),
              ),
            ],
          ),
        ),
      );
    }

    final settings = provider.settings;
    if (settings == null) {
      // Should not happen if error handling is correct, but as a fallback
      return const Center(child: Text('No security settings available.'));
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          // --- 2FA Setting ---
          _buildSectionTitle('Two-Factor Authentication (2FA)'),
          SwitchListTile(
            title: const Text('Enable 2FA'),
            subtitle: const Text('Requires a second step to verify your identity.'),
            value: settings.is2faEnabled,
            onChanged: provider.isLoading
                ? null
                : (bool value) => provider.toggle2FA(value),
            secondary: const Icon(Icons.security),
            // Accessibility: role is implicitly switch
          ),
          const Divider(),

          // --- PIN Management ---
          _buildSectionTitle('Transaction PIN'),
          ListTile(
            title: Text(settings.isPinSet ? 'Change Transaction PIN' : 'Set Transaction PIN'),
            subtitle: Text(settings.isPinSet ? 'Your PIN is set.' : 'Set a PIN for secure transactions.'),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: provider.isLoading
                ? null
                : () => _showPinDialog(settings.isPinSet),
            // Accessibility: role is implicitly button
          ),
          const Divider(),

          // --- Biometric Authentication ---
          _buildSectionTitle('Biometric Login'),
          SwitchListTile(
            title: const Text('Enable Biometric (Fingerprint/Face ID)'),
            subtitle: const Text('Use your device\'s biometric sensor to log in.'),
            value: settings.isBiometricEnabled,
            onChanged: provider.isLoading
                ? null
                : (bool value) async {
                    if (await provider.authenticateBiometric()) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Biometric login ${value ? 'enabled' : 'disabled'}')),
                      );
                    }
                  },
            secondary: const Icon(Icons.fingerprint),
          ),
          const Divider(),

          // --- Device Management ---
          _buildSectionTitle('Device Management'),
          ...settings.devices.map((device) => _buildDeviceTile(provider, device)).toList(),
          const Divider(),

          // --- Payment Gateway Mock (Requirement) ---
          _buildSectionTitle('Payment Gateway Integration (Mock)'),
          ListTile(
            title: const Text('Test Secure Payment'),
            subtitle: const Text('Simulate a secure transaction via a payment gateway.'),
            trailing: provider.isLoading
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.payment),
            onTap: provider.isLoading
                ? null
                : () async {
                    await provider.makePayment();
                    if (provider.errorMessage != null) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(provider.errorMessage!)),
                      );
                    }
                  },
          ),
          const Divider(),

          // --- Error Display ---
          if (provider.errorMessage != null && !provider.isLoading)
            Padding(
              padding: const EdgeInsets.only(top: 10.0),
              child: Text(
                'Last Error: ${provider.errorMessage!}',
                style: const TextStyle(color: Colors.orange, fontSize: 12),
                semanticsLabel: 'Security setting error: ${provider.errorMessage!}',
              ),
            ),
        ],
      ),
    );
  }

  /// Helper widget to build a section title.
  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(top: 16.0, bottom: 8.0),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
        semanticsLabel: 'Section title: $title',
      ),
    );
  }

  /// Helper widget to build a device management tile.
  Widget _buildDeviceTile(SecurityProvider provider, Map<String, String> device) {
    final isCurrent = device['name']!.contains('Current Device');
    return ListTile(
      leading: Icon(isCurrent ? Icons.phone_android : Icons.devices_other),
      title: Text(device['name']!),
      subtitle: Text('Last Active: ${device['lastActive']}'),
      trailing: isCurrent
          ? const Text('Current', style: TextStyle(color: Colors.green))
          : IconButton(
              icon: const Icon(Icons.delete, color: Colors.red),
              onPressed: provider.isLoading
                  ? null
                  : () => _confirmDeviceRemoval(provider, device),
              tooltip: 'Remove device ${device['name']}',
            ),
      // Accessibility: role is implicitly list item
    );
  }

  /// Shows a confirmation dialog for device removal.
  void _confirmDeviceRemoval(SecurityProvider provider, Map<String, String> device) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Remove Device'),
          content: Text('Are you sure you want to remove ${device['name']}? You will be logged out on that device.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () async {
                Navigator.of(context).pop();
                await provider.removeDevice(device['id']!);
                if (provider.errorMessage != null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(provider.errorMessage!)),
                  );
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('${device['name']} removed successfully.')),
                  );
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              child: const Text('Remove', style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    // Use ChangeNotifierProvider to provide the state to the screen
    return ChangeNotifierProvider(
      create: (_) => SecurityProvider(),
      child: Consumer<SecurityProvider>(
        builder: (context, provider, child) {
          return Scaffold(
            appBar: AppBar(
              title: const Text('Security Settings'),
              // Accessibility: AppBar title is a good semantic label
            ),
            body: Stack(
              children: [
                _buildContent(provider),
                // Global loading overlay
                if (provider.isLoading)
                  const Opacity(
                    opacity: 0.6,
                    child: ModalBarrier(dismissible: false, color: Colors.black),
                  ),
                if (provider.isLoading)
                  const Center(
                    child: CircularProgressIndicator(),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// --- 3. Example Usage (Optional, for completeness) ---
/*
void main() {
  runApp(
    ChangeNotifierProvider(
      create: (context) => SecurityProvider(),
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Security Demo',
      theme: ThemeData(
        primarySwatch: Colors.blue,
        visualDensity: VisualDensity.adaptivePlatformDensity,
      ),
      home: const SecurityScreen(),
    );
  }
}
*/
