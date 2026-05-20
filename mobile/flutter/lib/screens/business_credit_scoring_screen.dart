import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// Define theme colors
const Color _darkBackground = Color(0xFF0F0F1A);
const Color _cardColor = Color(0xFF1A1A2E);
const Color _accentColor = Color(0xFF6366F1);
const Color _textColor = Color(0xFFE2E8F0);
const Color _mutedColor = Color(0xFF9CA3AF);
const Color _borderColor = Color(0xFF2D2D4E);

// Data models
class CreditScore {
  final String grade;
  final int score;
  final DateTime lastUpdated;

  CreditScore({required this.grade, required this.score, required this.lastUpdated});

  factory CreditScore.fromJson(Map<String, dynamic> json) {
    return CreditScore(
      grade: json['grade'],
      score: json['score'],
      lastUpdated: DateTime.parse(json['lastUpdated']),
    );
  }
}

// Providers
final creditScoreProvider = FutureProvider.autoDispose<CreditScore?>((ref) async {
  try {
    final response = await apiService.trpc.query(
      'businessCreditScoring.getScore',
      // No input needed for getScore
    );
    if (response != null && response['grade'] != null) {
      return CreditScore.fromJson(response);
    } else {
      return null; // No score available
    }
  } catch (e) {
    print('Error fetching credit score: $e');
    throw Exception('Failed to load credit score');
  }
});

class BusinessCreditScoringScreen extends ConsumerStatefulWidget {
  const BusinessCreditScoringScreen({super.key});

  @override
  ConsumerState<BusinessCreditScoringScreen> createState() => _BusinessCreditScoringScreenState();
}

class _BusinessCreditScoringScreenState extends ConsumerState<BusinessCreditScoringScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController companyNameController = TextEditingController();
  final TextEditingController requestedAmountController = TextEditingController();
  final TextEditingController businessTypeController = TextEditingController();
  final TextEditingController yearsInBusinessController = TextEditingController();

  @override
  void dispose() {
    companyNameController.dispose();
    requestedAmountController.dispose();
    businessTypeController.dispose();
    yearsInBusinessController.dispose();
    super.dispose();
  }

  Future<void> _refreshCreditScore() async {
    ref.invalidate(creditScoreProvider);
  }

  Future<void> _requestCreditScore() async {
    try {
      await apiService.trpc.mutation(
        'businessCreditScoring.requestScore',
        // No input needed for requestScore
      );
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Credit score request submitted successfully!')),
      );
      _refreshCreditScore();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to request credit score: $e')),
      );
    }
  }

  Future<void> _showCreditApplicationForm() async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: _darkBackground,
      builder: (BuildContext context) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
            top: 20,
            left: 20,
            right: 20,
          ),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Credit Application',
                  style: TextStyle(color: _textColor, fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 20),
                TextFormField(
                  controller: companyNameController,
                  style: TextStyle(color: _textColor),
                  decoration: InputDecoration(
                    labelText: 'Company Name',
                    labelStyle: TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _borderColor),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _accentColor),
                    ),
                    errorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                    focusedErrorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter company name';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 15),
                TextFormField(
                  controller: businessTypeController,
                  style: TextStyle(color: _textColor),
                  decoration: InputDecoration(
                    labelText: 'Business Type (e.g., Retail, Tech)',
                    labelStyle: TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _borderColor),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _accentColor),
                    ),
                    errorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                    focusedErrorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter business type';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 15),
                TextFormField(
                  controller: yearsInBusinessController,
                  style: TextStyle(color: _textColor),
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: 'Years in Business',
                    labelStyle: TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _borderColor),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _accentColor),
                    ),
                    errorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                    focusedErrorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter years in business';
                    }
                    if (int.tryParse(value) == null) {
                      return 'Please enter a valid number';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 15),
                TextFormField(
                  controller: requestedAmountController,
                  style: TextStyle(color: _textColor),
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: 'Requested Amount',
                    labelStyle: TextStyle(color: _mutedColor),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _borderColor),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: _accentColor),
                    ),
                    errorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                    focusedErrorBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.redAccent),
                    ),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter requested amount';
                    }
                    if (double.tryParse(value) == null) {
                      return 'Please enter a valid amount';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () async {
                      if (_formKey.currentState!.validate()) {
                        try {
                          await apiService.trpc.mutation(
                            'businessCreditScoring.applyForCredit',
                            {
                              'companyName': companyNameController.text,
                              'businessType': businessTypeController.text,
                              'yearsInBusiness': int.parse(yearsInBusinessController.text),
                              'requestedAmount': double.parse(requestedAmountController.text),
                            },
                          );
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Credit application submitted successfully!')), 
                          );
                          Navigator.pop(context);
                        } catch (e) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Failed to submit application: $e')),
                          );
                        }
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _accentColor,
                      foregroundColor: _textColor,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: const Text(
                      'Submit Application',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final creditScoreAsyncValue = ref.watch(creditScoreProvider);

    return Scaffold(
      backgroundColor: _darkBackground,
      appBar: AppBar(
        title: const Text(
          'Business Credit Scoring',
          style: TextStyle(color: _textColor),
        ),
        backgroundColor: _darkBackground,
        iconTheme: const IconThemeData(color: _textColor),
      ),
      body: RefreshIndicator(
        onRefresh: _refreshCreditScore,
        color: _accentColor,
        backgroundColor: _cardColor,
        child: creditScoreAsyncValue.when(
          loading: () => const Center(
            child: CircularProgressIndicator(color: _accentColor),
          ),
          error: (err, stack) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'Error: $err',
                  style: const TextStyle(color: _textColor),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _refreshCreditScore,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _accentColor,
                    foregroundColor: _textColor,
                  ),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
          data: (creditScore) {
            if (creditScore == null) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      '📊',
                      style: TextStyle(fontSize: 64),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No credit score available yet. Request one to get started!',
                      style: TextStyle(color: _mutedColor, fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: _requestCreditScore,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _accentColor,
                        foregroundColor: _textColor,
                        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text(
                        'Request Credit Score',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              );
            } else {
              return ListView(
                padding: const EdgeInsets.all(16.0),
                children: [
                  Card(
                    color: _cardColor,
                    elevation: 4,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    child: Padding(
                      padding: const EdgeInsets.all(20.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Current Credit Score',
                            style: TextStyle(color: _mutedColor, fontSize: 16),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                '${creditScore.score}',
                                style: TextStyle(color: _textColor, fontSize: 48, fontWeight: FontWeight.bold),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                decoration: BoxDecoration(
                                  color: _accentColor.withOpacity(0.2),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  'Grade: ${creditScore.grade}',
                                  style: TextStyle(color: _accentColor, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          Text(
                            'Last Updated: ${creditScore.lastUpdated.toLocal().toString().split(' ')[0]}',
                            style: TextStyle(color: _mutedColor, fontSize: 14),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _requestCreditScore,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _accentColor,
                        foregroundColor: _textColor,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text(
                        'Re-request Credit Score',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                  const SizedBox(height: 15),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: _showCreditApplicationForm,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: _accentColor,
                        side: const BorderSide(color: _accentColor),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text(
                        'Apply for Credit',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ],
              );
            }
          },
        ),
      ),
    );
  }
}
