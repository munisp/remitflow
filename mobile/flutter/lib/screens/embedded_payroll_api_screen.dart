import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart'; // Assuming api_service.dart exists in the services directory

// Define the tRPC API provider for EmbeddedPayrollAPI
final embeddedPayrollApiProvider = Provider((ref) => EmbeddedPayrollApi(ref.read(apiServiceProvider)));

class EmbeddedPayrollApiScreen extends ConsumerStatefulWidget {
  const EmbeddedPayrollApiScreen({super.key});

  @override
  ConsumerState<EmbeddedPayrollApiScreen> createState() => _EmbeddedPayrollApiScreenState();
}

class _EmbeddedPayrollApiScreenState extends ConsumerState<EmbeddedPayrollApiScreen> {
  List<dynamic> apiKeys = [];
  bool isLoading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _fetchApiKeys();
  }

  Future<void> _fetchApiKeys() async {
    setState(() {
      isLoading = true;
      error = null;
    });
    try {
      // Simulate API call
      // final result = await ref.read(embeddedPayrollApiProvider).listApiKeys();
      await Future.delayed(const Duration(seconds: 2)); // Simulate network delay
      setState(() {
        apiKeys = [
          {'id': 'key_123', 'name': 'Payroll Integration A', 'status': 'Active', 'created': '2023-01-15'},
          {'id': 'key_456', 'name': 'HR System Sync', 'status': 'Inactive', 'created': '2023-03-20'},
        ];
        isLoading = false;
      });
    } catch (e) {
      setState(() {
        error = 'Failed to load API keys: ${e.toString()}';
        isLoading = false;
      });
    }
  }

  Future<void> _issueApiKey(String name) async {
    try {
      // Simulate API call
      // await ref.read(embeddedPayrollApiProvider).issueApiKey(name);
      await Future.delayed(const Duration(seconds: 1));
      _fetchApiKeys(); // Refresh list
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('API Key issued successfully!')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to issue API Key: ${e.toString()}')));
      }
    }
  }

  Future<void> _revokeApiKey(String id) async {
    try {
      // Simulate API call
      // await ref.read(embeddedPayrollApiProvider).revokeApiKey(id);
      await Future.delayed(const Duration(seconds: 1));
      _fetchApiKeys(); // Refresh list
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('API Key revoked successfully!')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to revoke API Key: ${e.toString()}')));
      }
    }
  }

  Future<void> _triggerPayrollRun(String apiKeyId) async {
    try {
      // Simulate API call
      // await ref.read(embeddedPayrollApiProvider).triggerPayrollRun(apiKeyId);
      await Future.delayed(const Duration(seconds: 1));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Payroll run triggered successfully!')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to trigger payroll run: ${e.toString()}')));
      }
    }
  }

  void _showCreateApiKeyDialog() {
    final TextEditingController nameController = TextEditingController();
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E), // Card color
          title: const Text('Issue New API Key', style: TextStyle(color: Color(0xFFE2E8F0))), // Text color
          content: TextField(
            controller: nameController,
            style: const TextStyle(color: Color(0xFFE2E8F0)),
            decoration: InputDecoration(
              labelText: 'API Key Name',
              labelStyle: const TextStyle(color: Color(0xFF9CA3AF)), // Muted color
              enabledBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: Color(0xFF2D2D4E)), // Border color
                borderRadius: BorderRadius.circular(8.0),
              ),
              focusedBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: Color(0xFF6366F1)), // Accent color
                borderRadius: BorderRadius.circular(8.0),
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              child: const Text('Cancel', style: TextStyle(color: Color(0xFF9CA3AF))), // Muted color
              onPressed: () {
                Navigator.of(context).pop();
              },
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366F1), // Accent color
                foregroundColor: const Color(0xFFE2E8F0), // Text color
              ),
              onPressed: () {
                if (nameController.text.isNotEmpty) {
                  _issueApiKey(nameController.text);
                  Navigator.of(context).pop();
                }
              },
              child: const Text('Issue Key'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A), // Dark theme background
      appBar: AppBar(
        title: const Text('Embedded Payroll API Keys', style: TextStyle(color: Color(0xFFE2E8F0))), // Text color
        backgroundColor: const Color(0xFF0F0F1A), // Dark theme background
        iconTheme: const IconThemeData(color: Color(0xFFE2E8F0)), // Colored icon theme
      ),
      body: RefreshIndicator(
        onRefresh: _fetchApiKeys,
        color: const Color(0xFF6366F1), // Accent color for refresh indicator
        child: Builder(
          builder: (context) {
            if (isLoading) {
              return const Center(
                child: CircularProgressIndicator(color: Color(0xFF6366F1)), // Accent color
              );
            } else if (error != null) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(error!, style: const TextStyle(color: Color(0xFFE2E8F0))), // Text color
                    const SizedBox(height: 16),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF6366F1), // Accent color
                        foregroundColor: const Color(0xFFE2E8F0), // Text color
                      ),
                      onPressed: _fetchApiKeys,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              );
            } else if (apiKeys.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('✨', style: TextStyle(fontSize: 48)),
                    const SizedBox(height: 16),
                    const Text(
                      'No API keys found. Issue a new one to get started!',
                      style: TextStyle(color: Color(0xFFE2E8F0), fontSize: 16), // Text color
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              );
            } else {
              return ListView.builder(
                itemCount: apiKeys.length,
                itemBuilder: (context, index) {
                  final apiKey = apiKeys[index];
                  return Card(
                    color: const Color(0xFF1A1A2E), // Card color
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(apiKey['name'], style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 18, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 8),
                          Text('ID: ${apiKey['id']}', style: const TextStyle(color: Color(0xFF9CA3AF))), // Muted color
                          Text('Status: ${apiKey['status']}', style: TextStyle(color: apiKey['status'] == 'Active' ? Colors.greenAccent : const Color(0xFF9CA3AF))), // Muted or green for active
                          Text('Created: ${apiKey['created']}', style: const TextStyle(color: Color(0xFF9CA3AF))), // Muted color
                          const SizedBox(height: 16),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF6366F1), // Accent color
                                  foregroundColor: const Color(0xFFE2E8F0), // Text color
                                ),
                                onPressed: () => _triggerPayrollRun(apiKey['id']),
                                child: const Text('Trigger Payroll'),
                              ),
                              const SizedBox(width: 8),
                              OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  side: const BorderSide(color: Color(0xFF2D2D4E)), // Border color
                                  foregroundColor: const Color(0xFFE2E8F0), // Text color
                                ),
                                onPressed: () => _revokeApiKey(apiKey['id']),
                                child: const Text('Revoke'),
                              ),
                            ],
                          ),
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
        onPressed: _showCreateApiKeyDialog,
        backgroundColor: const Color(0xFF6366F1), // Accent color
        foregroundColor: const Color(0xFFE2E8F0), // Text color
        child: const Icon(Icons.add),
      ),
    );
  }
}

