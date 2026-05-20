import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class LetterOfCreditScreen extends ConsumerStatefulWidget {
  const LetterOfCreditScreen({Key? key}) : super(key: key);

  @override
  ConsumerState<LetterOfCreditScreen> createState() => _LetterOfCreditScreenState();
}

class _LetterOfCreditScreenState extends ConsumerState<LetterOfCreditScreen> {
  bool _isLoading = true;
  String? _error;
  List<dynamic> _lcs = [];

  @override
  void initState() {
    super.initState();
    _fetchLCs();
  }

  Future<void> _fetchLCs() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await ApiService.instance.get('/trpc/letterOfCredit.list');
      setState(() {
        _lcs = response['result']['data']['json'] ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _openLC(Map<String, dynamic> data) async {
    try {
      await ApiService.instance.post('/trpc/letterOfCredit.open', data);
      _fetchLCs();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Letter of Credit opened successfully')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _uploadDocument(String lcId, String documentType, String fileUrl) async {
    try {
      await ApiService.instance.post('/trpc/letterOfCredit.uploadDocument', {
        'lcId': lcId,
        'documentType': documentType,
        'fileUrl': fileUrl,
      });
      _fetchLCs();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Document uploaded successfully')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  void _showOpenLCDialog() {
    final applicantController = TextEditingController();
    final beneficiaryController = TextEditingController();
    final amountController = TextEditingController();
    final currencyController = TextEditingController(text: 'USD');
    final expiryDateController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1A1A2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
            left: 20,
            right: 20,
            top: 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Open Letter of Credit',
                style: TextStyle(
                  color: Color(0xFFE2E8F0),
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 20),
              _buildTextField(applicantController, 'Applicant Name'),
              const SizedBox(height: 12),
              _buildTextField(beneficiaryController, 'Beneficiary Name'),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: _buildTextField(amountController, 'Amount', isNumber: true),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 1,
                    child: _buildTextField(currencyController, 'Currency'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _buildTextField(expiryDateController, 'Expiry Date (YYYY-MM-DD)'),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: () {
                    final amount = double.tryParse(amountController.text) ?? 0.0;
                    if (applicantController.text.isNotEmpty &&
                        beneficiaryController.text.isNotEmpty &&
                        amount > 0) {
                      Navigator.pop(context);
                      _openLC({
                        'applicant': applicantController.text,
                        'beneficiary': beneficiaryController.text,
                        'amount': amount,
                        'currency': currencyController.text,
                        'expiryDate': expiryDateController.text,
                      });
                    }
                  },
                  child: const Text(
                    'Submit Application',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
            ],
          ),
        );
      },
    );
  }

  void _showUploadDocumentDialog(String lcId) {
    final docTypeController = TextEditingController();
    final fileUrlController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1A2E),
          title: const Text(
            'Upload Document',
            style: TextStyle(color: Color(0xFFE2E8F0)),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildTextField(docTypeController, 'Document Type (e.g., Bill of Lading)'),
              const SizedBox(height: 12),
              _buildTextField(fileUrlController, 'File URL'),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel', style: TextStyle(color: Color(0xFF9CA3AF))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366F1),
              ),
              onPressed: () {
                if (docTypeController.text.isNotEmpty && fileUrlController.text.isNotEmpty) {
                  Navigator.pop(context);
                  _uploadDocument(lcId, docTypeController.text, fileUrlController.text);
                }
              },
              child: const Text('Upload', style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      },
    );
  }

  Widget _buildTextField(TextEditingController controller, String label, {bool isNumber = false}) {
    return TextField(
      controller: controller,
      keyboardType: isNumber ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
      style: const TextStyle(color: Color(0xFFE2E8F0)),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: Color(0xFF2D2D4E)),
          borderRadius: BorderRadius.circular(12),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: Color(0xFF6366F1)),
          borderRadius: BorderRadius.circular(12),
        ),
        filled: true,
        fillColor: const Color(0xFF0F0F1A),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F0F1A),
        elevation: 0,
        iconTheme: const IconThemeData(color: Color(0xFF6366F1)),
        title: const Text(
          'Letter of Credit',
          style: TextStyle(
            color: Color(0xFFE2E8F0),
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_circle_outline),
            onPressed: _showOpenLCDialog,
          ),
        ],
      ),
      body: _buildBody(),
      floatingActionButton: FloatingActionButton(
        backgroundColor: const Color(0xFF6366F1),
        onPressed: _showOpenLCDialog,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(
          valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF6366F1)),
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            Text(
              'Failed to load LCs\n$_error',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFE2E8F0)),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366F1),
              ),
              onPressed: _fetchLCs,
              child: const Text('Retry', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      );
    }

    if (_lcs.isEmpty) {
      return RefreshIndicator(
        color: const Color(0xFF6366F1),
        backgroundColor: const Color(0xFF1A1A2E),
        onRefresh: _fetchLCs,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.of(context).size.height * 0.3),
            const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('📄', style: TextStyle(fontSize: 48)),
                  SizedBox(height: 16),
                  Text(
                    'No Letters of Credit found',
                    style: TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: const Color(0xFF6366F1),
      backgroundColor: const Color(0xFF1A1A2E),
      onRefresh: _fetchLCs,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _lcs.length,
        itemBuilder: (context, index) {
          final lc = _lcs[index];
          return _buildLCCard(lc);
        },
      ),
    );
  }

  Widget _buildLCCard(Map<String, dynamic> lc) {
    final status = lc['status'] ?? 'PENDING';
    final amount = lc['amount']?.toString() ?? '0.00';
    final currency = lc['currency'] ?? 'USD';
    final beneficiary = lc['beneficiary'] ?? 'Unknown Beneficiary';
    final lcId = lc['id']?.toString() ?? '';

    Color statusColor;
    switch (status.toString().toUpperCase()) {
      case 'ISSUED':
      case 'APPROVED':
        statusColor = Colors.green;
        break;
      case 'REJECTED':
        statusColor = Colors.redAccent;
        break;
      case 'PENDING':
      default:
        statusColor = Colors.orangeAccent;
    }

    return Card(
      color: const Color(0xFF1A1A2E),
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFF2D2D4E)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    beneficiary,
                    style: const TextStyle(
                      color: Color(0xFFE2E8F0),
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(8),
                    border: BorderSide(color: statusColor.withOpacity(0.5)),
                  ),
                  child: Text(
                    status,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Amount',
                      style: TextStyle(
                        color: Color(0xFF9CA3AF),
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '$currency $amount',
                      style: const TextStyle(
                        color: Color(0xFFE2E8F0),
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text(
                      'Expiry Date',
                      style: TextStyle(
                        color: Color(0xFF9CA3AF),
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      lc['expiryDate'] ?? 'N/A',
                      style: const TextStyle(
                        color: Color(0xFFE2E8F0),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(color: Color(0xFF2D2D4E)),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton.icon(
                  onPressed: () => _showUploadDocumentDialog(lcId),
                  icon: const Icon(Icons.upload_file, color: Color(0xFF6366F1), size: 18),
                  label: const Text(
                    'Upload Doc',
                    style: TextStyle(color: Color(0xFF6366F1)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}