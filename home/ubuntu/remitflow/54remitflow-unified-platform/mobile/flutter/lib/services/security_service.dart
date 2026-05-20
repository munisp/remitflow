import 'package:local_auth/local_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'dart:convert';
import 'package:crypto/crypto.dart';

class SecurityService {
  static final LocalAuthentication _localAuth = LocalAuthentication();
  static final FlutterSecureStorage _secureStorage = FlutterSecureStorage();

  // Biometric Authentication
  static Future<bool> isBiometricAvailable() async {
    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isDeviceSupported = await _localAuth.isDeviceSupported();
      return canCheck && isDeviceSupported;
    } catch (e) {
      return false;
    }
  }

  static Future<bool> authenticateWithBiometrics(String reason) async {
    try {
      return await _localAuth.authenticate(
        localizedReason: reason,
        options: AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
        ),
      );
    } catch (e) {
      return false;
    }
  }

  // Secure Storage
  static Future<void> securelyStore(String key, String value) async {
    await _secureStorage.write(key: key, value: value);
  }

  static Future<String?> securelyRetrieve(String key) async {
    return await _secureStorage.read(key: key);
  }

  static Future<void> securelyDelete(String key) async {
    await _secureStorage.delete(key: key);
  }

  // Encryption
  static String encrypt(String data, String key) {
    final bytes = utf8.encode(data);
    final keyBytes = utf8.encode(key);
    final hmac = Hmac(sha256, keyBytes);
    final digest = hmac.convert(bytes);
    return digest.toString();
  }

  static String hash(String data) {
    return sha256.convert(utf8.encode(data)).toString();
  }

  // Session Management
  static Future<void> createSession(String token) async {
    await securelyStore('session_token', token);
  }

  static Future<String?> getSession() async {
    return await securelyRetrieve('session_token');
  }

  static Future<void> clearSession() async {
    await securelyDelete('session_token');
  }
}
