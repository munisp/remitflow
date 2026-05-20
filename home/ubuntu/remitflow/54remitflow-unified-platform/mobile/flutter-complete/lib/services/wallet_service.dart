// Flutter Wallet Service
import '../api/api_client.dart';

class WalletBalance {
  final String currency;
  final double balance;
  final String symbol;

  WalletBalance({required this.currency, required this.balance, required this.symbol});

  factory WalletBalance.fromJson(Map<String, dynamic> json) {
    return WalletBalance(
      currency: json['currency'],
      balance: json['balance'].toDouble(),
      symbol: json['symbol'],
    );
  }
}

class UserProfile {
  final String id;
  final String name;
  final String email;
  final String phone;
  final String country;
  final String kycStatus;

  UserProfile({
    required this.id,
    required this.name,
    required this.email,
    required this.phone,
    required this.country,
    required this.kycStatus,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'],
      name: json['name'],
      email: json['email'],
      phone: json['phone'],
      country: json['country'],
      kycStatus: json['kycStatus'],
    );
  }
}

class WalletService {
  static final APIClient _apiClient = APIClient();

  static Future<List<WalletBalance>> getWallets() async {
    final response = await _apiClient.get('/wallet/balances');
    return (response['data'] as List).map((json) => WalletBalance.fromJson(json)).toList();
  }

  static Future<UserProfile> getUserProfile() async {
    final response = await _apiClient.get('/user/profile');
    return UserProfile.fromJson(response['data']);
  }

  static Future<UserProfile> updateUserProfile(Map<String, dynamic> updates) async {
    final response = await _apiClient.put('/user/profile', updates);
    return UserProfile.fromJson(response['data']);
  }

  static Future<Map<String, dynamic>> getExchangeRate(String from, String to) async {
    final response = await _apiClient.get('/wallet/exchange-rate?from=$from&to=$to');
    return response['data'];
  }

  static Future<Map<String, dynamic>> exchangeCurrency(String from, String to, double amount) async {
    final response = await _apiClient.post('/wallet/exchange', {'from': from, 'to': to, 'amount': amount});
    return response['data'];
  }
}
