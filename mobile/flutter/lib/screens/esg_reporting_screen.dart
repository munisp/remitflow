import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart'; // Assuming this file exists and contains ApiService

// Define theme colors
const Color _darkBackground = Color(0xFF0F0F1A);
const Color _cardColor = Color(0xFF1A1A2E);
const Color _accentColor = Color(0xFF6366F1);
const Color _textColor = Color(0xFFE2E8F0);
const Color _mutedColor = Color(0xFF9CA3AF);
const Color _borderColor = Color(0xFF2D2D4E);

// Data Models
class EsgReport {
  final String id;
  final String name;
  final double carbonFootprint;
  final String sdgAlignment;
  final String status;

  EsgReport({
    required this.id,
    required this.name,
    required this.carbonFootprint,
    required this.sdgAlignment,
    this.status = 'Pending',
  });

  factory EsgReport.fromJson(Map<String, dynamic> json) {
    return EsgReport(
      id: json['id'],
      name: json['name'],
      carbonFootprint: json['carbonFootprint'].toDouble(),
      sdgAlignment: json['sdgAlignment'],
      status: json['status'] ?? 'Pending',
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'carbonFootprint': carbonFootprint,
        'sdgAlignment': sdgAlignment,
        'status': status,
      };

  EsgReport copyWith({
    String? id,
    String? name,
    double? carbonFootprint,
    String? sdgAlignment,
    String? status,
  }) {
    return EsgReport(
      id: id ?? this.id,
      name: name ?? this.name,
      carbonFootprint: carbonFootprint ?? this.carbonFootprint,
      sdgAlignment: sdgAlignment ?? this.sdgAlignment,
      status: status ?? this.status,
    );
  }
}

// ApiService (simplified for demonstration, assuming actual implementation in api_service.dart)
// In a real app, this would interact with the tRPC client.
class ApiService {
  Future<List<EsgReport>> fetchEsgReports() async {
    // Simulate tRPC call: esgReporting.list
    await Future.delayed(const Duration(seconds: 1));
    return [
      EsgReport(id: '1', name: 'Q1 2024 Report', carbonFootprint: 120.5, sdgAlignment: 'SDG 13', status: 'Approved'),
      EsgReport(id: '2', name: 'Annual 2023 Report', carbonFootprint: 500.0, sdgAlignment: 'SDG 3', status: 'Pending'),
      EsgReport(id: '3', name: 'Q2 2024 Report', carbonFootprint: 80.2, sdgAlignment: 'SDG 7', status: 'Rejected'),
    ];
  }

  Future<EsgReport> createEsgReport(EsgReport report) async {
    // Simulate tRPC call: esgReporting.generate
    await Future.delayed(const Duration(seconds: 1));
    return report.copyWith(id: 'new_${DateTime.now().millisecondsSinceEpoch}');
  }

  Future<EsgReport> updateEsgReport(EsgReport report) async {
    // Simulate tRPC call: esgReporting.generate (for update, or a specific update endpoint)
    await Future.delayed(const Duration(seconds: 1));
    return report;
  }

  Future<void> deleteEsgReport(String id) async {
    // Simulate tRPC call (assuming a delete endpoint exists)
    await Future.delayed(const Duration(seconds: 1));
  }

  Future<EsgReport> getEsgReportDetails(String id) async {
    // Simulate tRPC call: esgReporting.getDetails
    await Future.delayed(const Duration(seconds: 1));
    return EsgReport(id: id, name: 'Detailed Report $id', carbonFootprint: 150.0, sdgAlignment: 'SDG 13', status: 'Approved');
  }

  Future<void> approveEsgReport(String id) async {
    // Simulate tRPC call for approval
    await Future.delayed(const Duration(seconds: 1));
  }

  Future<void> rejectEsgReport(String id) async {
    // Simulate tRPC call for rejection
    await Future.delayed(const Duration(seconds: 1));
  }
}

// Riverpod Providers
final apiServiceProvider = Provider((ref) => ApiService());

final esgReportsProvider = FutureProvider.autoDispose<List<EsgReport>>((ref) async {
  final apiService = ref.watch(apiServiceProvider);
  return apiService.fetchEsgReports();
});

class EsgReportingScreen extends ConsumerStatefulWidget {
  const EsgReportingScreen({super.key});

  @override
  ConsumerState<EsgReportingScreen> createState() => _EsgReportingScreenState();
}

class _EsgReportingScreenState extends ConsumerState<EsgReportingScreen> {
  final _formKey = GlobalKey<FormState>();
  String _reportName = '';
  String _carbonFootprint = '';
  String _sdgAlignment = 'SDG 1';

