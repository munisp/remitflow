// File: /home/ubuntu/NIGERIAN_REMITTANCE_100_PARITY/mobile/flutter/lib/screens/kyc_verification_screen.dart

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:local_auth/local_auth.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

// --- 1. Models ---

/// Represents the status of the KYC verification process.
enum KycStatus {
  notStarted,
  pending,
  verified,
  rejected,
}

/// Represents a document to be uploaded for KYC.
class KycDocument {
  final String type;
  final String description;
  File? file;
  KycStatus status;

  KycDocument({
    required this.type,
    required this.description,
    this.file,
    this.status = KycStatus.notStarted,
  });

  KycDocument copyWith({
    File? file,
    KycStatus? status,
  }) {
    return KycDocument(
      type: type,
      description: description,
      file: file ?? this.file,
      status: status ?? this.status,
    );
  }
}

// --- 2. State Management (Provider) ---

/// Manages the state for the KYC verification screen.
class KycProvider with ChangeNotifier {
  final LocalAuthentication _auth = LocalAuthentication();
  final SharedPreferences _prefs;
  final String _offlineStatusKey = 'kyc_offline_status';

  bool _isLoading = false;
  String? _errorMessage;
  KycStatus _overallStatus = KycStatus.notStarted;
  List<KycDocument> _documents = [
    KycDocument(type: 'ID_CARD', description: 'National ID Card (Front/Back)'),
    KycDocument(type: 'PROOF_OF_ADDRESS', description: 'Utility Bill or Bank Statement'),
    KycDocument(type: 'SELFIE', description: 'Selfie with ID Card'),
  ];

  KycProvider(this._prefs) {
    _loadOfflineStatus();
  }

  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  KycStatus get overallStatus => _overallStatus;
  List<KycDocument> get documents => _documents;

  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  void _setErrorMessage(String? message) {
    _errorMessage = message;
    notifyListeners();
  }

  /// Loads the last known KYC status from local storage for offline support.
  Future<void> _loadOfflineStatus() async {
    final statusString = _prefs.getString(_offlineStatusKey);
    if (statusString != null) {
      try {
        _overallStatus = KycStatus.values.firstWhere(
          (e) => e.toString().split('.').last == statusString,
          orElse: () => KycStatus.notStarted,
        );
      } catch (e) {
        // Handle potential parsing error
        _overallStatus = KycStatus.notStarted;
      }
      notifyListeners();
    }
  }

  /// Saves the current overall KYC status to local storage.
  Future<void> _saveOfflineStatus() async {
    await _prefs.setString(_offlineStatusKey, _overallStatus.toString().split('.').last);
  }

  /// Handles document selection from gallery or camera.
  Future<void> pickDocument(String docType, ImageSource source) async {
    _setErrorMessage(null);
    final picker = ImagePicker();
    final pickedFile = await picker.pickImage(source: source);

    if (pickedFile != null) {
      final file = File(pickedFile.path);
      final index = _documents.indexWhere((doc) => doc.type == docType);
      if (index != -1) {
        _documents[index] = _documents[index].copyWith(file: file, status: KycStatus.pending);
        notifyListeners();
      }
    } else {
      _setErrorMessage('No image selected for $docType.');
    }
  }

  /// Mocks an API call to upload a document.
  Future<bool> _uploadDocument(KycDocument doc) async {
    // Mock API call
    final url = Uri.parse('https://api.mockkyc.com/v1/upload');
    try {
      // Simulate network delay
      await Future.delayed(const Duration(seconds: 2));

      // Simulate a successful upload for the purpose of this mock
      final response = http.Response(
        json.encode({'success': true, 'message': '${doc.type} uploaded successfully'}),
        200,
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return data['success'] ?? false;
      } else {
        _setErrorMessage('Failed to upload ${doc.type}. Server error: ${response.statusCode}');
        return false;
      }
    } catch (e) {
      _setErrorMessage('Network error during ${doc.type} upload: $e');
      return false;
    }
  }

