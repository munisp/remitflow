import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart'; // Assuming api_service.dart handles tRPC calls

// Define the tRPC API provider (example, adjust as per actual api_service.dart)
final diasporaMortgageListProvider = FutureProvider((ref) async {
  // Replace with actual tRPC call
  return ref.read(apiServiceProvider).diasporaMortgage.list();
});

final diasporaMortgageDetailsProvider = FutureProvider.family((ref, String mortgageId) async {
  // Replace with actual tRPC call
  return ref.read(apiServiceProvider).diasporaMortgage.getDetails(mortgageId);
});

class DiasporaMortgageScreen extends ConsumerStatefulWidget {
  const DiasporaMortgageScreen({super.key});

  @override
  ConsumerState<DiasporaMortgageScreen> createState() => _DiasporaMortgageScreenState();
}

class _DiasporaMortgageScreenState extends ConsumerState<DiasporaMortgageScreen> {
  // Dark theme colors
  static const Color _backgroundColor = Color(0xFF0F0F1A);
  static const Color _cardColor = Color(0xFF1A1A2E);
  static const Color _accentColor = Color(0xFF6366F1);
  static const Color _textColor = Color(0xFFE2E8F0);
  static const Color _mutedColor = Color(0xFF9CA3AF);
  static const Color _borderColor = Color(0xFF2D2D4E);

