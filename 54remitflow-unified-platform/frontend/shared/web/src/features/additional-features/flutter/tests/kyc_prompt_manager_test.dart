import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:shared_preferences/shared_preferences.dart';

// --- Mock Classes and Setup ---

// Mock SharedPreferences for state persistence
class MockSharedPreferences extends Mock implements SharedPreferences {}

// Mock the external service that provides the user's KYC status
class MockKycService extends Mock {
  Future<KycStatus> getKycStatus();
}

// Enum for KYC status
enum KycStatus {
  notStarted,
  inProgress,
  verified,
  rejected,
}

// The hypothetical KYCPromptManager class
class KYCPromptManager {
  final MockKycService kycService;
  final SharedPreferences prefs;
  static const String _lastPromptKey = 'last_kyc_prompt_time';
  static const Duration _promptCooldown = Duration(days: 7);

  KYCPromptManager({required this.kycService, required this.prefs});

  Future<bool> shouldShowPrompt() async {
    final status = await kycService.getKycStatus();
    if (status == KycStatus.verified || status == KycStatus.inProgress) {
      return false;
    }

    final lastPromptTimeMillis = prefs.getInt(_lastPromptKey) ?? 0;
    final lastPromptTime = DateTime.fromMillisecondsSinceEpoch(lastPromptTimeMillis);
    final now = DateTime.now();

    if (now.difference(lastPromptTime) < _promptCooldown) {
      return false;
    }

    return true;
  }

  Future<void> _updateLastPromptTime() async {
    await prefs.setInt(_lastPromptKey, DateTime.now().millisecondsSinceEpoch);
  }

  Future<void> showPrompt(BuildContext context) async {
    if (!await shouldShowPrompt()) {
      return;
    }

    await _updateLastPromptTime();

    await showDialog<void>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Complete Your KYC'),
          content: const Text('To continue using all features, please complete your Know Your Customer verification.'),
          actions: <Widget>[
            TextButton(
              key: const Key('remindMeLaterButton'),
              child: const Text('Remind Me Later'),
              onPressed: () {
                Navigator.of(context).pop();
              },
            ),
            ElevatedButton(
              key: const Key('completeKycButton'),
              child: const Text('Complete Now'),
              onPressed: () {
                // In a real app, this would navigate to the KYC screen
                Navigator.of(context).pop(true);
              },
            ),
          ],
        );
      },
    );
  }
}

// --- Test Suite ---

