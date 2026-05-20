import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'dart:math';

// --- 1. Data Model (Beneficiary) ---
// This would typically be in 'lib/models/beneficiary.dart'
class Beneficiary {
  final String id;
  final String name;
  final String accountNumber;
  final String bankName;
  final String nickname;
  final bool isFavorite;

  Beneficiary({
    required this.id,
    required this.name,
    required this.accountNumber,
    required this.bankName,
    required this.nickname,
    this.isFavorite = false,
  });

  Beneficiary copyWith({
    String? id,
    String? name,
    String? accountNumber,
    String? bankName,
    String? nickname,
    bool? isFavorite,
  }) {
    return Beneficiary(
      id: id ?? this.id,
      name: name ?? this.name,
      accountNumber: accountNumber ?? this.accountNumber,
      bankName: bankName ?? this.bankName,
      nickname: nickname ?? this.nickname,
      isFavorite: isFavorite ?? this.isFavorite,
    );
  }

  factory Beneficiary.fromJson(Map<String, dynamic> json) {
    return Beneficiary(
      id: json['id'] as String,
      name: json['name'] as String,
      accountNumber: json['accountNumber'] as String,
      bankName: json['bankName'] as String,
      nickname: json['nickname'] as String,
      isFavorite: json['isFavorite'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'accountNumber': accountNumber,
      'bankName': bankName,
      'nickname': nickname,
      'isFavorite': isFavorite,
    };
  }
}

// --- 2. State Management (Riverpod State Class) ---
// This would typically be in 'lib/state/beneficiary_state.dart'
class BeneficiaryState {
  final List<Beneficiary> beneficiaries;
  final bool isLoading;
  final String? errorMessage;
  final bool isOffline;

  BeneficiaryState({
    required this.beneficiaries,
    this.isLoading = false,
    this.errorMessage,
    this.isOffline = false,
  });

  BeneficiaryState copyWith({
    List<Beneficiary>? beneficiaries,
    bool? isLoading,
    String? errorMessage,
    bool? isOffline,
  }) {
    return BeneficiaryState(
      beneficiaries: beneficiaries ?? this.beneficiaries,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage, // Always pass new error message or null
      isOffline: isOffline ?? this.isOffline,
    );
  }
}

// --- 3. Service Interface and Mock Implementation ---
// This would typically be in 'lib/services/beneficiary_service.dart'
abstract class BeneficiaryService {
  Future<List<Beneficiary>> fetchBeneficiaries();
  Future<Beneficiary> addBeneficiary(Beneficiary beneficiary);
  Future<void> updateBeneficiary(Beneficiary beneficiary);
  Future<void> deleteBeneficiary(String id);
  Future<bool> authenticateBiometrics();
  Future<void> saveToLocal(List<Beneficiary> beneficiaries);
  Future<List<Beneficiary>> loadFromLocal();
  Future<void> processPayment(String beneficiaryId, double amount);
}

// Mock implementation for the service
// In a real app, this would use 'package:http/http.dart' and 'package:local_auth/local_auth.dart'
// and 'package:shared_preferences/shared_preferences.dart'
class MockBeneficiaryService implements BeneficiaryService {
  // Mock data store
  final List<Beneficiary> _mockBeneficiaries = [
    Beneficiary(
      id: '1',
      name: 'John Doe',
      accountNumber: '1234567890',
      bankName: 'First Bank',
      nickname: 'JD',
      isFavorite: true,
    ),
    Beneficiary(
      id: '2',
      name: 'Jane Smith',
      accountNumber: '0987654321',
      bankName: 'Zenith Bank',
      nickname: 'JS',
    ),
  ];

  // Mock API call delay
  Future<void> _delay() => Future.delayed(const Duration(milliseconds: 800));

  @override
  Future<List<Beneficiary>> fetchBeneficiaries() async {
    await _delay();
    // Mock network error 10% of the time
    if (DateTime.now().second % 10 == 0) {
      throw Exception('Network connection failed. Please try again.');
    }
    return List.from(_mockBeneficiaries);
  }

