import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  List<dynamic> _transactions = [];
  double _totalBalance = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final txData = await apiService.query('transactions.list', {'limit': 5});
      final walletData = await apiService.query('wallet.list');
      if (mounted) {
        setState(() {
          _transactions = txData['items'] as List? ?? [];
          final wallets = walletData as List? ?? [];
          _totalBalance = wallets.fold(0.0, (sum, w) => sum + (double.tryParse(w['balanceUsd']?.toString() ?? '0') ?? 0));
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _loadData,
        color: const Color(0xFF6366F1),
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              expandedHeight: 0,
              floating: true,
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Good day, ${user?.name.split(' ').first ?? 'User'} 👋',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  const Text('RemitFlow Dashboard', style: TextStyle(fontSize: 12, color: Color(0xFF9CA3AF))),
                ],
              ),
              actions: [
                IconButton(
                  icon: const Icon(Icons.notifications_outlined),
                  onPressed: () => context.go('/notifications'),
                ),
              ],
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Balance Card
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                        ),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Total Portfolio Value', style: TextStyle(color: Colors.white70, fontSize: 13)),
                          const SizedBox(height: 4),
                          Text(
                            '\$${_totalBalance.toStringAsFixed(2)}',
                            style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w800, letterSpacing: -1),
                          ),
                          const SizedBox(height: 20),
                          Row(
                            children: [
                              Expanded(
                                child: ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.white.withOpacity(0.2),
                                    foregroundColor: Colors.white,
                                  ),
                                  onPressed: () => context.go('/send'),
                                  child: const Text('Send'),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.white,
                                    foregroundColor: const Color(0xFF6366F1),
                                  ),
                                  onPressed: () => context.go('/wallet'),
                                  child: const Text('Wallet'),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Quick Actions
                    const Text('Quick Actions', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Colors.white)),
                    const SizedBox(height: 12),
                    GridView.count(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisCount: 2,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 1.5,
                      children: [
                        _QuickActionCard(icon: '💸', label: 'Send Money', onTap: () => context.go('/send')),
                        _QuickActionCard(icon: '📈', label: 'FX Alerts', onTap: () => context.go('/fx-alerts')),
                        _QuickActionCard(icon: '🛤️', label: 'Payment Rails', onTap: () => context.go('/payment-rails')),
                        _QuickActionCard(icon: '💰', label: 'Revenue Share', onTap: () => context.go('/revenue-share')),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // Recent Transactions
                    const Text('Recent Transactions', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Colors.white)),
                    const SizedBox(height: 12),
                    if (_loading)
                      const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
                    else if (_transactions.isEmpty)
                      const Center(child: Text('No transactions yet', style: TextStyle(color: Color(0xFF6B7280))))
                    else
                      Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFF1A1A2E),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: ListView.separated(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: _transactions.length,
                          separatorBuilder: (_, __) => const Divider(color: Color(0xFF2D2D4E), height: 1),
                          itemBuilder: (context, index) {
                            final tx = _transactions[index] as Map<String, dynamic>;
                            final isReceive = tx['type'] == 'receive';
                            return ListTile(
                              leading: CircleAvatar(
                                backgroundColor: const Color(0xFF2D2D4E),
                                child: Text(isReceive ? '↙' : '↗', style: const TextStyle(color: Color(0xFF6366F1))),
                              ),
                              title: Text(tx['description']?.toString() ?? '${tx['type']} transfer',
                                  style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 14)),
                              subtitle: Text(tx['createdAt']?.toString().substring(0, 10) ?? '',
                                  style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
                              trailing: Text(
                                '${isReceive ? '+' : '-'}${tx['currency']} ${double.tryParse(tx['amount']?.toString() ?? '0')?.toStringAsFixed(2) ?? '0.00'}',
                                style: TextStyle(
                                  color: isReceive ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickActionCard extends StatelessWidget {
  final String icon;
  final String label;
  final VoidCallback onTap;

  const _QuickActionCard({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFF2D2D4E)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(icon, style: const TextStyle(fontSize: 28)),
            const SizedBox(height: 8),
            Text(label, style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 13, fontWeight: FontWeight.w600), textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
