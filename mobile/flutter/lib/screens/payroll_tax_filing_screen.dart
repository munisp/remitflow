import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart'; // Assuming api_service.dart exists

// Define theme colors
class AppColors {
  static const Color background = Color(0xFF0F0F1A);
  static const Color card = Color(0xFF1A1A2E);
  static const Color accent = Color(0xFF6366F1);
  static const Color text = Color(0xFFE2E8F0);
  static const Color muted = Color(0xFF9CA3AF);
  static const Color border = Color(0xFF2D2D4E);
}

// Data Model for Payroll Tax Filing
class PayrollTaxFiling {
  final String id;
  final String taxPeriod;
  final double grossPay;
  final double taxAmount;
  final String status;
  final DateTime filingDate;
  final String taxAuthority;

  PayrollTaxFiling({
    required this.id,
    required this.taxPeriod,
    required this.grossPay,
    required this.taxAmount,
    required this.status,
    required this.filingDate,
    required this.taxAuthority,
  });

  factory PayrollTaxFiling.fromJson(Map<String, dynamic> json) {
    return PayrollTaxFiling(
      id: json['id'],
      taxPeriod: json['taxPeriod'],
      grossPay: json['grossPay'].toDouble(),
      taxAmount: json['taxAmount'].toDouble(),
      status: json['status'],
      filingDate: DateTime.parse(json['filingDate']),
      taxAuthority: json['taxAuthority'],
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'taxPeriod': taxPeriod,
        'grossPay': grossPay,
        'taxAmount': taxAmount,
        'status': status,
        'filingDate': filingDate.toIso8601String(),
        'taxAuthority': taxAuthority,
      };

  PayrollTaxFiling copyWith({
    String? id,
    String? taxPeriod,
    double? grossPay,
    double? taxAmount,
    String? status,
    DateTime? filingDate,
    String? taxAuthority,
  }) {
    return PayrollTaxFiling(
      id: id ?? this.id,
      taxPeriod: taxPeriod ?? this.taxPeriod,
      grossPay: grossPay ?? this.grossPay,
      taxAmount: taxAmount ?? this.taxAmount,
      status: status ?? this.status,
      filingDate: filingDate ?? this.filingDate,
      taxAuthority: taxAuthority ?? this.taxAuthority,
    );
  }
}

// State for payroll tax filing
class PayrollTaxFilingState {
  final bool isLoading;
  final String? errorMessage;
  final List<PayrollTaxFiling> filings;
  final bool isEmpty;

  PayrollTaxFilingState({
    this.isLoading = false,
    this.errorMessage,
    this.filings = const [],
    this.isEmpty = false,
  });

  PayrollTaxFilingState copyWith({
    bool? isLoading,
    String? errorMessage,
    List<PayrollTaxFiling>? filings,
    bool? isEmpty,
  }) {
    return PayrollTaxFilingState(
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage ?? this.errorMessage,
      filings: filings ?? this.filings,
      isEmpty: isEmpty ?? this.isEmpty,
    );
  }
}

// Notifier for payroll tax filing
class PayrollTaxFilingNotifier extends StateNotifier<PayrollTaxFilingState> {
  PayrollTaxFilingNotifier() : super(PayrollTaxFilingState()) {
    fetchFilings();
  }

  final ApiService _apiService = ApiService(); // Assuming ApiService is instantiated here

  Future<void> fetchFilings() async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      // Mocking API call for payrollTaxFiling.list
      // In a real app, this would call _apiService.trpc.query('payrollTaxFiling.list')
      await Future.delayed(const Duration(seconds: 1)); // Simulate network delay
      final List<PayrollTaxFiling> fetchedFilings = [
        PayrollTaxFiling(
          id: '1',
          taxPeriod: 'Q1 2026',
          grossPay: 15000.00,
          taxAmount: 1500.00,
          status: 'Filed',
          filingDate: DateTime(2026, 4, 15),
          taxAuthority: 'FIRS',
        ),
        PayrollTaxFiling(
          id: '2',
          taxPeriod: 'Q4 2025',
          grossPay: 12000.00,
          taxAmount: 1200.00,
          status: 'Approved',
          filingDate: DateTime(2026, 1, 15),
          taxAuthority: 'HMRC',
        ),
      ];
      state = state.copyWith(
        isLoading: false,
        filings: fetchedFilings,
        isEmpty: fetchedFilings.isEmpty,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
    }
  }

