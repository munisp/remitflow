// cdp_auth_service.dart

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Custom exception for API-related errors.
class CdpAuthException implements Exception {
  final String message;
  final int? statusCode;

  CdpAuthException(this.message, {this.statusCode});

  @override
  String toString() => 'CdpAuthException: $message (Status: $statusCode)';
}

/// A simple model for the authenticated user data.
class User {
  final String id;
  final String email;
  final bool isWalletCreated;

  User({
    required this.id,
    required this.email,
    required this.isWalletCreated,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      email: json['email'] as String,
      isWalletCreated: json['is_wallet_created'] as bool,
    );
  }
}

/// A model to hold session tokens.
class Session {
  final String accessToken;
  final String refreshToken;
  final int expiresIn; // in seconds

  Session({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  factory Session.fromJson(Map<String, dynamic> json) {
    return Session(
      accessToken: json['access_token'] as String,
      refreshToken: json['refresh_token'] as String,
      expiresIn: json['expires_in'] as int,
    );
  }
}

/// A model for the user's wallet.
class Wallet {
  final String id;
  final double balance;
  final String currency;

  Wallet({
    required this.id,
    required this.balance,
    required this.currency,
  });

  factory Wallet.fromJson(Map<String, dynamic> json) {
    return Wallet(
      id: json['id'] as String,
      balance: (json['balance'] as num).toDouble(),
      currency: json['currency'] as String,
    );
  }
}

/// A service class to handle all CDP (Customer Data Platform) authentication and session management.
///
/// This service integrates with the assumed backend API endpoints for:
/// 1. Sending OTP via email.
/// 2. Verifying OTP, which handles both login and registration.
/// 3. Creating a user wallet.
/// 4. Managing session tokens (refresh and logout).
///
/// It uses `SharedPreferences` for secure, persistent storage of tokens.
class CdpAuthService {
  // Assumed base URL for the Nigerian Remittance Platform CDP API.
  static const String _baseUrl = 'https://api.nigerianremittance.com/v1';
  static const String _accessTokenKey = 'cdp_access_token';
  static const String _refreshTokenKey = 'cdp_refresh_token';

  final http.Client _httpClient;
  final SharedPreferences _prefs;

  // Private constructor for the Singleton pattern.
  CdpAuthService._(this._httpClient, this._prefs);

  // Static factory method to get the instance.
  static Future<CdpAuthService> create() async {
    final prefs = await SharedPreferences.getInstance();
    return CdpAuthService._(http.Client(), prefs);
  }

  /// Retrieves the stored access token.
  String? get accessToken => _prefs.getString(_accessTokenKey);

  /// Retrieves the stored refresh token.
  String? get refreshToken => _prefs.getString(_refreshTokenKey);

  /// Helper function to save session tokens to persistent storage.
  Future<void> _saveSession(Session session) async {
    await _prefs.setString(_accessTokenKey, session.accessToken);
    await _prefs.setString(_refreshTokenKey, session.refreshToken);
    // Optionally save expiry time for proactive refresh
  }

  /// Helper function to clear all session tokens from persistent storage.
  Future<void> _clearSession() async {
    await _prefs.remove(_accessTokenKey);
    await _prefs.remove(_refreshTokenKey);
  }

  /// Helper function to perform a POST request and handle common errors.
  ///
  /// The `loading` state is implicitly handled by the `Future` return type.
  Future<Map<String, dynamic>> _post(String endpoint, Map<String, dynamic> body) async {
    final uri = Uri.parse('$_baseUrl$endpoint');
    try {
      final response = await _httpClient.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        // Handle API-specific error messages
        final errorBody = jsonDecode(response.body);
        final errorMessage = errorBody['message'] ?? 'An unknown error occurred.';
        throw CdpAuthException(errorMessage, statusCode: response.statusCode);
      }
    } on http.ClientException catch (e) {
      // Network or client-side error
      throw CdpAuthException('Network error: Could not connect to the server. ${e.message}');
    } catch (e) {
      // General error (e.g., JSON decoding error)
      rethrow;
    }
  }

  /// Helper function to perform an authenticated POST request.
  Future<Map<String, dynamic>> _authPost(String endpoint, Map<String, dynamic> body) async {
    final token = accessToken;
    if (token == null) {
      throw CdpAuthException('Authentication required. No access token found.');
    }

    final uri = Uri.parse('$_baseUrl$endpoint');
    try {
      final response = await _httpClient.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(body),
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else if (response.statusCode == 401) {
        // Token expired or invalid, attempt refresh
        final success = await refreshTokenAndRetry(() => _authPost(endpoint, body));
        if (success is Map<String, dynamic>) {
          return success;
        }
        throw CdpAuthException('Session expired. Please log in again.', statusCode: 401);
      } else {
        final errorBody = jsonDecode(response.body);
        final errorMessage = errorBody['message'] ?? 'An unknown error occurred.';
        throw CdpAuthException(errorMessage, statusCode: response.statusCode);
      }
    } on http.ClientException catch (e) {
      throw CdpAuthException('Network error: Could not connect to the server. ${e.message}');
    } catch (e) {
      rethrow;
    }
  }

  /// Sends an OTP to the provided email address.
  ///
  /// Returns a success message string on success.
  Future<String> sendOtp({required String email}) async {
    // Basic validation
    if (!RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(email)) {
      throw CdpAuthException('Invalid email format.');
    }

    final response = await _post('/auth/otp/send', {'email': email});
    return response['message'] as String;
  }

  /// Verifies the OTP and handles user authentication (login/registration).
  ///
  /// Returns the authenticated [User] object on success.
  Future<User> verifyOtpAndAuthenticate({
    required String email,
    required String otp,
  }) async {
    // Basic validation
    if (otp.length != 6 || int.tryParse(otp) == null) {
      throw CdpAuthException('Invalid OTP format. Must be a 6-digit number.');
    }

    final response = await _post('/auth/otp/verify', {
      'email': email,
      'otp': otp,
    });

    final session = Session.fromJson(response['session']);
    final user = User.fromJson(response['user']);

    // Persist the new session tokens
    await _saveSession(session);

    return user;
  }

  /// Creates a new wallet for the authenticated user.
  ///
  /// Assumes the user is authenticated and returns the created [Wallet] object.
  Future<Wallet> createWallet({required String currency}) async {
    // Basic validation
    if (currency.isEmpty) {
      throw CdpAuthException('Currency cannot be empty.');
    }

    final response = await _authPost('/wallet/create', {'currency': currency});
    return Wallet.fromJson(response['wallet']);
  }

  /// Attempts to refresh the access token using the stored refresh token.
  ///
  /// Returns true on successful refresh, false otherwise.
  Future<bool> refreshAccessToken() async {
    final currentRefreshToken = refreshToken;
    if (currentRefreshToken == null) {
      return false; // No refresh token available
    }

    try {
      final response = await _post('/auth/token/refresh', {
        'refresh_token': currentRefreshToken,
      });

      final newSession = Session.fromJson(response['session']);
      // The refresh endpoint might not return a new refresh token, so we reuse the old one
      final sessionToSave = Session(
        accessToken: newSession.accessToken,
        refreshToken: currentRefreshToken,
        expiresIn: newSession.expiresIn,
      );

      await _saveSession(sessionToSave);
      return true;
    } on CdpAuthException catch (e) {
      // If refresh fails (e.g., refresh token expired), clear the session
      if (e.statusCode == 401) {
        await _clearSession();
      }
      return false;
    }
  }

  /// Attempts to refresh the token and retry the failed operation.
  ///
  /// This is a crucial part of session management.
  Future<dynamic> refreshTokenAndRetry(Function retryOperation) async {
    final isRefreshed = await refreshAccessToken();
    if (isRefreshed) {
      // Retry the original operation
      return await retryOperation();
    }
    return false;
  }

  /// Logs out the user by invalidating the token on the server and clearing local storage.
  Future<void> logout() async {
    final token = accessToken;
    if (token != null) {
      try {
        // Attempt to invalidate the token on the server
        await _authPost('/auth/logout', {});
      } on CdpAuthException {
        // Ignore server error on logout, we still clear local session
      }
    }
    // Always clear local session storage
    await _clearSession();
  }

  /// Checks if the user is currently authenticated.
  bool isAuthenticated() {
    // A simple check based on the presence of an access token.
    // In a real app, this should also check token expiry.
    return accessToken != null;
  }
}

// Example usage (for demonstration, not part of the service class itself):
/*
void main() async {
  // 1. Initialize the service
  final authService = await CdpAuthService.create();

  // 2. Send OTP
  try {
    print('Sending OTP...');
    final message = await authService.sendOtp(email: 'test@example.com');
    print('Success: $message');

    // 3. Verify OTP and Authenticate
    print('Verifying OTP...');
    final user = await authService.verifyOtpAndAuthenticate(
      email: 'test@example.com',
      otp: '123456', // Assumed OTP
    );
    print('Authenticated User: ${user.email}, Wallet Created: ${user.isWalletCreated}');

    // 4. Create Wallet (if not created)
    if (!user.isWalletCreated) {
      print('Creating wallet...');
      final wallet = await authService.createWallet(currency: 'NGN');
      print('Wallet Created: ID ${wallet.id}, Balance ${wallet.balance}');
    }

    // 5. Logout
    await authService.logout();
    print('Logged out successfully.');

  } on CdpAuthException catch (e) {
    print('Authentication Error: ${e.message}');
  } catch (e) {
    print('An unexpected error occurred: $e');
  }
}
*/