  /// Submits all documents for verification.
  Future<void> submitForVerification() async {
    _setLoading(true);
    _setErrorMessage(null);

    // 1. Basic validation
    if (_documents.any((doc) => doc.file == null)) {
      _setErrorMessage('Please upload all required documents.');
      _setLoading(false);
      return;
    }

    // 2. Biometric Authentication (Security check before submission)
    final isAuthenticated = await _authenticateBiometrics();
    if (!isAuthenticated) {
      _setErrorMessage('Biometric authentication failed. Submission cancelled.');
      _setLoading(false);
      return;
    }

    // 3. Document Upload and Status Update
    bool allSuccess = true;
    for (int i = 0; i < _documents.length; i++) {
      final doc = _documents[i];
      _documents[i] = doc.copyWith(status: KycStatus.pending);
      notifyListeners();

      final success = await _uploadDocument(doc);
      if (success) {
        _documents[i] = doc.copyWith(status: KycStatus.verified);
      } else {
        _documents[i] = doc.copyWith(status: KycStatus.rejected);
        allSuccess = false;
        break; // Stop on first failure
      }
      notifyListeners();
    }

    // 4. Update Overall Status and Offline Storage
    if (allSuccess) {
      _overallStatus = KycStatus.pending; // Assuming server processing takes time
      _setErrorMessage('Documents submitted successfully. Verification is pending.');
    } else {
      _overallStatus = KycStatus.rejected;
      _setErrorMessage('Submission failed. Please check the rejected document(s) and try again.');
    }

    await _saveOfflineStatus();
    _setLoading(false);
  }

  /// Performs biometric authentication using local_auth.
  Future<bool> _authenticateBiometrics() async {
    try {
      final bool canCheckBiometrics = await _auth.canCheckBiometrics;
      if (!canCheckBiometrics) {
        // Fallback to a simple confirmation if biometrics are not available
        return true;
      }

      final bool didAuthenticate = await _auth.authenticate(
        localizedReason: 'Please authenticate to confirm KYC submission',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );
      return didAuthenticate;
    } catch (e) {
      _setErrorMessage('Error during biometric authentication: $e');
      return false;
    }
  }

  /// Mocks a payment gateway integration for a small verification fee.
  Future<void> processVerificationFee() async {
    _setLoading(true);
    _setErrorMessage(null);
    try {
      // Mock payment process
      await Future.delayed(const Duration(seconds: 1));
      // In a real app, this would involve a package like flutter_stripe or paystack
      // and an API call to confirm payment.
      print('Mock Payment successful. Fee: \$1.00');
      _setErrorMessage('Verification fee paid successfully (Mock).');
    } catch (e) {
      _setErrorMessage('Payment processing failed: $e');
    }
    _setLoading(false);
  }
}

// --- 3. Screen Implementation (StatefulWidget) ---

class KycVerificationScreen extends StatefulWidget {
  const KycVerificationScreen({super.key});

  @override
  State<KycVerificationScreen> createState() => _KycVerificationScreenState();
}

class _KycVerificationScreenState extends State<KycVerificationScreen> {
  late Future<SharedPreferences> _prefsFuture;

  @override
  void initState() {
    super.initState();
    // Initialize SharedPreferences once
    _prefsFuture = SharedPreferences.getInstance();
  }

  @override
  Widget build(BuildContext context) {
    // Use FutureBuilder to wait for SharedPreferences initialization
    return FutureBuilder<SharedPreferences>(
      future: _prefsFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return Scaffold(
            body: Center(child: Text('Error loading local storage: ${snapshot.error}')),
          );
        }

        // Once SharedPreferences is ready, provide the KycProvider
        return ChangeNotifierProvider(
          create: (context) => KycProvider(snapshot.data!),
          child: Scaffold(
            appBar: AppBar(
              title: const Text('KYC Verification'),
              // Accessibility: Add a semantic label to the back button
              leading: Semantics(
                label: 'Go back to previous screen',
                child: IconButton(
                  icon: const Icon(Icons.arrow_back),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ),
            body: const KycVerificationBody(),
          ),
        );
      },
    );
  }
}

class KycVerificationBody extends StatelessWidget {
  const KycVerificationBody({super.key});

  @override
  Widget build(BuildContext context) {
    final kycProvider = Provider.of<KycProvider>(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          // Verification Status Header
          _buildStatusHeader(kycProvider.overallStatus),
          const SizedBox(height: 20),

          // Error Message Display
          if (kycProvider.errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16.0),
              child: Semantics(
                liveRegion: true, // Announce changes to screen readers
                child: Text(
                  kycProvider.errorMessage!,
                  style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold),
                ),
              ),
            ),

          // Document Upload Section
          Text(
            'Required Documents',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 10),
          ...kycProvider.documents.map((doc) => _buildDocumentTile(context, kycProvider, doc)).toList(),
          const SizedBox(height: 30),

          // Payment Gateway Mock
          _buildPaymentSection(context, kycProvider),
          const SizedBox(height: 30),

