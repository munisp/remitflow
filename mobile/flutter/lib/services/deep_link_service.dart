/// deep_link_service.dart
/// Handles Universal Links (iOS) and App Links (Android) for RemitFlow Flutter app.
/// Uses app_links package (add to pubspec.yaml: app_links: ^6.0.0).
///
/// Supported deep link patterns:
///   remitflow://send?to=<beneficiaryId>&amount=<amount>&currency=<currency>
///   remitflow://pay?ref=<paymentRef>
///   remitflow://kyc
///   remitflow://wallet
///   remitflow://transaction/<id>
///   https://app.remitflow.com/send?...  (Universal Link / App Link)

import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter/widgets.dart';

class DeepLinkRoute {
  final String path;
  final Map<String, String> queryParams;

  const DeepLinkRoute({required this.path, this.queryParams = const {}});
}

class DeepLinkService {
  static final _appLinks = AppLinks();
  static StreamSubscription<Uri>? _subscription;

  /// Parse a deep link URI into a navigation path.
  static DeepLinkRoute? parseUri(Uri uri) {
    // Normalize universal links
    final host = uri.host;
    final path = uri.path.replaceFirst('/', '');
    final params = uri.queryParameters;

    // Custom scheme: remitflow://send?to=...
    if (uri.scheme == 'remitflow') {
      return _routeFromHostAndParams(host, params);
    }

    // Universal link: https://app.remitflow.com/send?...
    if (host == 'app.remitflow.com' || host == 'remitflow.app') {
      return _routeFromHostAndParams(path, params);
    }

    return null;
  }

  static DeepLinkRoute? _routeFromHostAndParams(
    String segment,
    Map<String, String> params,
  ) {
    switch (segment) {
      case 'send':
        final queryStr = params.entries
            .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}')
            .join('&');
        return DeepLinkRoute(
          path: '/send',
          queryParams: params,
        );
      case 'pay':
        if (params['ref'] == null) return null;
        return DeepLinkRoute(
          path: '/payment-confirm',
          queryParams: params,
        );
      case 'kyc':
        return const DeepLinkRoute(path: '/kyc');
      case 'wallet':
        return const DeepLinkRoute(path: '/wallet');
      default:
        // Check for transaction/<id> pattern
        final txMatch = RegExp(r'^transaction/(.+)$').firstMatch(segment);
        if (txMatch != null) {
          return DeepLinkRoute(
            path: '/transaction/${txMatch.group(1)}',
          );
        }
        return const DeepLinkRoute(path: '/');
    }
  }

  /// Initialize deep link handling.
  /// Call this in your root widget's initState.
  static Future<void> initialize(GoRouter router) async {
    // Handle cold start deep link
    try {
      final initialUri = await _appLinks.getInitialLink();
      if (initialUri != null) {
        final route = parseUri(initialUri);
        if (route != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _navigateToRoute(router, route);
          });
        }
      }
    } catch (_) {}

    // Handle foreground deep links
    _subscription = _appLinks.uriLinkStream.listen((uri) {
      final route = parseUri(uri);
      if (route != null) _navigateToRoute(router, route);
    });
  }

  static void _navigateToRoute(GoRouter router, DeepLinkRoute route) {
    if (route.queryParams.isEmpty) {
      router.go(route.path);
    } else {
      final queryStr = route.queryParams.entries
          .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}')
          .join('&');
      router.go('${route.path}?$queryStr');
    }
  }

  /// Dispose the deep link subscription.
  static void dispose() {
    _subscription?.cancel();
    _subscription = null;
  }

  /// Generate a shareable send money link.
  static String generateSendMoneyLink({
    required String beneficiaryId,
    double? amount,
    String currency = 'NGN',
  }) {
    final params = <String, String>{'to': beneficiaryId, 'currency': currency};
    if (amount != null) params['amount'] = amount.toStringAsFixed(2);
    final query = params.entries
        .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}')
        .join('&');
    return 'https://app.remitflow.com/send?$query';
  }

  /// Generate a shareable payment request link.
  static String generatePaymentRequestLink(String ref) {
    return 'https://app.remitflow.com/pay?ref=${Uri.encodeComponent(ref)}';
  }
}
