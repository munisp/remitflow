import 'package:shared_preferences/shared_preferences.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'dart:convert';

class OfflineService {
  static final Connectivity _connectivity = Connectivity();
  static bool _isOnline = true;

  // Initialize
  static Future<void> initialize() async {
    _connectivity.onConnectivityChanged.listen((result) {
      _isOnline = result != ConnectivityResult.none;
      if (_isOnline) {
        processQueue();
      }
    });
  }

  // Network Status
  static bool getOnlineStatus() {
    return _isOnline;
  }

  // Request Queue
  static Future<void> queueRequest(Map<String, dynamic> request) async {
    final prefs = await SharedPreferences.getInstance();
    final queue = prefs.getStringList('offline_queue') ?? [];
    queue.add(jsonEncode(request));
    await prefs.setStringList('offline_queue', queue);
  }

  static Future<void> processQueue() async {
    if (!_isOnline) return;

    final prefs = await SharedPreferences.getInstance();
    final queue = prefs.getStringList('offline_queue') ?? [];
    
    for (final requestJson in queue) {
      try {
        final request = jsonDecode(requestJson);
        // Process request
      } catch (e) {
        print('Failed to process queued request: $e');
      }
    }

    await prefs.setStringList('offline_queue', []);
  }

  // Data Caching
  static Future<void> cacheData(String key, dynamic data, {int ttl = 3600000}) async {
    final prefs = await SharedPreferences.getInstance();
    final cached = {
      'data': data,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'expiresAt': DateTime.now().millisecondsSinceEpoch + ttl,
    };
    await prefs.setString('cache_$key', jsonEncode(cached));
  }

  static Future<dynamic> getCachedData(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final cachedJson = prefs.getString('cache_$key');
    
    if (cachedJson == null) return null;

    final cached = jsonDecode(cachedJson);
    final now = DateTime.now().millisecondsSinceEpoch;
    
    if (now > cached['expiresAt']) {
      await clearCache(key);
      return null;
    }

    return cached['data'];
  }

  static Future<void> clearCache(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('cache_$key');
  }
}
