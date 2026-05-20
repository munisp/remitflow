/// push_notification_service.dart
/// Handles FCM push notifications for RemitFlow Flutter app.
/// Uses firebase_messaging package (already in pubspec.yaml).

import 'dart:io';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Background message handler — must be a top-level function.
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Firebase is already initialized when this is called.
  print('[Push] Background message: ${message.messageId}');
}

class PushNotificationService {
  static final _messaging = FirebaseMessaging.instance;
  static final _localNotifications = FlutterLocalNotificationsPlugin();
  static const _tokenKey = 'remitflow_fcm_token';

  /// Initialize the push notification service.
  /// Call this once at app startup.
  static Future<void> initialize({
    required void Function(String title, String body, Map<String, dynamic> data) onForegroundMessage,
    required void Function(Map<String, dynamic> data) onNotificationTap,
  }) async {
    // Register background handler
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

    // Request permission
    await requestPermission();

    // Initialize local notifications (for foreground display on Android)
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    await _localNotifications.initialize(
      const InitializationSettings(android: androidSettings, iOS: iosSettings),
      onDidReceiveNotificationResponse: (details) {
        if (details.payload != null) {
          // Parse payload and navigate
          onNotificationTap({'payload': details.payload});
        }
      },
    );

    // Foreground message handler
    FirebaseMessaging.onMessage.listen((message) {
      final title = message.notification?.title ?? 'RemitFlow';
      final body = message.notification?.body ?? '';
      final data = message.data;
      onForegroundMessage(title, body, data);
      _showLocalNotification(title, body, data.toString());
    });

    // Notification tap when app is in background
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      onNotificationTap(message.data);
    });

    // Cold start notification tap
    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      onNotificationTap(initialMessage.data);
    }
  }

  /// Request notification permission from the user.
  static Future<bool> requestPermission() async {
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  /// Get the FCM device token.
  static Future<String?> getToken() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString(_tokenKey);
      if (cached != null) return cached;
      final token = await _messaging.getToken();
      if (token != null) await prefs.setString(_tokenKey, token);
      return token;
    } catch (_) {
      return null;
    }
  }

  /// Register the FCM token with the RemitFlow backend.
  static Future<bool> registerWithBackend({
    required String apiBaseUrl,
    required String sessionCookie,
    required String deviceName,
  }) async {
    try {
      final token = await getToken();
      if (token == null) return false;
      final client = HttpClient();
      final uri = Uri.parse('$apiBaseUrl/api/trpc/pushNotifications.register');
      final request = await client.postUrl(uri);
      request.headers.set('Content-Type', 'application/json');
      request.headers.set('Cookie', 'app_session_id=$sessionCookie');
      request.write('{"json":{"endpoint":"$token","p256dh":"fcm","auth":"fcm","deviceName":"$deviceName","platform":"${Platform.operatingSystem}"}}');
      final response = await request.close();
      client.close();
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Show a local notification (for foreground messages on Android).
  static Future<void> _showLocalNotification(
    String title,
    String body,
    String payload,
  ) async {
    const androidDetails = AndroidNotificationDetails(
      'remitflow_channel',
      'RemitFlow Notifications',
      channelDescription: 'Transfer updates, FX alerts, and security notifications',
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    await _localNotifications.show(
      DateTime.now().millisecondsSinceEpoch ~/ 1000,
      title,
      body,
      const NotificationDetails(android: androidDetails, iOS: iosDetails),
      payload: payload,
    );
  }

  /// Subscribe to a topic (e.g., 'fx_alerts', 'compliance').
  static Future<void> subscribeToTopic(String topic) async {
    await _messaging.subscribeToTopic(topic);
  }

  /// Unsubscribe from a topic.
  static Future<void> unsubscribeFromTopic(String topic) async {
    await _messaging.unsubscribeFromTopic(topic);
  }
}