  @override
  Widget build(BuildContext context) {
    final esgReportsAsyncValue = ref.watch(esgReportsProvider);

    return Scaffold(
      backgroundColor: _darkBackground,
      appBar: AppBar(
        title: const Text('ESG Reporting', style: TextStyle(color: _textColor)),
        backgroundColor: _darkBackground,
        iconTheme: const IconThemeData(color: _textColor),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(esgReportsProvider.future),
        child: esgReportsAsyncValue.when(
          loading: () => _buildLoadingState(),
          error: (err, stack) => _buildErrorState(err.toString()),
          data: (reports) {
            if (reports.isEmpty) {
              return _buildEmptyState();
            } else {
              return _buildReportList(reports);
            }
          },
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateEditBottomSheet(context),
        backgroundColor: _accentColor,
        child: const Icon(Icons.add, color: _textColor),
      ),
    );
  }

  Widget _buildLoadingState() {
    return const Center(child: CircularProgressIndicator(color: _accentColor));
  }

  Widget _buildErrorState(String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Error: $message', style: const TextStyle(color: _textColor)),
          const SizedBox(height: 10),
          ElevatedButton(
            onPressed: () => ref.refresh(esgReportsProvider.future),
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
          const Text('📊', style: TextStyle(fontSize: 50)),
          const SizedBox(height: 10),
          const Text('No ESG reports found.', style: TextStyle(color: _textColor, fontSize: 18)),
          const Text('Start by creating a new report.', style: TextStyle(color: _mutedColor)),
        ],
      ),
    );
  }

