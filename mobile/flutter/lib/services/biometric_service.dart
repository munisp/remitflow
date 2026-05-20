/// biometric_service.dart
/// Handles Face ID / Touch ID / Fingerprint authentication for RemitFlow Flutter app.
/// Uses local_auth package (already in pubspec.yaml).

import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

class BiometricService {
  static final _auth = LocalAuthentication();
  static const _enabledKey = 'remitflow_biometric_enabled';
  static const _sessionKey = 'remitflow_biometric_session';

  /// Check if biometrics are available on this device.
  static Future<({bool available, String type})> checkAvailability() async {
    try {
      final canCheck = await _auth.canCheckBiometrics;
      final isDeviceSupported = await _auth.isDeviceSupported();
      if (!canCheck && !isDeviceSupported) {
        return (available: false, type: 'none');
      }
      final biometrics = await _auth.getAvailableBiometrics();
      String type = 'biometrics';
      if (biometrics.contains(BiometricType.face)) type = 'face';
      if (biometrics.contains(BiometricType.fingerprint)) type = 'fingerprint';
      return (available: true, type: type);
    } on PlatformException {
      return (available: false, type: 'none');
    }
  }

  /// Authenticate using biometrics.
  static Future<bool> authenticate({
    String reason = 'Authenticate to access RemitFlow',
  }) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
        ),
      );
    } on PlatformException {
      return false;
    }
  }

  /// Enable biometric login and store the session token.
  static Future<bool> enableBiometricLogin(String sessionToken) async {
    final authenticated = await authenticate(
      reason: 'Enable biometric login for RemitFlow',
    );
    if (!authenticated) return false;

    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, true);
    await prefs.setString(_sessionKey, sessionToken);
    return true;
  }

  /// Retrieve the stored session token using biometric authentication.
  static Future<String?> getBiometricSession() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_enabledKey) ?? false;
    if (!enabled) return null;

    final authenticated = await authenticate(
      reason: 'Verify your identity to sign in',
    );
    if (!authenticated) return null;

    return prefs.getString(_sessionKey);
  }

  /// Check if biometric login is enabled.
  static Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_enabledKey) ?? false;
  }

  /// Disable biometric login and clear stored session.
  static Future<void> disable() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_enabledKey);
    await prefs.remove(_sessionKey);
  }
}
