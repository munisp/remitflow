// Flutter API Client
class APIClient {
  final String baseURL = 'https://api.remittance.com';

  Future<Map<String, dynamic>> get(String endpoint) async {
    return await _request('GET', endpoint);
  }

  Future<Map<String, dynamic>> post(String endpoint, Map<String, dynamic> data) async {
    return await _request('POST', endpoint, data);
  }

  Future<Map<String, dynamic>> put(String endpoint, Map<String, dynamic> data) async {
    return await _request('PUT', endpoint, data);
  }

  Future<Map<String, dynamic>> delete(String endpoint) async {
    return await _request('DELETE', endpoint);
  }

  Future<Map<String, dynamic>> _request(String method, String endpoint, [Map<String, dynamic>? data]) async {
    // Implementation would use http package
    // For now, returning mock data
    return {'data': [], 'status': 200};
  }
}