  @override
  Widget build(BuildContext context) {
    final mortgageListAsyncValue = ref.watch(diasporaMortgageListProvider);

    return Scaffold(
      backgroundColor: _backgroundColor,
      appBar: AppBar(
        title: const Text('Diaspora Mortgage', style: TextStyle(color: _textColor)),
        backgroundColor: _backgroundColor,
        iconTheme: const IconThemeData(color: _accentColor), // Colored icon theme
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: _accentColor),
            onPressed: () => _showMortgageApplicationForm(context),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(diasporaMortgageListProvider.future),
        color: _accentColor,
        child: mortgageListAsyncValue.when(
          loading: () => const Center(
            child: CircularProgressIndicator(color: _accentColor),
          ),
          error: (error, stack) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('Error: ${error.toString()}', style: const TextStyle(color: _textColor)),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => ref.invalidate(diasporaMortgageListProvider),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _accentColor,
                    foregroundColor: _textColor,
                  ),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
          data: (mortgages) {
            if (mortgages == null || mortgages.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('🏡', style: TextStyle(fontSize: 48)),
                    const SizedBox(height: 16),
                    Text(
                      'No mortgage applications found. Start a new one!',
                      style: TextStyle(color: _mutedColor, fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              );
            }
            return ListView.builder(
              itemCount: mortgages.length,
              itemBuilder: (context, index) {
                final mortgage = mortgages[index];
                return Card(
                  color: _cardColor,
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  child: ListTile(
                    title: Text(mortgage.loanType, style: const TextStyle(color: _textColor, fontWeight: FontWeight.bold)),
                    subtitle: Text('Amount: ${mortgage.amount} - Status: ${mortgage.status}', style: TextStyle(color: _mutedColor)),
                    trailing: Icon(Icons.arrow_forward_ios, color: _mutedColor),
                    onTap: () => _showMortgageDetails(context, mortgage.id),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }

  void _showMortgageApplicationForm(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: _backgroundColor,
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
          child: MortgageApplicationForm(accentColor: _accentColor, textColor: _textColor, mutedColor: _mutedColor, cardColor: _cardColor, borderColor: _borderColor),
        );
      },
    );
  }

  void _showMortgageDetails(BuildContext context, String mortgageId) {
    showDialog(
      context: context,
      builder: (context) {
        return MortgageDetailsDialog(mortgageId: mortgageId, accentColor: _accentColor, textColor: _textColor, mutedColor: _mutedColor, cardColor: _cardColor, borderColor: _borderColor);
      },
    );
  }
}

// --- Mortgage Application Form Widget ---
class MortgageApplicationForm extends ConsumerStatefulWidget {
  final Color accentColor;
  final Color textColor;
  final Color mutedColor;
  final Color cardColor;
  final Color borderColor;

  const MortgageApplicationForm({
    super.key,
    required this.accentColor,
    required this.textColor,
    required this.mutedColor,
    required this.cardColor,
    required this.borderColor,
  });

  @override
  ConsumerState<MortgageApplicationForm> createState() => _MortgageApplicationFormState();
}

class _MortgageApplicationFormState extends ConsumerState<MortgageApplicationForm> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _loanAmountController = TextEditingController();
  final TextEditingController _propertyValueController = TextEditingController();
  final TextEditingController _incomeController = TextEditingController();
  final TextEditingController _employmentStatusController = TextEditingController();
  final TextEditingController _countryOfResidenceController = TextEditingController();
  final TextEditingController _loanPurposeController = TextEditingController();

  bool _isLoading = false;

  // Simple LTV Calculator
  double _calculateLTV() {
    final loanAmount = double.tryParse(_loanAmountController.text) ?? 0;
    final propertyValue = double.tryParse(_propertyValueController.text) ?? 0;
    if (propertyValue > 0) {
      return (loanAmount / propertyValue) * 100;
    } else {
      return 0;
    }
  }

  Future<void> _submitApplication() async {
    if (_formKey.currentState!.validate()) {
      setState(() {
        _isLoading = true;
      });

      try {
        // Simulate API call
        await Future.delayed(const Duration(seconds: 2));
        // Replace with actual tRPC call
        // await ref.read(apiServiceProvider).diasporaMortgage.apply(
        //   loanAmount: double.parse(_loanAmountController.text),
        //   propertyValue: double.parse(_propertyValueController.text),
        //   income: double.parse(_incomeController.text),
        //   employmentStatus: _employmentStatusController.text,
        //   countryOfResidence: _countryOfResidenceController.text,
        //   loanPurpose: _loanPurposeController.text,
        // );

        if (mounted) {
          Navigator.of(context).pop();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Application submitted successfully!', style: TextStyle(color: widget.textColor)), backgroundColor: widget.accentColor),
          );
          ref.invalidate(diasporaMortgageListProvider); // Refresh the list
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to submit application: ${e.toString()}', style: TextStyle(color: widget.textColor)), backgroundColor: Colors.red),
          );
        }
      } finally {
        if (mounted) {
          setState(() {
            _isLoading = false;
          });
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: widget.cardColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('New Mortgage Application', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: widget.textColor)),
              const SizedBox(height: 20),
              _buildTextField(
                controller: _loanAmountController,
                labelText: 'Loan Amount',
                keyboardType: TextInputType.number,
                validator: (value) => value == null || value.isEmpty ? 'Please enter loan amount' : null,
              ),
              const SizedBox(height: 15),
              _buildTextField(
                controller: _propertyValueController,
                labelText: 'Property Value',
                keyboardType: TextInputType.number,
                validator: (value) => value == null || value.isEmpty ? 'Please enter property value' : null,
                onChanged: (value) => setState(() {}), // Trigger rebuild for LTV
              ),
              const SizedBox(height: 15),
              Text('LTV: ${_calculateLTV().toStringAsFixed(2)}%', style: TextStyle(color: widget.mutedColor)),
              const SizedBox(height: 15),
              _buildTextField(
                controller: _incomeController,
                labelText: 'Annual Income',
                keyboardType: TextInputType.number,
                validator: (value) => value == null || value.isEmpty ? 'Please enter annual income' : null,
              ),
              const SizedBox(height: 15),
              _buildTextField(
                controller: _employmentStatusController,
                labelText: 'Employment Status',
                validator: (value) => value == null || value.isEmpty ? 'Please enter employment status' : null,
              ),
              const SizedBox(height: 15),
              _buildTextField(
                controller: _countryOfResidenceController,
                labelText: 'Country of Residence',
                validator: (value) => value == null || value.isEmpty ? 'Please enter country of residence' : null,
              ),
              const SizedBox(height: 15),
              _buildTextField(
                controller: _loanPurposeController,
                labelText: 'Loan Purpose',
                validator: (value) => value == null || value.isEmpty ? 'Please enter loan purpose' : null,
              ),
              const SizedBox(height: 20),
              _isLoading
                  ? Center(child: CircularProgressIndicator(color: widget.accentColor))
                  : SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _submitApplication,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: widget.accentColor,
                          foregroundColor: widget.textColor,
                          padding: const EdgeInsets.symmetric(vertical: 15),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        child: const Text('Submit Application', style: TextStyle(fontSize: 18)),
                      ),
                    ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String labelText,
    TextInputType keyboardType = TextInputType.text,
    String? Function(String?)? validator,
    void Function(String)? onChanged,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      style: TextStyle(color: widget.textColor),
      decoration: InputDecoration(
        labelText: labelText,
        labelStyle: TextStyle(color: widget.mutedColor),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: widget.borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: widget.accentColor, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Colors.red, width: 2),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Colors.red, width: 2),
        ),
        fillColor: widget.cardColor,
        filled: true,
      ),
      validator: validator,
      onChanged: onChanged,
    );
  }

  @override
  void dispose() {
    _loanAmountController.dispose();
    _propertyValueController.dispose();
    _incomeController.dispose();
    _employmentStatusController.dispose();
    _countryOfResidenceController.dispose();
    _loanPurposeController.dispose();
    super.dispose();
  }
}

// --- Mortgage Details Dialog Widget ---
class MortgageDetailsDialog extends ConsumerWidget {
  final String mortgageId;
  final Color accentColor;
  final Color textColor;
  final Color mutedColor;
  final Color cardColor;
  final Color borderColor;