  @override
  Future<Beneficiary> addBeneficiary(Beneficiary beneficiary) async {
    await _delay();
    final newBeneficiary = beneficiary.copyWith(id: DateTime.now().millisecondsSinceEpoch.toString());
    _mockBeneficiaries.add(newBeneficiary);
    return newBeneficiary;
  }

  @override
  Future<void> updateBeneficiary(Beneficiary beneficiary) async {
    await _delay();
    final index = _mockBeneficiaries.indexWhere((b) => b.id == beneficiary.id);
    if (index != -1) {
      _mockBeneficiaries[index] = beneficiary;
    } else {
      throw Exception('Beneficiary not found for update.');
    }
  }

  @override
  Future<void> deleteBeneficiary(String id) async {
    await _delay();
    _mockBeneficiaries.removeWhere((b) => b.id == id);
  }

  @override
  Future<bool> authenticateBiometrics() async {
    await _delay();
    // Mock successful biometric authentication
    return true;
  }

  // Mock shared_preferences implementation
  static const _localKey = 'local_beneficiaries';

  @override
  Future<void> saveToLocal(List<Beneficiary> beneficiaries) async {
    // In a real app, this would use shared_preferences or hive
    // final prefs = await SharedPreferences.getInstance();
    // final jsonList = beneficiaries.map((b) => jsonEncode(b.toJson())).toList();
    // await prefs.setStringList(_localKey, jsonList);
    await _delay();
    print('Mock: Saved ${beneficiaries.length} beneficiaries to local storage.');
  }

  @override
  Future<List<Beneficiary>> loadFromLocal() async {
    await _delay();
    // In a real app, this would use shared_preferences or hive
    // final prefs = await SharedPreferences.getInstance();
    // final jsonList = prefs.getStringList(_localKey) ?? [];
    // return jsonList.map((jsonString) => Beneficiary.fromJson(jsonDecode(jsonString))).toList();
    print('Mock: Loaded beneficiaries from local storage.');
    return _mockBeneficiaries; // Return mock data for simplicity
  }

  @override
  Future<void> processPayment(String beneficiaryId, double amount) async {
    await _delay();
    final beneficiary = _mockBeneficiaries.firstWhere((b) => b.id == beneficiaryId);
    print('Mock: Successfully processed payment of \$$amount to ${beneficiary.name}.');
  }
}

// --- 4. Riverpod Provider ---
// This would typically be in 'lib/providers/beneficiary_provider.dart'
// We use a StateNotifier for complex state logic
// --- 4. Riverpod Provider ---
// This would typically be in 'lib/providers/beneficiary_provider.dart'
class BeneficiaryNotifier extends StateNotifier<BeneficiaryState> {
  final BeneficiaryService _service;

  BeneficiaryNotifier(this._service) : super(BeneficiaryState(beneficiaries: [])) {
    fetchBeneficiaries();
  }

  Future<void> fetchBeneficiaries({bool forceRefresh = false}) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      List<Beneficiary> beneficiaries;
      if (!forceRefresh) {
        // Try to load from local storage first
        beneficiaries = await _service.loadFromLocal();
        if (beneficiaries.isNotEmpty) {
          state = state.copyWith(
            beneficiaries: beneficiaries,
            isLoading: false,
            isOffline: true,
          );
        }
      }

