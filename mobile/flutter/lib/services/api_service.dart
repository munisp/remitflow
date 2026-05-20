import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiService {
  static const String baseUrl = 'https://remitflow.manus.space/api/trpc';
  static const _storage = FlutterSecureStorage();

  late final Dio _dio;

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final sessionId = await _storage.read(key: 'session_id');
        if (sessionId != null) {
          options.headers['Cookie'] = 'app_session_id=$sessionId';
        }
        return handler.next(options);
      },
      onError: (error, handler) {
        if (error.response?.statusCode == 401) {
          _storage.delete(key: 'session_id');
        }
        return handler.next(error);
      },
    ));
  }

  Future<Map<String, dynamic>> query(String procedure, [Map<String, dynamic>? input]) async {
    final params = input != null ? {'input': jsonEncode({'json': input})} : <String, dynamic>{};
    final response = await _dio.get('/$procedure', queryParameters: params);
    return _parseResponse(response.data);
  }

  Future<Map<String, dynamic>> mutate(String procedure, Map<String, dynamic> input) async {
    final response = await _dio.post('/$procedure', data: {'json': input});
    return _parseResponse(response.data);
  }

  Map<String, dynamic> _parseResponse(dynamic data) {
    if (data is Map && data.containsKey('result')) {
      return data['result']['data']['json'] as Map<String, dynamic>;
    }
    return data as Map<String, dynamic>;
  }

  Future<void> saveSession(String sessionId) async {
    await _storage.write(key: 'session_id', value: sessionId);
  }

  Future<String?> getSession() async {
    return _storage.read(key: 'session_id');
  }

  Future<void> clearSession() async {
    await _storage.delete(key: 'session_id');
  }
}

final apiService = ApiService();
