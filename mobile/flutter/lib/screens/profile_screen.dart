import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _api = ApiService();
  Map<String, dynamic>? _user;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    try {
      final result = await _api.query('auth.me');
      if (mounted) setState(() { _user = result; _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Profile', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
        : _user == null
          ? const Center(child: Text('Not logged in', style: TextStyle(color: Color(0xFF94A3B8))))
          : RefreshIndicator(
              onRefresh: () async { setState(() => _loading = true); await _loadProfile(); },
              color: const Color(0xFF6366F1),
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    CircleAvatar(radius: 48, backgroundColor: const Color(0xFF6366F1), child: Text((_user!['name'] ?? 'U').toString().substring(0, 1).toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold))),
                    const SizedBox(height: 16),
                    Text(_user!['name'] ?? 'User', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(_user!['email'] ?? '', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                    const SizedBox(height: 8),
                    Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), decoration: BoxDecoration(color: const Color(0xFF6366F1).withOpacity(0.2), borderRadius: BorderRadius.circular(20)), child: Text('KYC: ${_user!['kycTier'] ?? 'basic'}'.toUpperCase(), style: const TextStyle(color: Color(0xFF6366F1), fontSize: 12, fontWeight: FontWeight.bold))),
                    const SizedBox(height: 32),
                    _buildInfoRow(Icons.phone, 'Phone', _user!['phone'] ?? 'Not set'),
                    _buildInfoRow(Icons.location_on, 'Country', _user!['country'] ?? 'Not set'),
                    _buildInfoRow(Icons.verified_user, 'Role', _user!['role'] ?? 'user'),
                    _buildInfoRow(Icons.calendar_today, 'Member since', _user!['createdAt']?.toString().substring(0, 10) ?? ''),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildInfoRow(IconData icon, String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFF1E293B), borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Icon(icon, color: const Color(0xFF6366F1), size: 20),
        const SizedBox(width: 12),
        Text(label, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
        const Spacer(),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500)),
      ]),
    );
  }
}
