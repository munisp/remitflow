import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart'; // Assuming this exists for tRPC calls

// Define color palette for dark theme
const Color _darkBackground = Color(0xFF0F0F1A);
const Color _darkCard = Color(0xFF1A1A2E);
const Color _darkAccent = Color(0xFF6366F1);
const Color _darkText = Color(0xFFE2E8F0);
const Color _darkMuted = Color(0xFF9CA3AF);
const Color _darkBorder = Color(0xFF2D2D4E);

// Placeholder for API service and data models
// In a real application, these would be defined in api_service.dart or separate models
class InvoiceFinancing {
  final String id;
  final String invoiceNumber;
  final double amount;
  final DateTime dueDate;
  final String status;
  final double advanceAmount;
  final DateTime applicationDate;

  InvoiceFinancing({
    required this.id,
    required this.invoiceNumber,
    required this.amount,
    required this.dueDate,
    required this.status,
    required this.advanceAmount,
    required this.applicationDate,
  });

  factory InvoiceFinancing.fromJson(Map<String, dynamic> json) {
    return InvoiceFinancing(
      id: json['id'],
      invoiceNumber: json['invoiceNumber'],
      amount: json['amount'].toDouble(),
      dueDate: DateTime.parse(json['dueDate']),
      status: json['status'],
      advanceAmount: json['advanceAmount'].toDouble(),
      applicationDate: DateTime.parse(json['applicationDate']),
    );
  }
}

// Mock API service for demonstration
class ApiService {
  Future<List<InvoiceFinancing>> fetchInvoiceFinancingList() async {
    // Simulate network delay
    await Future.delayed(const Duration(seconds: 2));
    // Simulate tRPC call to invoiceFinancing.list
    return [
      InvoiceFinancing(
        id: '1',
        invoiceNumber: 'INV-2023-001',
        amount: 1500.00,
        dueDate: DateTime.now().add(const Duration(days: 30)),
        status: 'Approved',
        advanceAmount: 1200.00,
        applicationDate: DateTime.now().subtract(const Duration(days: 5)),
      ),
      InvoiceFinancing(
        id: '2',
        invoiceNumber: 'INV-2023-002',
        amount: 2500.00,
        dueDate: DateTime.now().add(const Duration(days: 60)),
        status: 'Pending',
        advanceAmount: 0.00,
        applicationDate: DateTime.now().subtract(const Duration(days: 10)),
      ),
    ];
  }

  Future<void> applyForFinancing(Map<String, dynamic> data) async {
    // Simulate network delay
    await Future.delayed(const Duration(seconds: 1));
    // Simulate tRPC call to invoiceFinancing.applyForFinancing
    print('Applying for financing with data: $data');
    // In a real app, handle success/failure based on API response
  }
}

final apiServiceProvider = Provider((ref) => ApiService());

final invoiceFinancingListProvider = FutureProvider.autoDispose<List<InvoiceFinancing>>((ref) async {
  final apiService = ref.watch(apiServiceProvider);
  return apiService.fetchInvoiceFinancingList();
});

class InvoiceFinancingScreen extends ConsumerStatefulWidget {
  const InvoiceFinancingScreen({super.key});

  @override
  ConsumerState<InvoiceFinancingScreen> createState() => _InvoiceFinancingScreenState();
}

class _InvoiceFinancingScreenState extends ConsumerState<InvoiceFinancingScreen> {
  @override
  Widget build(BuildContext context) {
    final invoiceFinancingListAsync = ref.watch(invoiceFinancingListProvider);

    return Scaffold(
      backgroundColor: _darkBackground,
      appBar: AppBar(
        title: const Text(
          'Invoice Financing',
          style: TextStyle(color: _darkText),
        ),
        backgroundColor: _darkCard,
        iconTheme: const IconThemeData(color: _darkAccent), // Colored icon theme
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(invoiceFinancingListProvider.future),
        color: _darkAccent,
        backgroundColor: _darkCard,
        child: invoiceFinancingListAsync.when(
          data: (invoices) {
            if (invoices.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      '✨',
                      style: TextStyle(fontSize: 50),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No invoice financing applications yet.',
                      style: TextStyle(color: _darkMuted, fontSize: 16),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => _showApplyForFinancingForm(context),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _darkAccent,
                        foregroundColor: _darkText,
                      ),
                      child: const Text('Apply for Financing'),
                    ),
                  ],
                ),
              );
            }
            return ListView.builder(
              itemCount: invoices.length,
              itemBuilder: (context, index) {
                final invoice = invoices[index];
                return Card(
                  color: _darkCard,
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Invoice: ${invoice.invoiceNumber}',
                          style: TextStyle(color: _darkText, fontSize: 18, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Amount: \$${invoice.amount.toStringAsFixed(2)}',
                          style: TextStyle(color: _darkMuted),
                        ),
                        Text(
                          'Due Date: ${invoice.dueDate.toLocal().toIso8601String().split('T')[0]}',
                          style: TextStyle(color: _darkMuted),
                        ),
                        Text(
                          'Status: ${invoice.status}',
                          style: TextStyle(color: invoice.status == 'Approved' ? Colors.green : _darkAccent),
                        ),
                        if (invoice.advanceAmount > 0)
                          Text(
                            'Advance: \$${invoice.advanceAmount.toStringAsFixed(2)}',
                            style: TextStyle(color: _darkMuted),
                          ),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (invoice.status == 'Pending')
                              ElevatedButton(
                                onPressed: () {
                                  // Simulate approve action
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Invoice approved (simulated)')),
                                  );
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.green,
                                  foregroundColor: _darkText,
                                ),
                                child: const Text('Approve'),
                              ),
                            const SizedBox(width: 8),
                            if (invoice.status == 'Pending')
                              OutlinedButton(
                                onPressed: () {
                                  // Simulate reject action
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Invoice rejected (simulated)')),
                                  );
                                },
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.red,
                                  side: const BorderSide(color: Colors.red),
                                ),
                                child: const Text('Reject'),
                              ),
                            if (invoice.status == 'Approved')
                              ElevatedButton(
                                onPressed: () {
                                  // Simulate repayment action
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Repayment initiated (simulated)')),
                                  );
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: _darkAccent,
                                  foregroundColor: _darkText,
                                ),
                                child: const Text('Repay'),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          },
          loading: () => Center(
            child: CircularProgressIndicator(color: _darkAccent),
          ),
          error: (error, stack) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'Error: ${error.toString()}',
                  style: TextStyle(color: Colors.redAccent, fontSize: 16),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => ref.refresh(invoiceFinancingListProvider.future),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _darkAccent,
                    foregroundColor: _darkText,
                  ),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showApplyForFinancingForm(context),
        backgroundColor: _darkAccent,
        foregroundColor: _darkText,
        child: const Icon(Icons.add),
      ),
    );
  }

  void _showApplyForFinancingForm(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: _darkCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
            top: 20,
            left: 20,
            right: 20,
          ),
          child: ApplyForFinancingForm(ref: ref),
        );
      },
    );
  }
}

