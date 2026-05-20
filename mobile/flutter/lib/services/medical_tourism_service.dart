import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class MedicalTourismPayment {
  final String id;
  final String hospital;
  final String country;
  final double amountUsd;
  final String status;
  final DateTime createdAt;

  const MedicalTourismPayment({required this.id, required this.hospital, required this.country, required this.amountUsd, required this.status, required this.createdAt});

  factory MedicalTourismPayment.fromJson(Map<String, dynamic> json) => MedicalTourismPayment(
      id: json["id"] as String,
      hospital: json["hospital"] as String,
      country: json["country"] as String,
      amountUsd: (json["amountUsd"] as num).todouble(),
      status: json["status"] as String,
      createdAt: DateTime.parse(json["createdAt"] as String),
  );
}

class MedicalTourismService {
  final String _baseUrl;
  final http.Client _client;

  MedicalTourismService({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
        _client = client ?? http.Client();

  Future<MedicalTourismPayment> fetch({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/outbound.getMedicalTourismPayments');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[MedicalTourismService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final result = body['result'] ?? body;
    return MedicalTourismPayment.fromJson(result as Map<String, dynamic>);
  }

  Future<List<MedicalTourismPayment>> fetchList({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/outbound.getMedicalTourismPayments');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[MedicalTourismService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final list = (body['result'] ?? body['data'] ?? []) as List<dynamic>;
    return list.map((e) => MedicalTourismPayment.fromJson(e as Map<String, dynamic>)).toList();
  }

  void dispose() => _client.close();
}
