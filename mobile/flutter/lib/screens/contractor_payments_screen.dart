import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// Theme Colors
const Color _backgroundColor = Color(0xFF0F0F1A);
const Color _cardColor = Color(0xFF1A1A2E);
const Color _accentColor = Color(0xFF6366F1);
const Color _textColor = Color(0xFFE2E8F0);
const Color _mutedColor = Color(0xFF9CA3AF);
const Color _borderColor = Color(0xFF2D2D4E);

// Data Models
class Invoice {
  final String id;
  final String contractorName;
  final double amount;
  final DateTime submissionDate;
  final String status;
  final String invoiceNumber;

  Invoice({
    required this.id,
    required this.contractorName,
    required this.amount,
    required this.submissionDate,
    required this.status,
    required this.invoiceNumber,
  });

  factory Invoice.fromJson(Map<String, dynamic> json) {
    return Invoice(
      id: json['id'],
      contractorName: json['contractorName'],
      amount: (json['amount'] as num).toDouble(),
      submissionDate: DateTime.parse(json['submissionDate']),
      status: json['status'],
      invoiceNumber: json['invoiceNumber'],
    );
  }
}

class ContractorPayment {
  final String id;
  final String contractorName;
  final String bankDetails;
  final String taxInfo;
  final List<Invoice> invoices;

  ContractorPayment({
    required this.id,
    required this.contractorName,
    required this.bankDetails,
    required this.taxInfo,
    required this.invoices,
  });

  factory ContractorPayment.fromJson(Map<String, dynamic> json) {
    var invoicesList = json['invoices'] as List;
    List<Invoice> invoices = invoicesList.map((i) => Invoice.fromJson(i)).toList();

    return ContractorPayment(
      id: json['id'],
      contractorName: json['contractorName'],
      bankDetails: json['bankDetails'],
      taxInfo: json['taxInfo'],
      invoices: invoices,
    );
  }
}

// API Service Provider (Placeholder)
final contractorPaymentsApiProvider = Provider((ref) => ContractorPaymentsApiService());

class ContractorPaymentsApiService {
  // Simulate API calls
  Future<List<Invoice>> listInvoices() async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      Invoice(id: '1', contractorName: 'ABC Corp', amount: 1500.00, submissionDate: DateTime(2026, 4, 1), status: 'Pending', invoiceNumber: 'INV-001'),
      Invoice(id: '2', contractorName: 'XYZ Ltd', amount: 2500.00, submissionDate: DateTime(2026, 3, 15), status: 'Approved', invoiceNumber: 'INV-002'),
      Invoice(id: '3', contractorName: '123 Inc', amount: 500.00, submissionDate: DateTime(2026, 2, 20), status: 'Rejected', invoiceNumber: 'INV-003'),
    ];
  }

  Future<Invoice> submitInvoice(Invoice invoice) async {
    await Future.delayed(const Duration(seconds: 1));
    // In a real app, this would send to tRPC and return the created invoice
    return invoice;
  }

  Future<void> approveInvoice(String invoiceId) async {
    await Future.delayed(const Duration(seconds: 0));
    print('Invoice $invoiceId approved');
  }

  Future<void> rejectInvoice(String invoiceId) async {
    await Future.delayed(const Duration(seconds: 0));
    print('Invoice $invoiceId rejected');
  }
}

// State Notifier for Invoices
class InvoicesNotifier extends StateNotifier<AsyncValue<List<Invoice>>> {
  final ContractorPaymentsApiService apiService;

  InvoicesNotifier(this.apiService) : super(const AsyncValue.loading()) {
    _fetchInvoices();
  }

