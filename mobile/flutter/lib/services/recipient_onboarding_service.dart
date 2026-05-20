import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class Recipient {
  final String id;
  final String name;
  final String bankName;
  final String accountNumber;
  final String country;
  final String currency;

  const Recipient({required this.id, required this.name, required this.bankName, required this.accountNumber, required this.country, required this.currency});

  factory Recipient.fromJson(Map<String, dynamic> json) => Recipient(
      id: json["id"] as String,
      name: json["name"] as String,
      bankName: json["bankName"] as String,
      accountNumber: json["accountNumber"] as String,
      country: json["country"] as String,
      currency: json["currency"] as String,
  );
}

class RecipientOnboardingService {
  final String _baseUrl;
  final http.Client _client;

  RecipientOnboardingService({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
        _client = client ?? http.Client();

  Future<Recipient> fetch({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/recipients.create');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[RecipientOnboardingService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final result = body['result'] ?? body;
    return Recipient.fromJson(result as Map<String, dynamic>);
  }

  Future<List<Recipient>> fetchList({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/recipients.create');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[RecipientOnboardingService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final list = (body['result'] ?? body['data'] ?? []) as List<dynamic>;
    return list.map((e) => Recipient.fromJson(e as Map<String, dynamic>)).toList();
  }

  void dispose() => _client.close();
}
