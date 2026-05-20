// NavigationService.dart

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:async';

/// --- 1. Route Path Definition (AppRoutePath) ---

/// Represents the current state of the navigation stack.
@immutable
class AppRoutePath {
  final bool isUnknown;
  final bool isHomePage;
  final bool isKYCUpgradePage;
  final bool isTransactionPage;
  final String? transactionId;

  AppRoutePath.home()
      : isUnknown = false,
        isHomePage = true,
        isKYCUpgradePage = false,
        isTransactionPage = false,
        transactionId = null;

  AppRoutePath.kycUpgrade()
      : isUnknown = false,
        isHomePage = false,
        isKYCUpgradePage = true,
        isTransactionPage = false,
        transactionId = null;

  AppRoutePath.transaction(this.transactionId)
      : isUnknown = false,
        isHomePage = false,
        isKYCUpgradePage = false,
        isTransactionPage = true;

  AppRoutePath.unknown()
      : isUnknown = true,
        isHomePage = false,
        isKYCUpgradePage = false,
        isTransactionPage = false,
        transactionId = null;

  bool get isTransactionDetail => transactionId != null;
}

/// --- 2. Route Information Parser (AppRouteInformationParser) ---

/// Converts the platform's route information (URI) into an AppRoutePath.
class AppRouteInformationParser extends RouteInformationParser<AppRoutePath> {
  @override
  Future<AppRoutePath> parseRouteInformation(
      RouteInformation routeInformation) async {
    final uri = Uri.parse(routeInformation.uri);

    // Handle root
    if (uri.pathSegments.isEmpty || uri.pathSegments.first == 'home') {
      return AppRoutePath.home();
    }

    // Handle KYC Upgrade
    if (uri.pathSegments.length == 1 && uri.pathSegments.first == 'kyc') {
      return AppRoutePath.kycUpgrade();
    }

    // Handle Transaction Detail
    if (uri.pathSegments.length == 2 &&
        uri.pathSegments.first == 'transaction') {
      final transactionId = uri.pathSegments[1];
      if (transactionId.isNotEmpty) {
        return AppRoutePath.transaction(transactionId);
      }
    }

    // Handle unknown routes
    return AppRoutePath.unknown();
  }

  @override
  RouteInformation? restoreRouteInformation(AppRoutePath configuration) {
    if (configuration.isUnknown) {
      return const RouteInformation(uri: '/404');
    }
    if (configuration.isHomePage) {
      return const RouteInformation(uri: '/');
    }
    if (configuration.isKYCUpgradePage) {
      return const RouteInformation(uri: '/kyc');
    }
    if (configuration.isTransactionDetail) {
      return RouteInformation(uri: '/transaction/${configuration.transactionId}');
    }
    return null;
  }
}

/// --- 3. Router Delegate (AppRouterDelegate) ---

/// Manages the application's navigation stack (list of pages).
class AppRouterDelegate extends RouterDelegate<AppRoutePath>
    with ChangeNotifier, PopNavigatorRouterDelegateMixin<AppRoutePath> {
  @override
  final GlobalKey<NavigatorState> navigatorKey;

  AppRoutePath _currentPath = AppRoutePath.home();
  final List<Page> _pages = [];

  AppRouterDelegate() : navigatorKey = GlobalKey<NavigatorState>() {
    _pages.add(_createPage(AppRoutePath.home()));
  }

  // State management for the pages
  void _updatePages(AppRoutePath path) {
    _pages.clear();
    _pages.add(_createPage(AppRoutePath.home())); // Home is always the base

    if (path.isKYCUpgradePage) {
      _pages.add(_createPage(AppRoutePath.kycUpgrade()));
    } else if (path.isTransactionDetail) {
      _pages.add(_createPage(AppRoutePath.transaction(path.transactionId)));
    } else if (path.isUnknown) {
      _pages.add(_createPage(AppRoutePath.unknown()));
    }
    notifyListeners();
  }

  Page _createPage(AppRoutePath path) {
    if (path.isHomePage) {
      return const MaterialPage(
        key: ValueKey('HomePage'),
        child: HomePage(),
      );
    } else if (path.isKYCUpgradePage) {
      return const MaterialPage(
        key: ValueKey('KYCUpgradePage'),
        child: KYCUpgradePage(),
      );
    } else if (path.isTransactionDetail) {
      return MaterialPage(
        key: ValueKey('TransactionPage_${path.transactionId}'),
        child: TransactionPage(transactionId: path.transactionId!),
      );
    } else if (path.isUnknown) {
      return const MaterialPage(
        key: ValueKey('UnknownPage'),
        child: UnknownPage(),
      );
    }
    // Fallback to home
    return const MaterialPage(
      key: ValueKey('HomePage'),
      child: HomePage(),
    );
  }

  @override
  AppRoutePath get currentConfiguration => _currentPath;

  @override
  Widget build(BuildContext context) {
    return Navigator(
      key: navigatorKey,
      pages: List.of(_pages),
      onPopPage: (route, result) {
        if (!route.didPop(result)) {
          return false;
        }

        // Handle pop logic to update the path
        if (_pages.length > 1) {
          _pages.removeLast();
          _currentPath = _pages.last.key == const ValueKey('HomePage')
              ? AppRoutePath.home()
              : AppRoutePath.unknown(); // Simplified pop path
          notifyListeners();
          return true;
        }

        return false;
      },
    );
  }

  @override
  Future<void> setNewRoutePath(AppRoutePath configuration) async {
    _currentPath = configuration;
    _updatePages(_currentPath);
  }

  /// Public method to navigate to KYC Upgrade page.
  void navigateToKYCUpgrade() {
    _currentPath = AppRoutePath.kycUpgrade();
    _updatePages(_currentPath);
  }

  /// Public method to navigate to a specific Transaction page.
  void navigateToTransaction(String transactionId) {
    _currentPath = AppRoutePath.transaction(transactionId);
    _updatePages(_currentPath);
  }

  /// Public method to handle post-KYC completion flow.
  /// Simulates a backend API call and navigates back to home on success.
  Future<void> handleKYCComplete({required bool success}) async {
    try {
      // Simulate API call for final KYC status update
      print('Attempting to finalize KYC status...');
      await Future.delayed(const Duration(seconds: 1)); // Simulate network delay

      if (!success) {
        throw Exception('KYC finalization failed on the server.');
      }

      // On success, navigate back to the home page
      _currentPath = AppRoutePath.home();
      _updatePages(_currentPath);
      print('KYC successfully finalized. Navigating to home.');

    } catch (e) {
      // Complete error handling: log the error and show a user-friendly message
      print('Error handling KYC completion: $e');
      // In a real app, you would show a SnackBar or Dialog here.
      // For this service, we'll just log and remain on the current page or navigate to an error page.
      // For now, we remain on the current page.
    }
  }
}