void main() {
  late MockKycService mockKycService;
  late MockSharedPreferences mockPrefs;
  late KYCPromptManager manager;

  // Set up the environment before each test
  setUp(() {
    mockKycService = MockKycService();
    mockPrefs = MockSharedPreferences();
    manager = KYCPromptManager(kycService: mockKycService, prefs: mockPrefs);

    // Default mock behavior for shared preferences
    when(mockPrefs.getInt(any)).thenReturn(null);
    when(mockPrefs.setInt(any, any)).thenAnswer((_) async => true);
  });

  group('KYCPromptManager - shouldShowPrompt', () {
    const String _lastPromptKey = 'last_kyc_prompt_time';

    test('should return true if KYC is not started and no previous prompt time exists', () async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.notStarted);
      when(mockPrefs.getInt(_lastPromptKey)).thenReturn(null);

      // Act
      final result = await manager.shouldShowPrompt();

      // Assert
      expect(result, isTrue);
    });

    test('should return false if KYC is already verified', () async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.verified);

      // Act
      final result = await manager.shouldShowPrompt();

      // Assert
      expect(result, isFalse);
    });

    test('should return false if KYC is in progress', () async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.inProgress);

      // Act
      final result = await manager.shouldShowPrompt();

      // Assert
      expect(result, isFalse);
    });

    test('should return true if KYC is rejected and cooldown has passed', () async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.rejected);
      final oneMonthAgo = DateTime.now().subtract(const Duration(days: 30)).millisecondsSinceEpoch;
      when(mockPrefs.getInt(_lastPromptKey)).thenReturn(oneMonthAgo);

      // Act
      final result = await manager.shouldShowPrompt();

      // Assert
      expect(result, isTrue);
    });

    test('should return false if KYC is not started but prompt cooldown is active (less than 7 days)', () async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.notStarted);
      final fiveDaysAgo = DateTime.now().subtract(const Duration(days: 5)).millisecondsSinceEpoch;
      when(mockPrefs.getInt(_lastPromptKey)).thenReturn(fiveDaysAgo);

      // Act
      final result = await manager.shouldShowPrompt();

      // Assert
      expect(result, isFalse);
    });

    test('should return true if KYC is not started and prompt cooldown has just expired (more than 7 days)', () async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.notStarted);
      final eightDaysAgo = DateTime.now().subtract(const Duration(days: 8)).millisecondsSinceEpoch;
      when(mockPrefs.getInt(_lastPromptKey)).thenReturn(eightDaysAgo);

      // Act
      final result = await manager.shouldShowPrompt();

      // Assert
      expect(result, isTrue);
    });
  });

  group('KYCPromptManager - showPrompt (Widget Testing)', () {
    // A simple widget to host the manager and provide a BuildContext
    Widget createTestWidget(Widget child) {
      return MaterialApp(
        home: Builder(
          builder: (context) => child,
        ),
      );
    }

    testWidgets('should show AlertDialog if prompt is needed', (WidgetTester tester) async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.notStarted);
      // Ensure shouldShowPrompt returns true by mocking no previous prompt time
      when(mockPrefs.getInt(any)).thenReturn(null);

      await tester.pumpWidget(createTestWidget(
        ElevatedButton(
          onPressed: () => manager.showPrompt(tester.element(find.byType(Builder))),
          child: const Text('Test Button'),
        ),
      ));

      // Act: Tap the button to trigger showPrompt
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle(); // Wait for the dialog to appear

      // Assert 1: Dialog is visible and contains expected text
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.text('Complete Your KYC'), findsOneWidget);
      expect(find.text('To continue using all features, please complete your Know Your Customer verification.'), findsOneWidget);

      // Assert 2: Interaction buttons are present
      expect(find.byKey(const Key('remindMeLaterButton')), findsOneWidget);
      expect(find.byKey(const Key('completeKycButton')), findsOneWidget);

      // Assert 3: Verify that the last prompt time was updated
      verify(mockPrefs.setInt(KYCPromptManager._lastPromptKey, any)).called(1);
    });

    testWidgets('should dismiss dialog when "Remind Me Later" is tapped', (WidgetTester tester) async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.notStarted);
      when(mockPrefs.getInt(any)).thenReturn(null);

      await tester.pumpWidget(createTestWidget(
        ElevatedButton(
          onPressed: () => manager.showPrompt(tester.element(find.byType(Builder))),
          child: const Text('Test Button'),
        ),
      ));

      // Show the dialog
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);

      // Act: Tap "Remind Me Later"
      await tester.tap(find.byKey(const Key('remindMeLaterButton')));
      await tester.pumpAndSettle(); // Wait for the dialog to disappear

      // Assert: Dialog is gone
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('should dismiss dialog when "Complete Now" is tapped', (WidgetTester tester) async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.notStarted);
      when(mockPrefs.getInt(any)).thenReturn(null);

      await tester.pumpWidget(createTestWidget(
        ElevatedButton(
          onPressed: () => manager.showPrompt(tester.element(find.byType(Builder))),
          child: const Text('Test Button'),
        ),
      ));

      // Show the dialog
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);

      // Act: Tap "Complete Now"
      await tester.tap(find.byKey(const Key('completeKycButton')));
      await tester.pumpAndSettle(); // Wait for the dialog to disappear

      // Assert: Dialog is gone
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('should NOT show dialog if prompt is NOT needed (KYC Verified)', (WidgetTester tester) async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.verified);

      await tester.pumpWidget(createTestWidget(
        ElevatedButton(
          onPressed: () => manager.showPrompt(tester.element(find.byType(Builder))),
          child: const Text('Test Button'),
        ),
      ));

      // Act: Tap the button to trigger showPrompt
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle(); // Wait for any potential dialog

      // Assert: No dialog is shown
      expect(find.byType(AlertDialog), findsNothing);

      // Assert: Last prompt time was NOT updated
      verifyNever(mockPrefs.setInt(KYCPromptManager._lastPromptKey, any));
    });

    testWidgets('should NOT show dialog if prompt is NOT needed (Cooldown Active)', (WidgetTester tester) async {
      // Arrange
      when(mockKycService.getKycStatus()).thenAnswer((_) async => KycStatus.notStarted);
      final fiveDaysAgo = DateTime.now().subtract(const Duration(days: 5)).millisecondsSinceEpoch;
      when(mockPrefs.getInt(KYCPromptManager._lastPromptKey)).thenReturn(fiveDaysAgo);

      await tester.pumpWidget(createTestWidget(
        ElevatedButton(
          onPressed: () => manager.showPrompt(tester.element(find.byType(Builder))),
          child: const Text('Test Button'),
        ),
      ));

      // Act: Tap the button to trigger showPrompt
      await tester.tap(find.byType(ElevatedButton));
      await tester.pumpAndSettle(); // Wait for any potential dialog

      // Assert: No dialog is shown
      expect(find.byType(AlertDialog), findsNothing);

      // Assert: Last prompt time was NOT updated
      verifyNever(mockPrefs.setInt(KYCPromptManager._lastPromptKey, any));
    });
  });
}