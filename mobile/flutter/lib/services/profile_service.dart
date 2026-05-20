import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class UserProfile {
  final String id;
  final String name;
  final String email;
  final String phone;
  final int kycTier;
  final String role;

  const UserProfile({required this.id, required this.name, required this.email, required this.phone, required this.kycTier, required this.role});

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
      id: json["id"] as String,
      name: json["name"] as String,
      email: json["email"] as String,
      phone: json["phone"] as String,
      kycTier: (json["kycTier"] as num).toint(),
      role: json["role"] as String,
  );
}

class ProfileService {
  final String _baseUrl;
  final http.Client _client;

  ProfileService({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
        _client = client ?? http.Client();

  Future<UserProfile> fetch({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/user.getProfile');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[ProfileService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final result = body['result'] ?? body;
    return UserProfile.fromJson(result as Map<String, dynamic>);
  }

  Future<List<UserProfile>> fetchList({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/user.getProfile');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[ProfileService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final list = (body['result'] ?? body['data'] ?? []) as List<dynamic>;
    return list.map((e) => UserProfile.fromJson(e as Map<String, dynamic>)).toList();
  }

  void dispose() => _client.close();
}
