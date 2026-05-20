// Flutter Comprehensive Analytics Service
class AnalyticsService {
  static String _sessionId = _generateSessionId();
  static String? _userId;
  static List<Map<String, dynamic>> _eventQueue = [];

  static const String LAKEHOUSE_ENDPOINT = 'https://lakehouse.api/events';
  static const String MIDDLEWARE_ENDPOINT = 'https://middleware.api/analytics';
  static const String POSTGRES_ENDPOINT = 'https://postgres.api/metrics';
  static const String TIGERBEETLE_ENDPOINT = 'https://tigerbeetle.api/revenue';

  static void initialize({String? userId}) {
    _userId = userId;
    _sessionId = _generateSessionId();
    trackEvent('session_start', {'platform': 'Flutter'});
  }

  static void trackScreenView(String screenName) {
    trackEvent('screen_view', {'screenName': screenName});
  }

  static void trackButtonClick(String buttonId, [Map<String, dynamic>? additionalProperties]) {
    trackEvent('button_click', {'buttonId': buttonId, ...?additionalProperties});
  }

  static void trackError(String errorType, dynamic error) {
    trackEvent('error_occurred', {
      'errorType': errorType,
      'errorMessage': error?.toString() ?? 'Unknown error',
    });
  }

  static Future<void> trackRevenue(double amount, String currency, String paymentSystem) async {
    final revenueEvent = {
      'eventName': 'revenue_tracked',
      'properties': {'amount': amount, 'currency': currency, 'paymentSystem': paymentSystem},
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'userId': _userId ?? 'anonymous',
      'sessionId': _sessionId,
    };

    // Send to TigerBeetle
    try {
      // await http.post(Uri.parse(TIGERBEETLE_ENDPOINT), body: jsonEncode(revenueEvent));
    } catch (e) {
      print('Failed to track revenue: $e');
    }

    trackEvent('revenue', revenueEvent['properties'] as Map<String, dynamic>);
  }

  static void trackPerformance(String metricName, double value, String unit) {
    trackEvent('performance_metric', {'metricName': metricName, 'value': value, 'unit': unit});
  }

  static void trackEvent(String eventName, Map<String, dynamic> properties) {
    final event = {
      'eventName': eventName,
      'properties': {...properties, 'platform': 'Flutter'},
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'userId': _userId,
      'sessionId': _sessionId,
    };

    _eventQueue.add(event);

    if (_eventQueue.length >= 10) {
      _flushEvents();
    }
  }

  static Future<void> _flushEvents() async {
    if (_eventQueue.isEmpty) return;

    final eventsToSend = List.from(_eventQueue);
    _eventQueue.clear();

    try {
      // Send to all endpoints
      // await Future.wait([
      //   http.post(Uri.parse(LAKEHOUSE_ENDPOINT), body: jsonEncode({'events': eventsToSend})),
      //   http.post(Uri.parse(MIDDLEWARE_ENDPOINT), body: jsonEncode({'events': eventsToSend})),
      //   http.post(Uri.parse(POSTGRES_ENDPOINT), body: jsonEncode({'events': eventsToSend})),
      // ]);
    } catch (error) {
      print('Failed to flush analytics events: $error');
      _eventQueue.insertAll(0, eventsToSend);
    }
  }

  static String _generateSessionId() {
    return 'session_${DateTime.now().millisecondsSinceEpoch}_${_generateRandomString(9)}';
  }

  static String _generateRandomString(int length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return List.generate(length, (index) => chars[(DateTime.now().millisecondsSinceEpoch + index) % chars.length]).join();
  }
}
