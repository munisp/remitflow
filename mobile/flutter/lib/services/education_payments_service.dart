import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class EducationPayment {
  final String id;
  final String institution;
  final double amountUsd;
  final String currency;
  final String status;
  final DateTime createdAt;

  const EducationPayment({required this.id, required this.institution, required this.amountUsd, required this.currency, required this.status, required this.createdAt});

  factory EducationPayment.fromJson(Map<String, dynamic> json) => EducationPayment(
      id: json["id"] as String,
      institution: json["institution"] as String,
      amountUsd: (json["amountUsd"] as num).todouble(),
      currency: json["currency"] as String,
      status: json["status"] as String,
      createdAt: DateTime.parse(json["createdAt"] as String),
  );
}

class EducationPaymentsService {
  final String _baseUrl;
  final http.Client _client;

  EducationPaymentsService({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
        _client = client ?? http.Client();

  Future<EducationPayment> fetch({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/outbound.getEducationPayments');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[EducationPaymentsService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final result = body['result'] ?? body;
    return EducationPayment.fromJson(result as Map<String, dynamic>);
  }

  Future<List<EducationPayment>> fetchList({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/outbound.getEducationPayments');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[EducationPaymentsService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final list = (body['result'] ?? body['data'] ?? []) as List<dynamic>;
    return list.map((e) => EducationPayment.fromJson(e as Map<String, dynamic>)).toList();
  }

  void dispose() => _client.close();
}