      // Then fetch from API
      beneficiaries = await _service.fetchBeneficiaries();
      await _service.saveToLocal(beneficiaries); // Save to local after successful fetch
      state = state.copyWith(
        beneficiaries: beneficiaries,
        isLoading: false,
        isOffline: false,
      );
    } catch (e) {
      // If API fails, try to load from local if not already loaded
      if (state.beneficiaries.isEmpty) {
        try {
          final localBeneficiaries = await _service.loadFromLocal();
          state = state.copyWith(
            beneficiaries: localBeneficiaries,
            isLoading: false,
            errorMessage: 'Failed to fetch from server. Showing offline data.',
            isOffline: true,
          );
        } catch (localError) {
          state = state.copyWith(
            isLoading: false,
            errorMessage: 'Failed to load data: ${e.toString()}',
            isOffline: false,
          );
        }
      } else {
        state = state.copyWith(
          isLoading: false,
          errorMessage: 'Failed to fetch from server: ${e.toString()}',
          isOffline: state.isOffline,
        );
      }
    }
  }

  Future<void> addBeneficiary(Beneficiary beneficiary) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final newBeneficiary = await _service.addBeneficiary(beneficiary);
      final updatedList = [...state.beneficiaries, newBeneficiary];
      await _service.saveToLocal(updatedList);
      state = state.copyWith(
        beneficiaries: updatedList,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Failed to add beneficiary: ${e.toString()}',
      );
    }
  }

  Future<void> updateBeneficiary(Beneficiary beneficiary) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      await _service.updateBeneficiary(beneficiary);
      final updatedList = state.beneficiaries.map((b) => b.id == beneficiary.id ? beneficiary : b).toList();
      await _service.saveToLocal(updatedList);
      state = state.copyWith(
        beneficiaries: updatedList,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Failed to update beneficiary: ${e.toString()}',
      );
    }
  }

  Future<void> deleteBeneficiary(String id) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      await _service.deleteBeneficiary(id);
      final updatedList = state.beneficiaries.where((b) => b.id != id).toList();
      await _service.saveToLocal(updatedList);
      state = state.copyWith(
        beneficiaries: updatedList,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Failed to delete beneficiary: ${e.toString()}',
      );
    }
  }

  Future<bool> authenticate() async {
    try {
      return await _service.authenticateBiometrics();
    } catch (e) {
      state = state.copyWith(errorMessage: 'Biometric authentication failed: ${e.toString()}');
      return false;
    }
  }

  Future<void> processPayment(String beneficiaryId, double amount) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      await _service.processPayment(beneficiaryId, amount);
      state = state.copyWith(isLoading: false);
      // Optionally, show a success message or navigate
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Payment failed: ${e.toString()}',
      );
    }
  }
}

// Provider definitions
final beneficiaryServiceProvider = Provider<BeneficiaryService>((ref) => MockBeneficiaryService());

final beneficiaryNotifierProvider = StateNotifierProvider<BeneficiaryNotifier, BeneficiaryState>((ref) {
  return BeneficiaryNotifier(ref.watch(beneficiaryServiceProvider));
});

// Placeholder for the main screen content, which will be added in Phase 4

// Placeholder for the main screen content, which will be added in Phase 4
// The final file will contain all the necessary imports and the main screen widget.

// --- 5. UI Components ---

// Helper function for navigation
void _showBeneficiaryForm(BuildContext context, WidgetRef ref, {Beneficiary? beneficiary}) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (context) => BeneficiaryFormScreen(
        beneficiary: beneficiary,
        ref: ref,
      ),
    ),
  );
}

// Helper function for payment simulation
Future<void> _simulatePayment(BuildContext context, WidgetRef ref, Beneficiary beneficiary) async {
  final notifier = ref.read(beneficiaryNotifierProvider.notifier);

  // 1. Biometric Authentication
  final isAuthenticated = await notifier.authenticate();
  if (!isAuthenticated) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Biometric authentication failed. Payment cancelled.')),
    );
    return;
  }

  // 2. Show Payment Dialog
  final amountController = TextEditingController();
  final result = await showDialog<double>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Process Payment'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Sending payment to ${beneficiary.name} (${beneficiary.bankName})'),
          TextFormField(
            controller: amountController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Amount (e.g., 100.00)'),
            validator: (value) {
              if (value == null || double.tryParse(value) == null || double.parse(value) <= 0) {
                return 'Enter a valid amount';
              }
              return null;
            },
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () {
            final amount = double.tryParse(amountController.text);
            if (amount != null) {
              Navigator.of(context).pop(amount);
            }
          },
          child: const Text('Pay'),
        ),
      ],
    ),
  );

  if (result != null) {
    // 3. Process Payment
    await notifier.processPayment(beneficiary.id, result);
    if (notifier.state.errorMessage == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Payment of \$${result.toStringAsFixed(2)} to ${beneficiary.name} successful!')),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Payment failed: ${notifier.state.errorMessage}')),
      );
    }
  }
}

// --- Beneficiary Form Screen (StatefulWidget for Form Validation) ---
class BeneficiaryFormScreen extends ConsumerStatefulWidget {
  final Beneficiary? beneficiary;
  final WidgetRef ref;