          // Submission Button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: kycProvider.isLoading || kycProvider.overallStatus == KycStatus.pending
                  ? null
                  : () => kycProvider.submitForVerification(),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 15),
              ),
              child: kycProvider.isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text(
                      'Submit for Verification',
                      style: TextStyle(fontSize: 18),
                    ),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  /// Builds the header displaying the current KYC status.
  Widget _buildStatusHeader(KycStatus status) {
    IconData icon;
    Color color;
    String text;

    switch (status) {
      case KycStatus.notStarted:
        icon = Icons.info_outline;
        color = Colors.blue;
        text = 'Status: Not Started. Please upload documents.';
        break;
      case KycStatus.pending:
        icon = Icons.access_time;
        color = Colors.orange;
        text = 'Status: Pending. Verification in progress.';
        break;
      case KycStatus.verified:
        icon = Icons.check_circle;
        color = Colors.green;
        text = 'Status: Verified! You are all set.';
        break;
      case KycStatus.rejected:
        icon = Icons.cancel;
        color = Colors.red;
        text = 'Status: Rejected. Please re-upload documents.';
        break;
    }

    return Card(
      color: color.withOpacity(0.1),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Row(
          children: [
            Icon(icon, color: color, size: 30),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                style: TextStyle(color: color, fontWeight: FontWeight.bold),
                // Accessibility: Use a key for testing and semantic label
                key: const Key('kycStatusText'),
                semanticsLabel: text,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Builds a tile for a single document upload.
  Widget _buildDocumentTile(BuildContext context, KycProvider provider, KycDocument doc) {
    IconData statusIcon;
    Color statusColor;
    String statusText;

    switch (doc.status) {
      case KycStatus.notStarted:
        statusIcon = Icons.upload_file;
        statusColor = Colors.grey;
        statusText = 'Upload Required';
        break;
      case KycStatus.pending:
        statusIcon = Icons.hourglass_empty;
        statusColor = Colors.orange;
        statusText = 'Processing...';
        break;
      case KycStatus.verified:
        statusIcon = Icons.check_circle;
        statusColor = Colors.green;
        statusText = 'Verified';
        break;
      case KycStatus.rejected:
        statusIcon = Icons.error;
        statusColor = Colors.red;
        statusText = 'Rejected';
        break;
    }

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8.0),
      child: ListTile(
        leading: Icon(statusIcon, color: statusColor),
        title: Text(doc.description, style: const TextStyle(fontWeight: FontWeight.w500)),
        subtitle: Text(doc.file != null ? 'File: ${doc.file!.path.split('/').last}' : statusText),
        trailing: IconButton(
          icon: const Icon(Icons.camera_alt),
          onPressed: provider.isLoading
              ? null
              : () => _showPicker(context, provider, doc.type),
          tooltip: 'Upload or take a photo of ${doc.description}',
        ),
        onTap: provider.isLoading
            ? null
            : () => _showPicker(context, provider, doc.type),
      ),
    );
  }

  /// Shows a dialog to choose between camera and gallery.
  void _showPicker(BuildContext context, KycProvider provider, String docType) {
    showModalBottomSheet(
      context: context,
      builder: (BuildContext bc) {
        return SafeArea(
          child: Wrap(
            children: <Widget>[
              ListTile(
                leading: const Icon(Icons.photo_library),
                title: const Text('Photo Library'),
                onTap: () {
                  provider.pickDocument(docType, ImageSource.gallery);
                  Navigator.of(context).pop();
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_camera),
                title: const Text('Camera'),
                onTap: () {
                  provider.pickDocument(docType, ImageSource.camera);
                  Navigator.of(context).pop();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  /// Builds the mock payment section.
  Widget _buildPaymentSection(BuildContext context, KycProvider provider) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Verification Fee Payment',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 10),
        const Text('A small, one-time fee of \$1.00 is required for document processing.'),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            icon: provider.isLoading
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.payment),
            label: const Text('Pay Verification Fee (\$1.00)'),
            onPressed: provider.isLoading ? null : () => provider.processVerificationFee(),
          ),
        ),
      ],
    );
  }
}

// --- 4. Main Function for Testing (Optional but good practice) ---
// void main() async {
//   WidgetsFlutterBinding.ensureInitialized();
//   // Mock SharedPreferences for testing the screen in isolation
//   SharedPreferences.setMockInitialValues({});
//   final prefs = await SharedPreferences.getInstance();

//   runApp(
//     ChangeNotifierProvider(
//       create: (context) => KycProvider(prefs),
//       child: const MyApp(),
//     ),
//   );
// }

// class MyApp extends StatelessWidget {
//   const MyApp({super.key});

//   @override
//   Widget build(BuildContext context) {
//     return MaterialApp(
//       title: 'KYC Demo',
//       theme: ThemeData(
//         primarySwatch: Colors.blue,
//         visualDensity: VisualDensity.adaptivePlatformDensity,
//       ),
//       home: const KycVerificationScreen(),
//     );
//   }
// }
