// ignore_for_file: public_member_api_docs, sort_constructors_first
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// A set of possible KYC (Know Your Customer) statuses for a user.
enum KycStatus {
  /// The user has not started the KYC process.
  notStarted,

  /// The user has started but not completed the KYC process.
  inProgress,

  /// The user has submitted their documents and is awaiting review.
  pendingReview,

  /// The user's KYC is approved and they have full access.
  approved,

  /// The user's KYC was rejected and they need to resubmit.
  rejected,

  /// An error occurred while fetching the KYC status.
  error,
}

/// A model representing the user's current KYC and account limits.
class UserKycProfile {
  final KycStatus status;
  final double currentLimit;
  final double upgradeLimit;
  final String upgradeReason;
  final String upgradeActionUrl;

  UserKycProfile({
    required this.status,
    required this.currentLimit,
    required this.upgradeLimit,
    required this.upgradeReason,
    required this.upgradeActionUrl,
  });

  /// Factory constructor to create a profile from a JSON-like map.
  factory UserKycProfile.fromJson(Map<String, dynamic> json) {
    return UserKycProfile(
      status: KycStatus.values.firstWhere(
        (e) => e.toString().split('.').last == json['status'],
        orElse: () => KycStatus.error,
      ),
      currentLimit: (json['currentLimit'] as num).toDouble(),
      upgradeLimit: (json['upgradeLimit'] as num).toDouble(),
      upgradeReason: json['upgradeReason'] as String,
      upgradeActionUrl: json['upgradeActionUrl'] as String,
    );
  }

  /// Placeholder for a real API call to fetch the user's profile.
  /// Simulates network latency and potential errors.
  static Future<UserKycProfile> fetchProfileFromApi() async {
    // Simulate network delay
    await Future.delayed(const Duration(milliseconds: 500));

    // Simulate different scenarios for demonstration
    // In a real app, this would be an actual HTTP request.
    final int scenario = DateTime.now().second % 3;

    try {
      if (scenario == 0) {
        // Scenario 1: Approved user with high limit
        return UserKycProfile.fromJson({
          'status': 'approved',
          'currentLimit': 50000.00,
          'upgradeLimit': 100000.00,
          'upgradeReason': 'You have reached the highest tier.',
          'upgradeActionUrl': 'https://app.example.com/kyc/status',
        });
      } else if (scenario == 1) {
        // Scenario 2: User needs to upgrade KYC
        return UserKycProfile.fromJson({
          'status': 'notStarted',
          'currentLimit': 5000.00,
          'upgradeLimit': 25000.00,
          'upgradeReason': 'Upgrade to increase your transaction limit.',
          'upgradeActionUrl': 'https://app.example.com/kyc/start',
        });
      } else {
        // Scenario 3: User is at a limit and needs to upgrade
        return UserKycProfile.fromJson({
          'status': 'inProgress',
          'currentLimit': 10000.00,
          'upgradeLimit': 50000.00,
          'upgradeReason': 'Your current limit is almost reached. Upgrade now!',
          'upgradeActionUrl': 'https://app.example.com/kyc/continue',
        });
      }
    } on Exception catch (e) {
      // Log the error and return a safe, error state profile
      debugPrint('Error fetching KYC profile: $e');
      return UserKycProfile(
        status: KycStatus.error,
        currentLimit: 0.0,
        upgradeLimit: 0.0,
        upgradeReason: 'Failed to load profile. Please try again.',
        upgradeActionUrl: '',
      );
    }
  }
}

/// A utility class to manage and display contextual KYC upgrade prompts
/// using Flutter's [showDialog] and Material Design components.
///
/// This class follows the Singleton pattern to ensure a single point of
/// control for managing dialogs and fetching KYC status.
class KYCPromptManager {
  // --- Singleton Implementation ---
  static final KYCPromptManager _instance = KYCPromptManager._internal();

  /// Private constructor for the Singleton pattern.
  KYCPromptManager._internal();

  /// The factory constructor to return the single instance of the manager.
  factory KYCPromptManager() {
    return _instance;
  }
  // --------------------------------

  /// A private variable to hold the last fetched user profile.
  UserKycProfile? _cachedProfile;