/// --- 4. Navigation Service Singleton (NavigationService) ---

/// A singleton service to provide easy access to the AppRouterDelegate's methods.
class NavigationService {
  static final NavigationService _instance = NavigationService._internal();
  static AppRouterDelegate? _routerDelegate;

  factory NavigationService() {
    return _instance;
  }

  NavigationService._internal();

  /// Must be called once during application startup to link the service to the delegate.
  static void initialize(AppRouterDelegate delegate) {
    _routerDelegate = delegate;
  }

  /// Navigates to the KYC Upgrade screen.
  ///
  /// This method updates the navigation stack to show the KYC upgrade page.
  /// It is type-safe and uses the underlying Navigator 2.0 delegate.
  void navigateToKYCUpgrade() {
    if (_routerDelegate == null) {
      throw StateError('NavigationService not initialized. Call initialize() first.');
    }
    _routerDelegate!.navigateToKYCUpgrade();
  }

  /// Navigates to the Transaction Detail screen for a given [transactionId].
  ///
  /// Throws an [ArgumentError] if [transactionId] is null or empty.
  void navigateToTransaction(String transactionId) {
    if (_routerDelegate == null) {
      throw StateError('NavigationService not initialized. Call initialize() first.');
    }
    if (transactionId.isEmpty) {
      throw ArgumentError('Transaction ID cannot be empty.', 'transactionId');
    }
    _routerDelegate!.navigateToTransaction(transactionId);
  }

  /// Handles the post-completion flow for KYC.
  ///
  /// This method is asynchronous and simulates an integration with a backend API
  /// to finalize the KYC status. It handles success and failure scenarios.
  ///
  /// [success] indicates the result of the KYC process (e.g., from a deep link or callback).
  ///
  /// Returns a [Future] that completes when the navigation is finished.
  Future<void> handleKYCComplete({required bool success}) async {
    if (_routerDelegate == null) {
      throw StateError('NavigationService not initialized. Call initialize() first.');
    }
    // Modern pattern: async/await for API integration
    await _routerDelegate!.handleKYCComplete(success: success);
  }
}

/// --- 5. Mock Pages for Demonstration ---

/// Mock page for the application's home screen.
class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Welcome Home!'),
            ElevatedButton(
              onPressed: () => NavigationService().navigateToKYCUpgrade(),
              child: const Text('Go to KYC Upgrade'),
            ),
            ElevatedButton(
              onPressed: () => NavigationService().navigateToTransaction('TXN-12345'),
              child: const Text('View Transaction TXN-12345'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Mock page for the KYC Upgrade screen.
class KYCUpgradePage extends StatelessWidget {
  const KYCUpgradePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('KYC Upgrade')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Complete your KYC process.'),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => NavigationService().handleKYCComplete(success: true),
              child: const Text('Simulate KYC Success'),
            ),
            ElevatedButton(
              onPressed: () => NavigationService().handleKYCComplete(success: false),
              child: const Text('Simulate KYC Failure'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Mock page for the Transaction Detail screen.
class TransactionPage extends StatelessWidget {
  final String transactionId;
  const TransactionPage({super.key, required this.transactionId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Transaction: $transactionId')),
      body: Center(
        child: Text('Details for transaction $transactionId'),
      ),
    );
  }
}

/// Mock page for 404/Unknown routes.
class UnknownPage extends StatelessWidget {
  const UnknownPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('404')),
      body: const Center(
        child: Text('Error: Page not found!'),
      ),
    );
  }
}

// --- Example Usage in main.dart (for context, not part of the service file) ---
/*
void main() {
  final AppRouterDelegate routerDelegate = AppRouterDelegate();
  NavigationService.initialize(routerDelegate);

  runApp(MyApp(routerDelegate: routerDelegate));
}

class MyApp extends StatelessWidget {
  final AppRouterDelegate routerDelegate;

  const MyApp({super.key, required this.routerDelegate});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Flutter Navigator 2.0 Demo',
      routerDelegate: routerDelegate,
      routeInformationParser: AppRouteInformationParser(),
    );
  }
}
*/
// End of NavigationService.dart