// Placeholder for EmbeddedPayrollApi tRPC client
class EmbeddedPayrollApi {
  final ApiService _apiService;

  EmbeddedPayrollApi(this._apiService);

  Future<List<dynamic>> listApiKeys() async {
    // Implement actual tRPC call using _apiService
    print('Calling tRPC: embeddedPayrollApi.listApiKeys');
    return []; // Placeholder
  }

  Future<void> issueApiKey(String name) async {
    // Implement actual tRPC call using _apiService
    print('Calling tRPC: embeddedPayrollApi.issueApiKey with name: $name');
  }

  Future<void> revokeApiKey(String id) async {
    // Implement actual tRPC call using _apiService
    print('Calling tRPC: embeddedPayrollApi.revokeApiKey with id: $id');
  }

  Future<void> triggerPayrollRun(String apiKeyId) async {
    // Implement actual tRPC call using _apiService
    print('Calling tRPC: embeddedPayrollApi.triggerPayrollRun with apiKeyId: $apiKeyId');
  }
}

// Placeholder for ApiService. This would typically be a more complex service
// handling network requests, authentication, etc.
class ApiService {
  // Example method, replace with actual API call logic
  Future<dynamic> get(String path) async {
    await Future.delayed(const Duration(milliseconds: 500));
    return {'data': 'example'};
  }
}

final apiServiceProvider = Provider((ref) => ApiService());