  Future<void> calculateTax({
    required double grossPay,
    required String taxAuthority,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      // Mocking API call for payrollTaxFiling.calculate
      await Future.delayed(const Duration(seconds: 1));
      // In a real app, this would call _apiService.trpc.query('payrollTaxFiling.calculate', {grossPay, taxAuthority})
      final double calculatedTax = grossPay * 0.1; // Simple mock calculation
      state = state.copyWith(isLoading: false);
      // In a real app, you might want to return the calculated tax or update a specific state field
      // For now, we'll just indicate success by ending loading state.
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
    }
  }

  Future<void> submitFiling({
    required PayrollTaxFiling filing,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      // Mocking API call for payrollTaxFiling.submit
      await Future.delayed(const Duration(seconds: 1));
      // In a real app, this would call _apiService.trpc.mutation('payrollTaxFiling.submit', filing.toJson())
      final updatedFilings = List<PayrollTaxFiling>.from(state.filings);
      updatedFilings.add(filing.copyWith(status: 'Pending')); // Add with pending status
      state = state.copyWith(isLoading: false, filings: updatedFilings, isEmpty: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
    }
  }

  // Example for approving/rejecting (business logic actions)
  Future<void> updateFilingStatus(String id, String newStatus) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      await Future.delayed(const Duration(seconds: 1));
      final updatedFilings = state.filings.map((filing) {
        if (filing.id == id) {
          return PayrollTaxFiling(
            id: filing.id,
            taxPeriod: filing.taxPeriod,
            grossPay: filing.grossPay,
            taxAmount: filing.taxAmount,
            status: newStatus,
            filingDate: filing.filingDate,
            taxAuthority: filing.taxAuthority,
          );
        }
        return filing;
      }).toList();
      state = state.copyWith(isLoading: false, filings: updatedFilings);
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
    }
  }
}

// Provider for payroll tax filing data
final payrollTaxFilingProvider = StateNotifierProvider<PayrollTaxFilingNotifier, PayrollTaxFilingState>((ref) {
  return PayrollTaxFilingNotifier();
});

class PayrollTaxFilingScreen extends ConsumerStatefulWidget {
  const PayrollTaxFilingScreen({super.key});

  @override
  ConsumerState<PayrollTaxFilingScreen> createState() => _PayrollTaxFilingScreenState();
}

