import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

/// HnwPrivateBankingScreen — v205
/// HNW private banking dashboard with premium services (rate lock, RM contact, Stripe checkout).
/// Mirrors the web PrivateBankingDashboard page.
class HnwPrivateBankingScreen extends ConsumerStatefulWidget {
  const HnwPrivateBankingScreen({super.key});

  @override
  ConsumerState<HnwPrivateBankingScreen> createState() => _HnwPrivateBankingScreenState();
}

class _HnwPrivateBankingScreenState extends ConsumerState<HnwPrivateBankingScreen> {
  Map<String, dynamic>? _profile;
  List<dynamic> _rateLocks = [];
  bool _loading = true;
  String? _error;
  bool _checkoutLoading = false;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final profile = await apiService.query('hnwBanking.getProfile');
      final rateLocks = await apiService.query('hnwBanking.listRateLocks');
      if (mounted) {
        setState(() {
          _profile = profile is Map ? Map<String, dynamic>.from(profile) : null;
          _rateLocks = rateLocks is List ? rateLocks : [];
          _loading = false;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  Future<void> _initiateCheckout(String serviceType) async {
    setState(() => _checkoutLoading = true);
    try {
      final result = await apiService.mutate('hnwBanking.createHnwCheckout', params: {
        'serviceType': serviceType,
        'origin': 'mobile',
      });
      if (mounted) {
        final url = result?['url']?.toString();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(url != null ? 'Checkout link generated. Open in browser: $url' : 'Checkout initiated'),
            backgroundColor: const Color(0xFF6366F1),
            duration: const Duration(seconds: 8),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: const Color(0xFFEF4444)),
        );
      }
    } finally {
      if (mounted) setState(() => _checkoutLoading = false);
    }
  }

  Widget _buildProfileCard() {
    final tier = _profile?['aumTier']?.toString() ?? 'standard';
    final aum = _profile?['estimatedAum'];
    final rmName = _profile?['relationshipManagerName']?.toString();
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF312E81), Color(0xFF4C1D95)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF6366F1).withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Private Banking', style: TextStyle(color: Color(0xFFC4B5FD), fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF6366F1).withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFF6366F1).withOpacity(0.5)),
                ),
                child: Text(tier.toUpperCase(), style: const TextStyle(color: Color(0xFFA5B4FC), fontSize: 11, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (aum != null)
            Text(
              '\$${double.tryParse(aum.toString())?.toStringAsFixed(0) ?? aum}',
              style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold),
            ),
          const Text('Estimated AUM', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
          if (rmName != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.person_outline, color: Color(0xFF94A3B8), size: 14),
                const SizedBox(width: 6),
                Text('RM: $rmName', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPremiumServices() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Premium Services', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          _buildServiceCard(
            icon: Icons.lock_clock,
            title: 'Priority SWIFT',
            subtitle: 'Same-day SWIFT transfer with priority processing',
            price: '\$25',
            serviceType: 'priority_swift',
            color: const Color(0xFF0EA5E9),
          ),
          const SizedBox(height: 10),
          _buildServiceCard(
            icon: Icons.workspace_premium,
            title: 'Advisory Retainer',
            subtitle: 'Monthly access to dedicated FX advisory team',
            price: '\$250/mo',
            serviceType: 'advisory_retainer',
            color: const Color(0xFF8B5CF6),
          ),
        ],
      ),
    );
  }

  Widget _buildServiceCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required String price,
    required String serviceType,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 2),
                Text(subtitle, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            children: [
              Text(price, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13)),
              const SizedBox(height: 6),
              SizedBox(
                height: 32,
                child: ElevatedButton(
                  onPressed: _checkoutLoading ? null : () => _initiateCheckout(serviceType),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: color,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: _checkoutLoading
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Pay', style: TextStyle(fontSize: 12)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Private Banking', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF6366F1)),
            onPressed: () { setState(() => _loading = true); _loadData(); },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 48, color: Color(0xFFEF4444)),
                      const SizedBox(height: 12),
                      Text('Error: $_error', style: const TextStyle(color: Color(0xFFEF4444))),
                      const SizedBox(height: 12),
                      ElevatedButton(
                        onPressed: () { setState(() { _loading = true; _error = null; }); _loadData(); },
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadData,
                  color: const Color(0xFF6366F1),
                  child: ListView(
                    children: [
                      _buildProfileCard(),
                      _buildPremiumServices(),
                      const SizedBox(height: 24),
                      // Rate locks section
                      if (_rateLocks.isNotEmpty) ...[
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 16),
                          child: Text('Active Rate Locks', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                        ),
                        const SizedBox(height: 12),
                        ..._rateLocks.take(5).map((lock) => Container(
                          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E293B),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: const Color(0xFF334155)),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                '${lock?['fromCurrency'] ?? '?'}/${lock?['toCurrency'] ?? '?'}',
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                              ),
                              Text(
                                '${lock?['lockedRate'] ?? '—'}',
                                style: const TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                        )),
                      ],
                      const SizedBox(height: 32),
                    ],
                  ),
                ),
    );
  }
}
