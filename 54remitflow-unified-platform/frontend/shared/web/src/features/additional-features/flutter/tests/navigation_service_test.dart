import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';

// --- Mock Classes (Assuming the NavigationService uses a GlobalKey<NavigatorState>) ---

// 1. Mock the NavigatorState
class MockNavigatorState extends Mock implements NavigatorState {}

// 2. Mock the GlobalKey<NavigatorState>
class MockGlobalKey extends Mock implements GlobalKey<NavigatorState> {
  @override
  NavigatorState? get currentState => MockNavigatorState();
}

// 3. Mock the Route
class MockRoute<T> extends Mock implements Route<T> {}

// --- NavigationService Implementation (Inferred) ---
// We need to define a plausible NavigationService to test against.
// This is an inferred implementation based on common patterns and the test requirements.

class NavigationService {
  final GlobalKey<NavigatorState> navigatorKey;

  NavigationService(this.navigatorKey);

  // Common imperative navigation methods
  Future<T?> pushNamed<T extends Object?>(String routeName, {Object? arguments}) {
    return navigatorKey.currentState!.pushNamed<T>(routeName, arguments: arguments);
  }

  Future<T?> pushReplacementNamed<T extends Object?, TO extends Object?>(
      String routeName,
      {TO? result,
      Object? arguments}) {
    return navigatorKey.currentState!
        .pushReplacementNamed<T, TO>(routeName, result: result, arguments: arguments);
  }

  void pop<T extends Object?>([T? result]) {
    navigatorKey.currentState!.pop(result);
  }

  // Specific method required for testing
  Future<T?> navigateToKYCUpgrade<T extends Object?>() {
    // Assuming this navigates to a specific route with a hardcoded name
    return pushNamed('/kyc-upgrade');
  }

  // Method to simulate a Navigator 2.0-style update (e.g., setting a new list of pages)
  Future<void> replaceAllWith(String routeName, {Object? arguments}) async {
    // Pop all existing routes until the first one, then push the new one.
    navigatorKey.currentState!.popUntil((route) => route.isFirst);
    await pushReplacementNamed(routeName);
  }
}

// --- Unit Tests ---

