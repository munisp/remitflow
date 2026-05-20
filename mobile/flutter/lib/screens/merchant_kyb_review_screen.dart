import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class MerchantKybReviewScreen extends ConsumerStatefulWidget {
  const MerchantKybReviewScreen({super.key});

  @override
  ConsumerState<MerchantKybReviewScreen> createState() => _MerchantKybReviewScreenState();
}

class _MerchantKybReviewScreenState extends ConsumerState<MerchantKybReviewScreen> {
  static const Color _backgroundColor = Color(0xFF0F0F1A);
  static const Color _cardColor = Color(0xFF1A1A2E);
  static const Color _accentColor = Color(0xFF6366F1);
  static const Color _textColor = Color(0xFFE2E8F0);
  static const Color _mutedColor = Color(0xFF9CA3AF);
  static const Color _borderColor = Color(0xFF2D2D4E);

  bool _isLoading = true;
  String? _error;
  bool _isAdmin = false;
  
  Map<String, dynamic>? _myStatus;
  List<dynamic> _adminList = [];

  @override
  void initState() {
    super.initState();
    _fetchData();
  }

  Future<void> _fetchData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      if (_isAdmin) {
        final response = await ApiService.instance.get('/trpc/merchantKybReview.adminList');
        setState(() {
          _adminList = response['result']?['data'] ?? [];
          _isLoading = false;
        });
      } else {
        final response = await ApiService.instance.get('/trpc/merchantKybReview.getMyStatus');
        setState(() {
          _myStatus = response['result']?['data'];
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _submitApplication(Map<String, dynamic> data) async {
    setState(() => _isLoading = true);
    try {
      await ApiService.instance.post('/trpc/merchantKybReview.submit', data);
      if (mounted) {
        Navigator.pop(context);
        _fetchData();
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _reviewApplication(String id, String status, String comments) async {
    setState(() => _isLoading = true);
    try {
      await ApiService.instance.post('/trpc/merchantKybReview.adminReview', {
        'id': id,
        'status': status,
        'comments': comments,
      });
      if (mounted) {
        Navigator.pop(context);
        _fetchData();
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  void _showSubmitDialog() {
    final companyNameController = TextEditingController();
    final registrationNumberController = TextEditingController();
    final taxIdController = TextEditingController();

    showModalBottomSheet(
      context: context,
      backgroundColor: _cardColor,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Padding(
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
              'Submit KYB Application',
              style: TextStyle(
                color: _textColor,
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 20),
            _buildTextField(companyNameController, 'Company Name'),
            const SizedBox(height: 16),
            _buildTextField(registrationNumberController, 'Registration Number'),
            const SizedBox(height: 16),
            _buildTextField(taxIdController, 'Tax ID'),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _accentColor,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: () {
                  _submitApplication({
                    'companyName': companyNameController.text,
                    'registrationNumber': registrationNumberController.text,
                    'taxId': taxIdController.text,
                  });
                },
                child: const Text(
                  'Submit',
                  style: TextStyle(color: Colors.white, fontSize: 16),
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _showReviewDialog(Map<String, dynamic> application) {
    final commentsController = TextEditingController();

    showModalBottomSheet(
      context: context,
      backgroundColor: _cardColor,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Padding(
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
            Text(
              'Review: ${application['companyName'] ?? 'Unknown'}',
              style: const TextStyle(
                color: _textColor,
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Reg No: ${application['registrationNumber'] ?? 'N/A'}',
              style: const TextStyle(color: _mutedColor),
            ),
            const SizedBox(height: 8),
            Text(
              'Tax ID: ${application['taxId'] ?? 'N/A'}',
              style: const TextStyle(color: _mutedColor),
            ),
            const SizedBox(height: 20),
            _buildTextField(commentsController, 'Review Comments'),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red.shade600,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: () {
                      _reviewApplication(
                        application['id'].toString(),
                        'REJECTED',
                        commentsController.text,
                      );
                    },
                    child: const Text(
                      'Reject',
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green.shade600,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: () {
                      _reviewApplication(
                        application['id'].toString(),
                        'APPROVED',
                        commentsController.text,
                      );
                    },
                    child: const Text(
                      'Approve',
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, String label) {
    return TextField(
      controller: controller,
      style: const TextStyle(color: _textColor),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: _mutedColor),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: _borderColor),
          borderRadius: BorderRadius.circular(12),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: _accentColor),
          borderRadius: BorderRadius.circular(12),
        ),
        filled: true,
        fillColor: _backgroundColor,
      ),
    );
  }

  Widget _buildStatusBadge(String status) {
    Color color;
    switch (status.toUpperCase()) {
      case 'APPROVED':
        color = Colors.green;
        break;
      case 'REJECTED':
        color = Colors.red;
        break;
      case 'PENDING':
      default:
        color = Colors.orange;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _buildMerchantView() {
    if (_myStatus == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              '🏢',
              style: TextStyle(fontSize: 64),
            ),
            const SizedBox(height: 16),
            const Text(
              'No KYB Application Found',
              style: TextStyle(
                color: _textColor,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Submit your business details for verification.',
              style: TextStyle(color: _mutedColor),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: _accentColor,
                padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: _showSubmitDialog,
              child: const Text(
                'Submit Application',
                style: TextStyle(color: Colors.white),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchData,
      color: _accentColor,
      backgroundColor: _cardColor,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: _cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _borderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Application Status',
                      style: TextStyle(
                        color: _textColor,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    _buildStatusBadge(_myStatus!['status'] ?? 'PENDING'),
                  ],
                ),
                const Divider(color: _borderColor, height: 32),
                _buildDetailRow('Company Name', _myStatus!['companyName'] ?? 'N/A'),
                const SizedBox(height: 12),
                _buildDetailRow('Registration No.', _myStatus!['registrationNumber'] ?? 'N/A'),
                const SizedBox(height: 12),
                _buildDetailRow('Tax ID', _myStatus!['taxId'] ?? 'N/A'),
                if (_myStatus!['comments'] != null) ...[
                  const SizedBox(height: 12),
                  _buildDetailRow('Comments', _myStatus!['comments']),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: const TextStyle(color: _mutedColor),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              color: _textColor,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAdminView() {
    if (_adminList.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              '✅',
              style: TextStyle(fontSize: 64),
            ),
            const SizedBox(height: 16),
            const Text(
              'All Caught Up!',
              style: TextStyle(
                color: _textColor,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'No pending KYB applications to review.',
              style: TextStyle(color: _mutedColor),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: _cardColor,
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: _borderColor),
                ),
              ),
              onPressed: _fetchData,
              child: const Text(
                'Refresh',
                style: TextStyle(color: _textColor),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchData,
      color: _accentColor,
      backgroundColor: _cardColor,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _adminList.length,
        itemBuilder: (context, index) {
          final item = _adminList[index];
          return Card(
            color: _cardColor,
            margin: const EdgeInsets.only(bottom: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: _borderColor),
            ),
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              title: Text(
                item['companyName'] ?? 'Unknown Company',
                style: const TextStyle(
                  color: _textColor,
                  fontWeight: FontWeight.bold,
                ),
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Reg: ${item['registrationNumber'] ?? 'N/A'}',
                  style: const TextStyle(color: _mutedColor),
                ),
              ),
              trailing: _buildStatusBadge(item['status'] ?? 'PENDING'),
              onTap: () => _showReviewDialog(item),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      appBar: AppBar(
        title: const Text(
          'KYB Review',
          style: TextStyle(color: _textColor),
        ),
        backgroundColor: _backgroundColor,
        iconTheme: const IconThemeData(color: _textColor),
        actions: [
          IconButton(
            icon: Icon(
              _isAdmin ? Icons.admin_panel_settings : Icons.person,
              color: _accentColor,
            ),
            tooltip: _isAdmin ? 'Switch to Merchant View' : 'Switch to Admin View',
            onPressed: () {
              setState(() {
                _isAdmin = !_isAdmin;
              });
              _fetchData();
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: _accentColor),
            )
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, color: Colors.red, size: 48),
                      const SizedBox(height: 16),
                      Text(
                        'Error loading data',
                        style: const TextStyle(color: _textColor, fontSize: 18),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _error!,
                        style: const TextStyle(color: _mutedColor),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 24),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _accentColor,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        onPressed: _fetchData,
                        child: const Text('Retry', style: TextStyle(color: Colors.white)),
                      ),
                    ],
                  ),
                )
              : _isAdmin
                  ? _buildAdminView()
                  : _buildMerchantView(),
    );
  }
}