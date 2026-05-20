import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';

class OutboundRevenueModel {
  final double totalVolumeUsd;
  final double feeIncome;
  final double fxSpread;
  final double floatIncome;
  final double totalRevenue;

  const OutboundRevenueModel({required this.totalVolumeUsd, required this.feeIncome, required this.fxSpread, required this.floatIncome, required this.totalRevenue});

  factory OutboundRevenueModel.fromJson(Map<String, dynamic> json) => OutboundRevenueModel(
      totalVolumeUsd: (json["totalVolumeUsd"] as num).todouble(),
      feeIncome: (json["feeIncome"] as num).todouble(),
      fxSpread: (json["fxSpread"] as num).todouble(),
      floatIncome: (json["floatIncome"] as num).todouble(),
      totalRevenue: (json["totalRevenue"] as num).todouble(),
  );
}

class OutboundRevenueService {
  final String _baseUrl;
  final http.Client _client;

  OutboundRevenueService({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
        _client = client ?? http.Client();

  Future<OutboundRevenueModel> fetch({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/outbound.getRevenueModel');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[OutboundRevenueService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final result = body['result'] ?? body;
    return OutboundRevenueModel.fromJson(result as Map<String, dynamic>);
  }

  Future<List<OutboundRevenueModel>> fetchList({Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$_baseUrl/api/trpc/outbound.getRevenueModel');
    final response = await _client.get(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) {
      throw Exception('[OutboundRevenueService] HTTP ${response.statusCode}: ${response.body}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final list = (body['result'] ?? body['data'] ?? []) as List<dynamic>;
    return list.map((e) => OutboundRevenueModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  void dispose() => _client.close();
}
