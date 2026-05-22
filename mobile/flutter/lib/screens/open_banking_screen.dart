import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/future_proofing_service.dart';

class OpenBankingScreen extends StatefulWidget {
  const OpenBankingScreen({super.key});

  @override
  State<OpenBankingScreen> createState() => _OpenBankingScreenState();
}

class _OpenBankingScreenState extends State<OpenBankingScreen> {
  List<Map<String, dynamic>> _connectedAccounts = [];
  List<Map<String, dynamic>> _supportedBanks = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final accounts = await futureProofingService.getConnectedAccounts();
      final banks = await futureProofingService.getSupportedBanks();
      setState(() {
        _connectedAccounts = List<Map<String, dynamic>>.from(accounts['accounts'] ?? []);
        _supportedBanks = List<Map<String, dynamic>>.from(banks['banks'] ?? []);
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  Future<void> _connectBank(String bankId, String bankName) async {
    HapticFeedback.mediumImpact();
    try {
      final result = await futureProofingService.initiateBankConnection(bankId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Connecting to $bankName...'), backgroundColor: Colors.blue),
        );
      }
      final authUrl = result['authorizationUrl'];
      if (authUrl != null) {
        // In production, open authUrl in WebView
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to connect: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Open Banking'),
        centerTitle: true,
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadData),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 48, color: Colors.red),
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Colors.red)),
                    const SizedBox(height: 12),
                    ElevatedButton(onPressed: _loadData, child: const Text('Retry')),
                  ],
                ))
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildHeader(),
                        const SizedBox(height: 24),
                        if (_connectedAccounts.isNotEmpty) ...[
                          const Text('Connected Accounts', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 12),
                          ..._connectedAccounts.map(_buildAccountCard),
                          const SizedBox(height: 24),
                        ],
                        const Text('Connect a Bank', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 4),
                        const Text('CBN Open Banking compliant. Your data is encrypted.', style: TextStyle(color: Colors.grey, fontSize: 13)),
                        const SizedBox(height: 12),
                        ..._supportedBanks.map(_buildBankTile),
                      ],
                    ),
                  ),
                ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFF00695C), Color(0xFF004D40)]),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Icon(Icons.account_balance_wallet, color: Colors.white, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('CBN Open Banking', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                const SizedBox(height: 4),
                Text('${_connectedAccounts.length} account${_connectedAccounts.length == 1 ? '' : 's'} connected',
                    style: const TextStyle(color: Colors.white70)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAccountCard(Map<String, dynamic> account) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Colors.teal[50],
          child: const Icon(Icons.account_balance, color: Colors.teal),
        ),
        title: Text(account['bankName'] ?? 'Bank Account', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('${account['accountType'] ?? 'Savings'} • ****${account['accountNumber']?.toString().substring(account['accountNumber'].toString().length - 4) ?? '****'}'),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.green[50],
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Text('Active', style: TextStyle(color: Colors.green, fontSize: 12, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }

  Widget _buildBankTile(Map<String, dynamic> bank) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Colors.blue[50],
          child: Text(
            (bank['name'] ?? 'B').toString().substring(0, 1),
            style: TextStyle(color: Colors.blue[800], fontWeight: FontWeight.bold),
          ),
        ),
        title: Text(bank['name'] ?? 'Bank', style: const TextStyle(fontWeight: FontWeight.w500)),
        subtitle: Text('NIBSS Code: ${bank['nibssCode'] ?? 'N/A'}', style: const TextStyle(fontSize: 12)),
        trailing: OutlinedButton(
          onPressed: () => _connectBank(bank['id']?.toString() ?? '', bank['name']?.toString() ?? ''),
          style: OutlinedButton.styleFrom(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          child: const Text('Connect'),
        ),
      ),
    );
  }
}