class ApplyForFinancingForm extends ConsumerStatefulWidget {
  final WidgetRef ref;
  const ApplyForFinancingForm({super.key, required this.ref});

  @override
  ConsumerState<ApplyForFinancingForm> createState() => _ApplyForFinancingFormState();
}

class _ApplyForFinancingFormState extends ConsumerState<ApplyForFinancingForm> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _invoiceNumberController = TextEditingController();
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _dueDateController = TextEditingController();

  @override
  void dispose() {
    _invoiceNumberController.dispose();
    _amountController.dispose();
    _dueDateController.dispose();
    super.dispose();
  }

  Future<void> _selectDate(BuildContext context) async {
    DateTime? picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 5)),
      builder: (context, child) {
        return Theme(
          data: ThemeData.dark().copyWith(
            colorScheme: const ColorScheme.dark(
              primary: _darkAccent, // header background color
              onPrimary: _darkText, // header text color
              surface: _darkCard, // calendar background color
              onSurface: _darkText, // calendar text color
            ),
            dialogBackgroundColor: _darkCard,
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      setState(() {
        _dueDateController.text = picked.toLocal().toIso8601String().split('T')[0];
      });
    }
  }

  void _submitForm() async {
    if (_formKey.currentState!.validate()) {
      final apiService = widget.ref.read(apiServiceProvider);
      try {
        await apiService.applyForFinancing({
          'invoiceNumber': _invoiceNumberController.text,
          'amount': double.parse(_amountController.text),
          'dueDate': _dueDateController.text,
        });
        if (mounted) {
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Financing application submitted successfully!')), 
          );
          widget.ref.invalidate(invoiceFinancingListProvider);
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to submit application: ${e.toString()}')),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Apply for Invoice Financing',
            style: TextStyle(color: _darkText, fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 20),
          TextFormField(
            controller: _invoiceNumberController,
            decoration: InputDecoration(
              labelText: 'Invoice Number',
              labelStyle: const TextStyle(color: _darkMuted),
              enabledBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: _darkBorder),
                borderRadius: BorderRadius.circular(8),
              ),
              focusedBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: _darkAccent),
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            style: const TextStyle(color: _darkText),
            validator: (value) {
              if (value == null || value.isEmpty) {
                return 'Please enter an invoice number';
              }
              return null;
            },
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _amountController,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: 'Amount',
              labelStyle: const TextStyle(color: _darkMuted),
              enabledBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: _darkBorder),
                borderRadius: BorderRadius.circular(8),
              ),
              focusedBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: _darkAccent),
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            style: const TextStyle(color: _darkText),
            validator: (value) {
              if (value == null || value.isEmpty) {
                return 'Please enter an amount';
              }
              if (double.tryParse(value) == null) {
                return 'Please enter a valid number';
              }
              return null;
            },
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _dueDateController,
            readOnly: true,
            onTap: () => _selectDate(context),
            decoration: InputDecoration(
              labelText: 'Due Date',
              labelStyle: const TextStyle(color: _darkMuted),
              enabledBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: _darkBorder),
                borderRadius: BorderRadius.circular(8),
              ),
              focusedBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: _darkAccent),
                borderRadius: BorderRadius.circular(8),
              ),
              suffixIcon: Icon(Icons.calendar_today, color: _darkMuted),
            ),
            style: const TextStyle(color: _darkText),
            validator: (value) {
              if (value == null || value.isEmpty) {
                return 'Please select a due date';
              }
              return null;
            },
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _submitForm,
              style: ElevatedButton.styleFrom(
                backgroundColor: _darkAccent,
                foregroundColor: _darkText,
                padding: const EdgeInsets.symmetric(vertical: 15),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text(
                'Submit Application',
                style: TextStyle(fontSize: 18),
              ),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}