  Future<void> _fetchInvoices() async {
    try {
      state = const AsyncValue.loading();
      final invoices = await apiService.listInvoices();
      state = AsyncValue.data(invoices);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> addInvoice(Invoice invoice) async {
    try {
      state = const AsyncValue.loading();
      final newInvoice = await apiService.submitInvoice(invoice);
      final currentInvoices = state.value ?? [];
      state = AsyncValue.data([...currentInvoices, newInvoice]);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> refreshInvoices() async {
    await _fetchInvoices();
  }
}

final invoicesProvider = StateNotifierProvider<InvoicesNotifier, AsyncValue<List<Invoice>>>((ref) {
  final apiService = ref.watch(contractorPaymentsApiProvider);
  return InvoicesNotifier(apiService);
});

class ContractorPaymentsScreen extends ConsumerStatefulWidget {
  const ContractorPaymentsScreen({super.key});

  @override
  ConsumerState<ContractorPaymentsScreen> createState() => _ContractorPaymentsScreenState();
}

class _ContractorPaymentsScreenState extends ConsumerState<ContractorPaymentsScreen> {
  @override
  Widget build(BuildContext context) {
    final invoicesAsyncValue = ref.watch(invoicesProvider);

    return Scaffold(
      backgroundColor: _backgroundColor,
      appBar: AppBar(
        title: const Text('Contractor Payments', style: TextStyle(color: _textColor)),
        backgroundColor: _backgroundColor,
        iconTheme: const IconThemeData(color: _textColor), // Dark theme icon color
      ),
      body: invoicesAsyncValue.when(
        data: (invoices) {
          if (invoices.isEmpty) {
            return _buildEmptyState();
          }
          return RefreshIndicator(
            onRefresh: () => ref.read(invoicesProvider.notifier).refreshInvoices(),
            child: ListView.builder(
              itemCount: invoices.length,
              itemBuilder: (context, index) {
                final invoice = invoices[index];
                return Card(
                  color: _cardColor,
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: _borderColor)),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Invoice #${invoice.invoiceNumber}', style: const TextStyle(color: _textColor, fontSize: 18, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Text('Contractor: ${invoice.contractorName}', style: const TextStyle(color: _mutedColor)),
                        Text('Amount: \$${invoice.amount.toStringAsFixed(2)}', style: const TextStyle(color: _textColor)),
                        Text('Status: ${invoice.status}', style: TextStyle(color: _getStatusColor(invoice.status))),
                        Text('Submission Date: ${invoice.submissionDate.toLocal().toIso8601String().split('T')[0]}', style: const TextStyle(color: _mutedColor)),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (invoice.status == 'Pending') ...[
                              ElevatedButton(
                                onPressed: () async {
                                  await ref.read(contractorPaymentsApiProvider).approveInvoice(invoice.id);
                                  ref.read(invoicesProvider.notifier).refreshInvoices();
                                },
                                style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
                                child: const Text('Approve', style: TextStyle(color: _textColor)),
                              ),
                              const SizedBox(width: 8),
                              OutlinedButton(
                                onPressed: () async {
                                  await ref.read(contractorPaymentsApiProvider).rejectInvoice(invoice.id);
                                  ref.read(invoicesProvider.notifier).refreshInvoices();
                                },
                                style: OutlinedButton.styleFrom(side: const BorderSide(color: _mutedColor)),
                                child: const Text('Reject', style: TextStyle(color: _mutedColor)),
                              ),
                            ]
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
        loading: () => _buildLoadingState(),
        error: (error, stack) => _buildErrorState(error.toString()),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showSubmitInvoiceDialog(context),
        backgroundColor: _accentColor,
        child: const Icon(Icons.add, color: _textColor),
      ),
    );
  }

  Widget _buildLoadingState() {
    return const Center(
      child: CircularProgressIndicator(color: _accentColor),
    );
  }

  Widget _buildErrorState(String errorMessage) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Error: $errorMessage', style: const TextStyle(color: Colors.redAccent)),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () => ref.read(invoicesProvider.notifier).refreshInvoices(),
            style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
            child: const Text('Retry', style: TextStyle(color: _textColor)),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('✨', style: TextStyle(fontSize: 48)),
          const SizedBox(height: 16),
          const Text('No invoices found. Time to submit one!', style: TextStyle(color: _mutedColor, fontSize: 18)),
        ],
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'Pending':
        return Colors.orangeAccent;
      case 'Approved':
        return Colors.greenAccent;
      case 'Rejected':
        return Colors.redAccent;
      default:
        return _mutedColor;
    }
  }

  void _showSubmitInvoiceDialog(BuildContext context) {
    final TextEditingController contractorNameController = TextEditingController();
    final TextEditingController amountController = TextEditingController();
    final TextEditingController invoiceNumberController = TextEditingController();

    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: _cardColor,
          title: const Text('Submit New Invoice', style: TextStyle(color: _textColor)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: contractorNameController,
                  decoration: InputDecoration(
                    labelText: 'Contractor Name',
                    labelStyle: const TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(borderSide: const BorderSide(color: _borderColor)),
                    focusedBorder: OutlineInputBorder(borderSide: const BorderSide(color: _accentColor)),
                  ),
                  style: const TextStyle(color: _textColor),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: amountController,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: 'Amount',
                    labelStyle: const TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(borderSide: const BorderSide(color: _borderColor)),
                    focusedBorder: OutlineInputBorder(borderSide: const BorderSide(color: _accentColor)),
                  ),
                  style: const TextStyle(color: _textColor),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: invoiceNumberController,
                  decoration: InputDecoration(
                    labelText: 'Invoice Number',
                    labelStyle: const TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(borderSide: const BorderSide(color: _borderColor)),
                    focusedBorder: OutlineInputBorder(borderSide: const BorderSide(color: _accentColor)),
                  ),
                  style: const TextStyle(color: _textColor),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel', style: TextStyle(color: _mutedColor)),
            ),
            ElevatedButton(
              onPressed: () async {
                final newInvoice = Invoice(
                  id: DateTime.now().millisecondsSinceEpoch.toString(), // Unique ID
                  contractorName: contractorNameController.text,
                  amount: double.tryParse(amountController.text) ?? 0.0,
                  submissionDate: DateTime.now(),
                  status: 'Pending',
                  invoiceNumber: invoiceNumberController.text,
                );
                await ref.read(invoicesProvider.notifier).addInvoice(newInvoice);
                Navigator.of(context).pop();
              },
              style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
              child: const Text('Submit', style: TextStyle(color: _textColor)),
            ),
          ],
        );
      },
    );
  }
}