  /// A private variable to track if a dialog is currently being shown.
  bool _isDialogShowing = false;

  /// Fetches the user's KYC profile, caches it, and handles potential errors.
  ///
  /// In a real application, this would integrate with a state management
  /// solution (e.g., Provider, Riverpod, Bloc) or a dedicated API service.
  ///
  /// Returns the fetched [UserKycProfile] or a profile with [KycStatus.error]
  /// if the API call fails.
  Future<UserKycProfile> _fetchKycProfile() async {
    try {
      _cachedProfile = await UserKycProfile.fetchProfileFromApi();
      return _cachedProfile!;
    } on SocketException {
      // Handle network-specific errors
      debugPrint('Network error while fetching KYC profile.');
      return UserKycProfile(
        status: KycStatus.error,
        currentLimit: 0.0,
        upgradeLimit: 0.0,
        upgradeReason: 'No internet connection. Please check your network.',
        upgradeActionUrl: '',
      );
    } on PlatformException catch (e) {
      // Handle platform-specific errors (e.g., from a native module)
      debugPrint('Platform error while fetching KYC profile: ${e.message}');
      return UserKycProfile(
        status: KycStatus.error,
        currentLimit: 0.0,
        upgradeLimit: 0.0,
        upgradeReason: 'An unexpected error occurred: ${e.code}',
        upgradeActionUrl: '',
      );
    } catch (e) {
      // Handle all other unexpected errors
      debugPrint('An unknown error occurred: $e');
      return UserKycProfile(
        status: KycStatus.error,
        currentLimit: 0.0,
        upgradeLimit: 0.0,
        upgradeReason: 'An unknown error occurred.',
        upgradeActionUrl: '',
      );
    }
  }

  /// Displays a generic KYC upgrade prompt if the user's status is not [KycStatus.approved].
  ///
  /// This method is typically called when the user navigates to a screen
  /// where KYC is a prerequisite for full functionality.
  ///
  /// [context] is the build context used to show the dialog.
  /// [force] if true, will show the dialog even if one is already showing.
  ///
  /// Returns `true` if a dialog was shown, `false` otherwise.
  Future<bool> showUpgradePrompt(BuildContext context, {bool force = false}) async {
    if (_isDialogShowing && !force) {
      debugPrint('KYC Upgrade Dialog is already showing. Skipping.');
      return false;
    }

    final profile = await _fetchKycProfile();

    if (profile.status == KycStatus.approved) {
      debugPrint('KYC is already approved. No prompt needed.');
      return false;
    }

    if (profile.status == KycStatus.pendingReview) {
      // Special case: Do not prompt if documents are already submitted.
      debugPrint('KYC is pending review. No action needed from user.');
      return false;
    }

    _isDialogShowing = true;
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: true,
        builder: (BuildContext dialogContext) {
          return AlertDialog(
            title: const Text('Action Required: Complete Your KYC'),
            content: SingleChildScrollView(
              child: ListBody(
                children: <Widget>[
                  Text(
                    'Your current KYC status is: ${profile.status.name.toUpperCase()}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    profile.upgradeReason,
                    style: const TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Current Limit: \$${profile.currentLimit.toStringAsFixed(2)}',
                  ),
                  Text(
                    'Upgrade Limit: \$${profile.upgradeLimit.toStringAsFixed(2)}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            actions: <Widget>[
              TextButton(
                child: const Text('LATER'),
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                },
              ),
              ElevatedButton(
                child: const Text('UPGRADE NOW'),
                onPressed: profile.upgradeActionUrl.isNotEmpty
                    ? () {
                        // In a real app, this would navigate to the KYC screen
                        // or launch a URL (e.g., using the url_launcher package).
                        debugPrint('Navigating to KYC URL: ${profile.upgradeActionUrl}');
                        Navigator.of(dialogContext).pop();
                      }
                    : null, // Disable button if no action URL is available
              ),
            ],
          );
        },
      );
      return true;
    } catch (e) {
      debugPrint('Error showing KYC Upgrade Dialog: $e');
      return false;
    } finally {
      _isDialogShowing = false;
    }
  }