  const BeneficiaryFormScreen({super.key, this.beneficiary, required this.ref});

  @override
  ConsumerState<BeneficiaryFormScreen> createState() => _BeneficiaryFormScreenState();
}

class _BeneficiaryFormScreenState extends ConsumerState<BeneficiaryFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameController;
  late TextEditingController _accountNumberController;
  late TextEditingController _bankNameController;
  late TextEditingController _nicknameController;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.beneficiary?.name ?? '');
    _accountNumberController = TextEditingController(text: widget.beneficiary?.accountNumber ?? '');
    _bankNameController = TextEditingController(text: widget.beneficiary?.bankName ?? '');
    _nicknameController = TextEditingController(text: widget.beneficiary?.nickname ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _accountNumberController.dispose();
    _bankNameController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  void _submitForm() async {
    if (_formKey.currentState!.validate()) {
      final newBeneficiary = Beneficiary(
        id: widget.beneficiary?.id ?? '', // ID is only used for update
        name: _nameController.text,
        accountNumber: _accountNumberController.text,
        bankName: _bankNameController.text,
        nickname: _nicknameController.text,
        isFavorite: widget.beneficiary?.isFavorite ?? false,
      );

      final notifier = ref.read(beneficiaryNotifierProvider.notifier);
      if (widget.beneficiary == null) {
        await notifier.addBeneficiary(newBeneficiary);
      } else {
        await notifier.updateBeneficiary(newBeneficiary);
      }

      if (mounted) {
        if (notifier.state.errorMessage == null) {
          Navigator.of(context).pop();
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(notifier.state.errorMessage!)),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isUpdating = widget.beneficiary != null;
    final state = ref.watch(beneficiaryNotifierProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(isUpdating ? 'Edit Beneficiary' : 'Add New Beneficiary'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(labelText: 'Full Name'),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter the full name';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _accountNumberController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Account Number'),
                validator: (value) {
                  if (value == null || value.length < 10) {
                    return 'Account number must be at least 10 digits';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _bankNameController,
                decoration: const InputDecoration(labelText: 'Bank Name'),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter the bank name';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _nicknameController,
                decoration: const InputDecoration(labelText: 'Nickname (Optional)'),
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: state.isLoading ? null : _submitForm,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: state.isLoading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(isUpdating ? 'Save Changes' : 'Add Beneficiary'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// --- Main Beneficiary Management Screen (StatelessWidget) ---
class BeneficiaryManagementScreen extends ConsumerWidget {
  const BeneficiaryManagementScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(beneficiaryNotifierProvider);
    final notifier = ref.read(beneficiaryNotifierProvider.notifier);
    final searchController = TextEditingController();
    final searchFilter = ref.watch(_searchFilterProvider);

    // Filter beneficiaries based on search query
    final filteredBeneficiaries = state.beneficiaries.where((b) {
      final query = searchFilter.toLowerCase();
      return b.name.toLowerCase().contains(query) ||
          b.accountNumber.contains(query) ||
          b.bankName.toLowerCase().contains(query) ||
          b.nickname.toLowerCase().contains(query);
    }).toList();

    Widget bodyContent;

    if (state.isLoading && state.beneficiaries.isEmpty) {
      bodyContent = const Center(child: CircularProgressIndicator());
    } else if (state.errorMessage != null && state.beneficiaries.isEmpty) {
      bodyContent = Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(state.errorMessage!, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () => notifier.fetchBeneficiaries(forceRefresh: true),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    } else if (filteredBeneficiaries.isEmpty && state.beneficiaries.isNotEmpty) {
      bodyContent = const Center(child: Text('No beneficiaries match your search.'));
    } else if (state.beneficiaries.isEmpty) {
      bodyContent = const Center(child: Text('No beneficiaries added yet. Tap + to add one.'));
    } else {
      bodyContent = ListView.builder(
        itemCount: filteredBeneficiaries.length,
        itemBuilder: (context, index) {
          final beneficiary = filteredBeneficiaries[index];
          return BeneficiaryListItem(
            beneficiary: beneficiary,
            onEdit: () => _showBeneficiaryForm(context, ref, beneficiary: beneficiary),
            onDelete: () async {
              final confirm = await showDialog<bool>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('Delete Beneficiary'),
                  content: Text('Are you sure you want to delete ${beneficiary.name}?'),
                  actions: [
                    TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
                    TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Delete')),
                  ],
                ),
              );
              if (confirm == true) {
                await notifier.deleteBeneficiary(beneficiary.id);
              }
            },
            onPay: () => _simulatePayment(context, ref, beneficiary),
            onToggleFavorite: () {
              notifier.updateBeneficiary(beneficiary.copyWith(isFavorite: !beneficiary.isFavorite));
            },
          );
        },
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Beneficiary Management'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56.0),
          child: Padding(
            padding: const EdgeInsets.all(8.0),
            child: TextField(
              controller: searchController,
              decoration: InputDecoration(
                hintText: 'Search beneficiaries...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: searchFilter.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          searchController.clear();
                          ref.read(_searchFilterProvider.notifier).state = '';
                        },
                      )
                    : null,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(25.0),
                  borderSide: BorderSide.none,
                ),
                filled: true,
                fillColor: Theme.of(context).colorScheme.surfaceVariant,
              ),
              onChanged: (value) {
                ref.read(_searchFilterProvider.notifier).state = value;
              },
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          if (state.isOffline)
            Container(
              color: Colors.orange.shade100,
              padding: const EdgeInsets.all(8.0),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.cloud_off, color: Colors.orange),
                  SizedBox(width: 8),
                  Text('Offline Mode: Showing local data.', style: TextStyle(color: Colors.orange)),
                ],
              ),
            ),
          if (state.isLoading && state.beneficiaries.isNotEmpty)
            const LinearProgressIndicator(),
          Expanded(child: bodyContent),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: state.isLoading ? null : () => _showBeneficiaryForm(context, ref),
        child: const Icon(Icons.add),
      ),
    );
  }
}

// Simple Provider for Search Filter
final _searchFilterProvider = StateProvider<String>((ref) => '');

// --- Beneficiary List Item Widget ---
class BeneficiaryListItem extends StatelessWidget {
  final Beneficiary beneficiary;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onPay;
  final VoidCallback onToggleFavorite;

  const BeneficiaryListItem({
    super.key,
    required this.beneficiary,
    required this.onEdit,
    required this.onDelete,
    required this.onPay,
    required this.onToggleFavorite,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
      child: ListTile(
        leading: CircleAvatar(
          child: Text(beneficiary.nickname.isNotEmpty ? beneficiary.nickname[0] : beneficiary.name[0]),
        ),
        title: Text(beneficiary.name, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('${beneficiary.accountNumber} - ${beneficiary.bankName}'),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: Icon(
                beneficiary.isFavorite ? Icons.favorite : Icons.favorite_border,
                color: beneficiary.isFavorite ? Colors.red : null,
              ),
              onPressed: onToggleFavorite,
            ),
            IconButton(
              icon: const Icon(Icons.send),
              tooltip: 'Send Payment',
              onPressed: onPay,
            ),
            PopupMenuButton<String>(
              onSelected: (value) {
                if (value == 'edit') {
                  onEdit();
                } else if (value == 'delete') {
                  onDelete();
                }
              },
              itemBuilder: (context) => [
                const PopupMenuItem(
                  value: 'edit',
                  child: Text('Edit'),
                ),
                const PopupMenuItem(
                  value: 'delete',
                  child: Text('Delete'),
                ),
              ],
            ),
          ],
        ),
        onTap: onEdit, // Tap to edit as well
      ),
    );
  }
}

// --- Final File Structure Notes ---
// The final file 'beneficiary_management_screen.dart' now contains:
// 1. Imports (flutter, riverpod, local_auth, shared_preferences, dart:convert, dart:math)
// 2. Data Model (Beneficiary)
// 3. State Model (BeneficiaryState)
// 4. Service Interface (BeneficiaryService) and Mock Implementation (MockBeneficiaryService)
// 5. Riverpod Provider (BeneficiaryNotifier, provider definitions)
// 6. UI Components (BeneficiaryManagementScreen, BeneficiaryFormScreen, BeneficiaryListItem, helper functions)
// The entire file is a complete, self-contained screen implementation.
