import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class FormalizationStats {
  final int totalInformalUsers;
  final int formalizedThisMonth;
  final double conversionRate;
  final int pendingKyc;

  const FormalizationStats({required this.totalInformalUsers, required this.formalizedThisMonth, required this.conversionRate, required this.pendingKyc});

  factory FormalizationStats.fromJson(Map<String, dynamic> json) => FormalizationStats(
      totalInformalUsers: (json["totalInformalUsers"] as num).toint(),
      formalizedThisMonth: (json["formalizedThisMonth"] as num).toint(),
      conversionRate: (json["conversionRate"] as num).todouble(),
      pendingKyc: (json["pendingKyc"] as num).toint(),
  );
}

class FormalizationService {
  final String _baseUrl;
  final http.Client _client;

  FormalizationService({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
        _client = client ?? http.Client();

  Future<FormalizationStats> fetch({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/formalization.getDashboard');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[FormalizationService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final result = body['result'] ?? body;
    return FormalizationStats.fromJson(result as Map<String, dynamic>);
  }

  Future<List<FormalizationStats>> fetchList({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/formalization.getDashboard');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[FormalizationService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final list = (body['result'] ?? body['data'] ?? []) as List<dynamic>;
    return list.map((e) => FormalizationStats.fromJson(e as Map<String, dynamic>)).toList();
  }

  void dispose() => _client.close();
}