void main() {
  // Use late initialization for mocks and the service
  late MockNavigatorState mockNavigatorState;
  late MockGlobalKey mockNavigatorKey;
  late NavigationService navigationService;

  // Setup: Runs before every test
  setUp(() {
    // Reset mocks before each test to ensure isolation
    mockNavigatorState = MockNavigatorState();
    // The MockGlobalKey must return the mockNavigatorState when currentState is accessed
    mockNavigatorKey = MockGlobalKey();
    when(mockNavigatorKey.currentState).thenReturn(mockNavigatorState);

    // Initialize the service with the mocked key
    navigationService = NavigationService(mockNavigatorKey);

    // Default mock behavior for push methods to return a Future<null>
    when(mockNavigatorState.pushNamed(any, arguments: anyNamed('arguments')))
        .thenAnswer((_) async => null);
    when(mockNavigatorState.pushReplacementNamed(any,
            result: anyNamed('result'), arguments: anyNamed('arguments')))
        .thenAnswer((_) async => null);
    when(mockNavigatorState.popUntil(any)).thenReturn(null);
  });

  // Test group for basic imperative navigation
  group('NavigationService - Imperative Methods', () {
    test('pushNamed calls NavigatorState.pushNamed with correct arguments', () async {
      const routeName = '/home';
      const arguments = {'id': 1};

      await navigationService.pushNamed(routeName, arguments: arguments);

      // Verify that pushNamed was called exactly once with the correct routeName and arguments
      verify(mockNavigatorState.pushNamed(routeName, arguments: arguments)).called(1);
      verifyNoMoreInteractions(mockNavigatorState);
    });

    test('pushReplacementNamed calls NavigatorState.pushReplacementNamed with correct arguments',
        () async {
      const routeName = '/login';
      const result = true;
      const arguments = {'from': 'splash'};

      await navigationService.pushReplacementNamed(routeName, result: result, arguments: arguments);

      // Verify that pushReplacementNamed was called exactly once with the correct arguments
      verify(mockNavigatorState.pushReplacementNamed(routeName,
              result: result, arguments: arguments))
          .called(1);
      verifyNoMoreInteractions(mockNavigatorState);
    });

    test('pop calls NavigatorState.pop with correct result', () {
      const result = 'data';

      navigationService.pop(result);

      // Verify that pop was called exactly once with the correct result
      verify(mockNavigatorState.pop(result)).called(1);
      verifyNoMoreInteractions(mockNavigatorState);
    });

    test('pop without result calls NavigatorState.pop with null', () {
      navigationService.pop();

      // Verify that pop was called exactly once with null
      verify(mockNavigatorState.pop(null)).called(1);
      verifyNoMoreInteractions(mockNavigatorState);
    });
  });

  // Test group for specific business logic methods
  group('NavigationService - Business Logic', () {
    test('navigateToKYCUpgrade calls pushNamed with the correct hardcoded route', () async {
      const expectedRoute = '/kyc-upgrade';

      await navigationService.navigateToKYCUpgrade();

      // Verify that pushNamed was called with the specific KYC route
      verify(mockNavigatorState.pushNamed(expectedRoute, arguments: null)).called(1);
      verifyNoMoreInteractions(mockNavigatorState);
    });

    test('navigateToKYCUpgrade returns the result from pushNamed', () async {
      const expectedResult = true;
      when(mockNavigatorState.pushNamed(any, arguments: anyNamed('arguments')))
          .thenAnswer((_) async => expectedResult);

      final result = await navigationService.navigateToKYCUpgrade();

      expect(result, expectedResult);
    });
  });

  // Test group for Navigator 2.0 related functionality (simulated)
  group('NavigationService - Navigator 2.0 Simulation', () {
    test('replaceAllWith pops until first route and then pushes replacement', () async {
      const routeName = '/new-root';
      const arguments = {'reset': true};

      await navigationService.replaceAllWith(routeName, arguments: arguments);

      // Verify the sequence of calls:
      // 1. popUntil is called to clear the stack.
      verify(mockNavigatorState.popUntil(any)).called(1);

      // 2. pushReplacementNamed is called to set the new root.
      verify(mockNavigatorState.pushReplacementNamed(routeName, result: null, arguments: null))
          .called(1);

      // Ensure no other navigation methods were called
      verifyNoMoreInteractions(mockNavigatorState);
    });

    test('replaceAllWith correctly handles the popUntil predicate', () async {
      // We'll reset the mock to capture the argument in this specific test
      reset(mockNavigatorState);
      when(mockNavigatorKey.currentState).thenReturn(mockNavigatorState);
      when(mockNavigatorState.pushReplacementNamed(any,
              result: anyNamed('result'), arguments: anyNamed('arguments')))
          .thenAnswer((_) async => null);

      await navigationService.replaceAllWith('/test');

      // Capture the argument passed to popUntil
      final captured = verify(mockNavigatorState.popUntil(captureAny)).captured.single;
      final RoutePredicate predicate = captured as RoutePredicate;

      // Test the predicate: it should return true for a route where isFirst is true
      final mockRoute = MockRoute<void>();
      when(mockRoute.isFirst).thenReturn(true);
      expect(predicate(mockRoute), isTrue);

      // Test the predicate: it should return false for a route where isFirst is false
      when(mockRoute.isFirst).thenReturn(false);
      expect(predicate(mockRoute), isFalse);
    });
  });

  // Test for edge case: navigatorKey.currentState is null (e.g., before app initialization)
  group('NavigationService - Edge Cases', () {
    test('methods throw exception if navigatorKey.currentState is null', () {
      // Create a mock key that returns null for currentState
      final nullStateKey = MockGlobalKey();
      when(nullStateKey.currentState).thenReturn(null);
      final nullService = NavigationService(nullStateKey);

      // Expect a runtime error (or a specific error if the real service handles it)
      // Since our inferred service uses the null-safe operator `!`, it will throw a
      // NoSuchMethodError when accessing the state.
      expect(() => nullService.pushNamed('/test'), throwsA(isA<NoSuchMethodError>()));
      expect(() => nullService.pop(), throwsA(isA<NoSuchMethodError>()));
      expect(() => nullService.navigateToKYCUpgrade(), throwsA(isA<NoSuchMethodError>()));
      expect(() => nullService.replaceAllWith('/test'), throwsA(isA<NoSuchMethodError>()));
    });
  });
}