  const MortgageDetailsDialog({
    super.key,
    required this.mortgageId,
    required this.accentColor,
    required this.textColor,
    required this.mutedColor,
    required this.cardColor,
    required this.borderColor,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mortgageDetailsAsyncValue = ref.watch(diasporaMortgageDetailsProvider(mortgageId));

    return Dialog(
      backgroundColor: cardColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: mortgageDetailsAsyncValue.when(
          loading: () => SizedBox(
            height: 200,
            child: Center(child: CircularProgressIndicator(color: accentColor)),
          ),
          error: (error, stack) => SizedBox(
            height: 200,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Error loading details: ${error.toString()}', style: TextStyle(color: textColor)),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => ref.invalidate(diasporaMortgageDetailsProvider(mortgageId)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: accentColor,
                      foregroundColor: textColor,
                    ),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
          data: (details) {
            if (details == null) {
              return SizedBox(
                height: 200,
                child: Center(
                  child: Text('No details found for this mortgage.', style: TextStyle(color: mutedColor)),
                ),
              );
            }
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Mortgage Details', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: textColor)),
                const SizedBox(height: 20),
                _buildDetailRow('Loan Type:', details.loanType, textColor, mutedColor),
                _buildDetailRow('Amount:', details.amount.toString(), textColor, mutedColor),
                _buildDetailRow('Status:', details.status, textColor, mutedColor),
                _buildDetailRow('LTV:', '${details.ltv.toStringAsFixed(2)}%', textColor, mutedColor),
                _buildDetailRow('Applicant Income:', details.income.toString(), textColor, mutedColor),
                _buildDetailRow('Employment:', details.employmentStatus, textColor, mutedColor),
                _buildDetailRow('Country:', details.countryOfResidence, textColor, mutedColor),
                _buildDetailRow('Purpose:', details.loanPurpose, textColor, mutedColor),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    ElevatedButton(
                      onPressed: () {
                        // Implement reject logic
                        Navigator.of(context).pop();
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Mortgage ${details.id} Rejected', style: TextStyle(color: textColor)), backgroundColor: Colors.redAccent),
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.redAccent,
                        foregroundColor: textColor,
                      ),
                      child: const Text('Reject'),
                    ),
                    ElevatedButton(
                      onPressed: () {
                        // Implement approve logic
                        Navigator.of(context).pop();
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Mortgage ${details.id} Approved', style: TextStyle(color: textColor)), backgroundColor: Colors.green),
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: textColor,
                      ),
                      child: const Text('Approve'),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, Color textColor, Color mutedColor) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label, style: TextStyle(color: mutedColor, fontWeight: FontWeight.bold)),
          ),
          Expanded(
            child: Text(value, style: TextStyle(color: textColor)),
          ),
        ],
      ),
    );
  }
}

// --- Mock Data Models (Replace with actual tRPC generated models) ---
class Mortgage {
  final String id;
  final String loanType;
  final double amount;
  final String status;
  final double ltv;
  final double income;
  final String employmentStatus;
  final String countryOfResidence;
  final String loanPurpose;

  Mortgage({
    required this.id,
    required this.loanType,
    required this.amount,
    required this.status,
    required this.ltv,
    required this.income,
    required this.employmentStatus,
    required this.countryOfResidence,
    required this.loanPurpose,
  });

  // Factory constructor for demonstration purposes
  factory Mortgage.fromJson(Map<String, dynamic> json) {
    return Mortgage(
      id: json['id'] as String,
      loanType: json['loanType'] as String,
      amount: (json['amount'] as num).toDouble(),
      status: json['status'] as String,
      ltv: (json['ltv'] as num).toDouble(),
      income: (json['income'] as num).toDouble(),
      employmentStatus: json['employmentStatus'] as String,
      countryOfResidence: json['countryOfResidence'] as String,
      loanPurpose: json['loanPurpose'] as String,
    );
  }
}

// --- Mock API Service (Replace with actual tRPC API integration) ---
class ApiService {
  final DiasporaMortgageService diasporaMortgage = DiasporaMortgageService();
}

class DiasporaMortgageService {
  Future<List<Mortgage>> list() async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate network delay
    return [
      Mortgage(id: '1', loanType: 'Home Purchase', amount: 250000, status: 'Pending', ltv: 80, income: 75000, employmentStatus: 'Employed', countryOfResidence: 'USA', loanPurpose: 'Primary Residence'),
      Mortgage(id: '2', loanType: 'Refinance', amount: 180000, status: 'Approved', ltv: 70, income: 90000, employmentStatus: 'Employed', countryOfResidence: 'Canada', loanPurpose: 'Lower Interest Rate'),
      Mortgage(id: '3', loanType: 'Investment Property', amount: 300000, status: 'Rejected', ltv: 90, income: 120000, employmentStatus: 'Self-Employed', countryOfResidence: 'UK', loanPurpose: 'Rental Income'),
    ];
  }

  Future<Mortgage> getDetails(String id) async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate network delay
    final mortgages = await list();
    return mortgages.firstWhere((mortgage) => mortgage.id == id);
  }

  Future<void> apply({
    required double loanAmount,
    required double propertyValue,
    required double income,
    required String employmentStatus,
    required String countryOfResidence,
    required String loanPurpose,
  }) async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate network delay
    // In a real scenario, this would call the tRPC endpoint to create a new application
    print('Applying for mortgage: Loan Amount: $loanAmount, Property Value: $propertyValue');
  }
}

final apiServiceProvider = Provider((ref) => ApiService());