class _PayrollTaxFilingScreenState extends ConsumerState<PayrollTaxFilingScreen> {
  @override
  Widget build(BuildContext context) {
    final payrollTaxFilingState = ref.watch(payrollTaxFilingProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text(
          'Payroll Tax Filing',
          style: TextStyle(color: AppColors.text),
        ),
        backgroundColor: AppColors.card,
        iconTheme: const IconThemeData(color: AppColors.text), // Colored icon theme
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(payrollTaxFilingProvider.notifier).fetchFilings(),
        child: Builder(
          builder: (context) {
            if (payrollTaxFilingState.isLoading) {
              return const Center(
                child: CircularProgressIndicator(color: AppColors.accent),
              );
            } else if (payrollTaxFilingState.errorMessage != null) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Error: ${payrollTaxFilingState.errorMessage}',
                      style: const TextStyle(color: AppColors.text),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => ref.read(payrollTaxFilingProvider.notifier).fetchFilings(),
                      style: ElevatedButton.styleFrom(backgroundColor: AppColors.accent),
                      child: const Text('Retry', style: TextStyle(color: AppColors.text)),
                    ),
                  ],
                ),
              );
            } else if (payrollTaxFilingState.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      '📝',
                      style: TextStyle(fontSize: 48),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'No payroll tax filings found.',
                      style: TextStyle(color: AppColors.text, fontSize: 18),
                    ),
                  ],
                ),
              );
            } else {
              return ListView.builder(
                itemCount: payrollTaxFilingState.filings.length,
                itemBuilder: (context, index) {
                  final filing = payrollTaxFilingState.filings[index];
                  return Card(
                    color: AppColors.card,
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Tax Period: ${filing.taxPeriod}',
                            style: const TextStyle(color: AppColors.text, fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Gross Pay: ${filing.grossPay.toStringAsFixed(2)}',
                            style: const TextStyle(color: AppColors.text),
                          ),
                          Text(
                            'Tax Amount: ${filing.taxAmount.toStringAsFixed(2)}',
                            style: const TextStyle(color: AppColors.text),
                          ),
                          Text(
                            'Status: ${filing.status}',
                            style: TextStyle(color: filing.status == 'Filed' ? Colors.green : AppColors.muted),
                          ),
                          Text(
                            'Filing Date: ${filing.filingDate.toLocal().toString().split(' ')[0]}',
                            style: const TextStyle(color: AppColors.text),
                          ),
                          Text(
                            'Authority: ${filing.taxAuthority}',
                            style: const TextStyle(color: AppColors.text),
                          ),
                          if (filing.status == 'Pending') ...[
                            const SizedBox(height: 16),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                ElevatedButton(
                                  onPressed: () => ref.read(payrollTaxFilingProvider.notifier).updateFilingStatus(filing.id, 'Approved'),
                                  style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                                  child: const Text('Approve', style: TextStyle(color: AppColors.text)),
                                ),
                                const SizedBox(width: 8),
                                ElevatedButton(
                                  onPressed: () => ref.read(payrollTaxFilingProvider.notifier).updateFilingStatus(filing.id, 'Rejected'),
                                  style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                                  child: const Text('Reject', style: TextStyle(color: AppColors.text)),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              );
            }
          },
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          _showCreateFilingDialog(context, ref);
        },
        backgroundColor: AppColors.accent,
        child: const Icon(Icons.add, color: AppColors.text),
      ),
    );
  }

  void _showCreateFilingDialog(BuildContext context, WidgetRef ref) {
    final TextEditingController taxPeriodController = TextEditingController();
    final TextEditingController grossPayController = TextEditingController();
    String? selectedTaxAuthority = 'FIRS'; // Default value

    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: AppColors.card,
          title: const Text('Create New Tax Filing', style: TextStyle(color: AppColors.text)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: taxPeriodController,
                  decoration: InputDecoration(
                    labelText: 'Tax Period (e.g., Q1 2026)',
                    labelStyle: const TextStyle(color: AppColors.muted),
                    enabledBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: AppColors.accent),
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  style: const TextStyle(color: AppColors.text),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: grossPayController,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: 'Gross Pay',
                    labelStyle: const TextStyle(color: AppColors.muted),
                    enabledBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: AppColors.accent),
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  style: const TextStyle(color: AppColors.text),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: selectedTaxAuthority,
                  dropdownColor: AppColors.card,
                  style: const TextStyle(color: AppColors.text),
                  decoration: InputDecoration(
                    labelText: 'Tax Authority',
                    labelStyle: const TextStyle(color: AppColors.muted),
                    enabledBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: AppColors.border),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: AppColors.accent),
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  items: <String>['FIRS', 'HMRC', 'KRA']
                      .map<DropdownMenuItem<String>>((String value) {
                    return DropdownMenuItem<String>(
                      value: value,
                      child: Text(value),
                    );
                  }).toList(),
                  onChanged: (String? newValue) {
                    selectedTaxAuthority = newValue;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(context).pop();
              },
              child: const Text('Cancel', style: TextStyle(color: AppColors.muted)),
            ),
            ElevatedButton(
              onPressed: () async {
                if (taxPeriodController.text.isNotEmpty &&
                    grossPayController.text.isNotEmpty &&
                    selectedTaxAuthority != null) {
                  final newFiling = PayrollTaxFiling(
                    id: DateTime.now().millisecondsSinceEpoch.toString(), // Unique ID
                    taxPeriod: taxPeriodController.text,
                    grossPay: double.parse(grossPayController.text),
                    taxAmount: 0.0, // Will be calculated or updated by backend
                    status: 'Pending',
                    filingDate: DateTime.now(),
                    taxAuthority: selectedTaxAuthority!,
                  );
                  await ref.read(payrollTaxFilingProvider.notifier).submitFiling(filing: newFiling);
                  Navigator.of(context).pop();
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.accent),
              child: const Text('Submit', style: TextStyle(color: AppColors.text)),
            ),
          ],
        );
      },
    );
  }
}