  /// Displays a specific warning prompt when a user is approaching or has reached
  /// their current transaction limit, which is tied to their KYC level.
  ///
  /// This method is typically called right before a transaction attempt.
  ///
  /// [context] is the build context used to show the dialog.
  /// [currentTransactionAmount] is the amount the user is trying to transact.
  /// [force] if true, will show the dialog even if one is already showing.
  ///
  /// Returns `true` if a dialog was shown, `false` otherwise.
  Future<bool> showLimitWarning(
    BuildContext context, {
    required double currentTransactionAmount,
    bool force = false,
  }) async {
    if (_isDialogShowing && !force) {
      debugPrint('KYC Limit Warning Dialog is already showing. Skipping.');
      return false;
    }

    final profile = await _fetchKycProfile();

    if (profile.status == KycStatus.approved) {
      debugPrint('KYC is fully approved. No limit warning needed.');
      return false;
    }

    // Check if the transaction amount exceeds the current limit
    if (currentTransactionAmount > profile.currentLimit) {
      _isDialogShowing = true;
      try {
        await showDialog<void>(
          context: context,
          barrierDismissible: false, // Force user to acknowledge the limit
          builder: (BuildContext dialogContext) {
            return AlertDialog(
              icon: const Icon(Icons.warning_amber_rounded, color: Colors.red, size: 36),
              title: const Text('Transaction Limit Reached'),
              content: SingleChildScrollView(
                child: ListBody(
                  children: <Widget>[
                    Text(
                      'The transaction amount of \$${currentTransactionAmount.toStringAsFixed(2)} exceeds your current limit of \$${profile.currentLimit.toStringAsFixed(2)}.',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'To complete this transaction, you must upgrade your KYC level. The next level will increase your limit to \$${profile.upgradeLimit.toStringAsFixed(2)}.',
                      style: const TextStyle(color: Colors.black54),
                    ),
                  ],
                ),
              ),
              actions: <Widget>[
                TextButton(
                  child: const Text('CANCEL'),
                  onPressed: () {
                    Navigator.of(dialogContext).pop();
                  },
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                  child: const Text('UPGRADE KYC'),
                  onPressed: profile.upgradeActionUrl.isNotEmpty
                      ? () {
                          // Navigate to the KYC upgrade screen
                          debugPrint('Navigating to KYC URL: ${profile.upgradeActionUrl}');
                          Navigator.of(dialogContext).pop();
                        }
                      : null,
                ),
              ],
            );
          },
        );
        return true;
      } catch (e) {
        debugPrint('Error showing KYC Limit Warning Dialog: $e');
        return false;
      } finally {
        _isDialogShowing = false;
      }
    }

    debugPrint('Transaction is within limit. No warning needed.');
    return false;
  }

  /// A helper method to demonstrate how to use the manager.
  /// This is not part of the core functionality but useful for testing.
  static Widget buildDemoButton(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ElevatedButton(
          onPressed: () => KYCPromptManager().showUpgradePrompt(context),
          child: const Text('Show Generic Upgrade Prompt'),
        ),
        const SizedBox(height: 10),
        ElevatedButton(
          onPressed: () => KYCPromptManager().showLimitWarning(
            context,
            currentTransactionAmount: 15000.00, // Amount that will trigger the warning
          ),
          child: const Text('Show Limit Warning (15000.00)'),
        ),
        const SizedBox(height: 10),
        ElevatedButton(
          onPressed: () => KYCPromptManager().showLimitWarning(
            context,
            currentTransactionAmount: 100.00, // Amount that will NOT trigger the warning
          ),
          child: const Text('Show Limit Warning (100.00)'),
        ),
      ],
    );
  }
}

// --- Example Usage (for documentation purposes) ---
/*
// To use this manager, you would typically inject it into your service locator
// or simply call the factory constructor.

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'KYC Prompt Demo',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    // Example of calling the prompt manager on screen load
    WidgetsBinding.instance.addPostFrameCallback((_) {
      KYCPromptManager().showUpgradePrompt(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home Screen'),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Text(
              'Welcome! Check the console for simulated API calls.',
            ),
            const SizedBox(height: 30),
            KYCPromptManager.buildDemoButton(context),
          ],
        ),
      ),
    );
  }
}
*/