  Widget _buildReportList(List<EsgReport> reports) {
    return ListView.builder(
      itemCount: reports.length,
      itemBuilder: (context, index) {
        final report = reports[index];
        return Card(
          color: _cardColor,
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: ExpansionTile(
            leading: _getStatusIcon(report.status),
            title: Text(report.name, style: const TextStyle(color: _textColor)),
            subtitle: Text('Carbon Footprint: ${report.carbonFootprint} tons CO2e', style: TextStyle(color: _mutedColor)),
            children: [
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('ID: ${report.id}', style: const TextStyle(color: _textColor)),
                    Text('SDG Alignment: ${report.sdgAlignment}', style: const TextStyle(color: _textColor)),
                    Text('Status: ${report.status}', style: const TextStyle(color: _textColor)),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (report.status == 'Pending') ...[
                          ElevatedButton(
                            onPressed: () => _approveReport(report.id),
                            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                            child: const Text('Approve', style: TextStyle(color: _textColor)),
                          ),
                          const SizedBox(width: 8),
                          ElevatedButton(
                            onPressed: () => _rejectReport(report.id),
                            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                            child: const Text('Reject', style: TextStyle(color: _textColor)),
                          ),
                          const SizedBox(width: 8),
                        ],
                        IconButton(
                          icon: const Icon(Icons.edit, color: _accentColor),
                          onPressed: () => _showCreateEditBottomSheet(context, report: report),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete, color: Colors.redAccent),
                          onPressed: () => _confirmDelete(context, report.id),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _getStatusIcon(String status) {
    switch (status) {
      case 'Approved':
        return const Icon(Icons.check_circle, color: Colors.green);
      case 'Pending':
        return const Icon(Icons.hourglass_empty, color: Colors.orange);
      case 'Rejected':
        return const Icon(Icons.cancel, color: Colors.red);
      default:
        return const Icon(Icons.info, color: _mutedColor);
    }
  }

  void _showCreateEditBottomSheet(BuildContext context, {EsgReport? report}) {
    if (report != null) {
      _reportName = report.name;
      _carbonFootprint = report.carbonFootprint.toString();
      _sdgAlignment = report.sdgAlignment;
    } else {
      _reportName = '';
      _carbonFootprint = '';
      _sdgAlignment = 'SDG 1';
    }

    showModalBottomSheet(
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
          child: SingleChildScrollView(
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(report == null ? 'Create ESG Report' : 'Edit ESG Report', style: const TextStyle(color: _textColor, fontSize: 20, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 20),
                  TextFormField(
                    initialValue: _reportName,
                    decoration: InputDecoration(
                      labelText: 'Report Name',
                      labelStyle: const TextStyle(color: _mutedColor),
                      enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: _borderColor)),
                      focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: _accentColor)),
                      border: const OutlineInputBorder(),
                    ),
                    style: const TextStyle(color: _textColor),
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'Please enter a report name';
                      }
                      return null;
                    },
                    onSaved: (value) => _reportName = value!,
                  ),
                  const SizedBox(height: 15),
                  TextFormField(
                    initialValue: _carbonFootprint,
                    decoration: InputDecoration(
                      labelText: 'Carbon Footprint (tons CO2e)',
                      labelStyle: const TextStyle(color: _mutedColor),
                      enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: _borderColor)),
                      focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: _accentColor)),
                      border: const OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: _textColor),
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'Please enter carbon footprint';
                      }
                      if (double.tryParse(value) == null) {
                        return 'Please enter a valid number';
                      }
                      return null;
                    },
                    onSaved: (value) => _carbonFootprint = value!,
                  ),
                  const SizedBox(height: 15),
                  DropdownButtonFormField<String>(
                    value: _sdgAlignment,
                    decoration: InputDecoration(
                      labelText: 'SDG Alignment',
                      labelStyle: const TextStyle(color: _mutedColor),
                      enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: _borderColor)),
                      focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: _accentColor)),
                      border: const OutlineInputBorder(),
                    ),
                    dropdownColor: _cardColor,
                    style: const TextStyle(color: _textColor),
                    items: const [
                      DropdownMenuItem(value: 'SDG 1', child: Text('No Poverty', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 2', child: Text('Zero Hunger', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 3', child: Text('Good Health and Well-being', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 4', child: Text('Quality Education', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 5', child: Text('Gender Equality', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 6', child: Text('Clean Water and Sanitation', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 7', child: Text('Affordable and Clean Energy', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 8', child: Text('Decent Work and Economic Growth', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 9', child: Text('Industry, Innovation, and Infrastructure', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 10', child: Text('Reduced Inequalities', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 11', child: Text('Sustainable Cities and Communities', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 12', child: Text('Responsible Consumption and Production', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 13', child: Text('Climate Action', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 14', child: Text('Life Below Water', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 15', child: Text('Life On Land', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 16', child: Text('Peace, Justice, and Strong Institutions', style: TextStyle(color: _textColor))),
                      DropdownMenuItem(value: 'SDG 17', child: Text('Partnerships for the Goals', style: TextStyle(color: _textColor))),
                    ],
                    onChanged: (value) {
                      setState(() {
                        _sdgAlignment = value!;
                      });
                    },
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'Please select an SDG alignment';
                      }
                      return null;
                    },
                    onSaved: (value) => _sdgAlignment = value!,
                  ),
                  const SizedBox(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('Cancel', style: TextStyle(color: _mutedColor)),
                      ),
                      const SizedBox(width: 10),
                      ElevatedButton(
                        onPressed: () async {
                          if (_formKey.currentState!.validate()) {
                            _formKey.currentState!.save();
                            final apiService = ref.read(apiServiceProvider);
                            if (report == null) {
                              // Create new report
                              final newReport = EsgReport(
                                id: '', // ID will be generated by backend
                                name: _reportName,
                                carbonFootprint: double.parse(_carbonFootprint),
                                sdgAlignment: _sdgAlignment,
                              );
                              await apiService.createEsgReport(newReport);
                            } else {
                              // Update existing report
                              final updatedReport = report.copyWith(
                                name: _reportName,
                                carbonFootprint: double.parse(_carbonFootprint),
                                sdgAlignment: _sdgAlignment,
                              );
                              await apiService.updateEsgReport(updatedReport);
                            }
                            ref.invalidate(esgReportsProvider);
                            Navigator.pop(context);
                          }
                        },
                        style: ElevatedButton.styleFrom(backgroundColor: _accentColor),
                        child: Text(report == null ? 'Create' : 'Save', style: const TextStyle(color: _textColor)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  void _confirmDelete(BuildContext context, String reportId) {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: _cardColor,
          title: const Text('Delete Report', style: TextStyle(color: _textColor)),
          content: const Text('Are you sure you want to delete this ESG report?', style: TextStyle(color: _textColor)),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel', style: TextStyle(color: _mutedColor)),
            ),
            ElevatedButton(
              onPressed: () async {
                final apiService = ref.read(apiServiceProvider);
                await apiService.deleteEsgReport(reportId);
                ref.invalidate(esgReportsProvider);
                Navigator.of(context).pop();
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              child: const Text('Delete', style: TextStyle(color: _textColor)),
            ),
          ],
        );
      },
    );
  }

  Future<void> _approveReport(String reportId) async {
    final apiService = ref.read(apiServiceProvider);
    await apiService.approveEsgReport(reportId);
    ref.invalidate(esgReportsProvider);
  }

  Future<void> _rejectReport(String reportId) async {
    final apiService = ref.read(apiServiceProvider);
    await apiService.rejectEsgReport(reportId);
    ref.invalidate(esgReportsProvider);
  }
}
