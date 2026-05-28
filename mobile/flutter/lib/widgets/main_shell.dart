import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'app_drawer.dart';

/// MainShell — persistent scaffold with bottom navigation (5 tabs + FAB)
/// and a full navigation drawer accessible via hamburger menu.
class MainShell extends StatelessWidget {
  final Widget child;

  const MainShell({super.key, required this.child});

  int _getCurrentIndex(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    if (location.startsWith('/wallet')) return 1;
    if (location.startsWith('/send')) return 2;
    if (location.startsWith('/transactions')) return 3;
    if (location.startsWith('/profile') || location.startsWith('/settings')) return 4;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final currentIndex = _getCurrentIndex(context);

    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      drawer: const AppDrawer(),
      body: Column(
        children: [
          // Persistent top bar with hamburger + search
          Container(
            color: const Color(0xFF0F0F1A),
            child: SafeArea(
              bottom: false,
              child: SizedBox(
                height: 56,
                child: Row(
                  children: [
                    Builder(
                      builder: (ctx) => IconButton(
                        icon: const Icon(Icons.menu, color: Colors.white),
                        onPressed: () {
                          HapticFeedback.lightImpact();
                          Scaffold.of(ctx).openDrawer();
                        },
                      ),
                    ),
                    const Expanded(
                      child: Text(
                        'RemitFlow',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.search, color: Color(0xFF9CA3AF)),
                      onPressed: () => _showSearchSheet(context),
                    ),
                    IconButton(
                      icon: const Icon(Icons.notifications_outlined, color: Color(0xFF9CA3AF)),
                      onPressed: () => context.go('/notifications'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // Child content
          Expanded(child: child),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Color(0xFF1A1A2E),
          border: Border(top: BorderSide(color: Color(0xFF2D2D4E), width: 0.5)),
        ),
        child: SafeArea(
          child: SizedBox(
            height: 64,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildTab(context, 0, currentIndex, Icons.home_outlined, Icons.home, 'Home', '/dashboard'),
                _buildTab(context, 1, currentIndex, Icons.account_balance_wallet_outlined, Icons.account_balance_wallet, 'Wallet', '/wallet'),
                _buildSendFAB(context),
                _buildTab(context, 3, currentIndex, Icons.history_outlined, Icons.history, 'History', '/transactions'),
                _buildTab(context, 4, currentIndex, Icons.person_outlined, Icons.person, 'Profile', '/profile'),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTab(BuildContext context, int index, int currentIndex, IconData icon, IconData activeIcon, String label, String path) {
    final isActive = index == currentIndex;
    return Expanded(
      child: InkWell(
        onTap: () {
          HapticFeedback.selectionClick();
          context.go(path);
        },
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (isActive)
              Container(
                width: 24,
                height: 3,
                margin: const EdgeInsets.only(bottom: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF6366F1),
                  borderRadius: BorderRadius.circular(2),
                ),
              )
            else
              const SizedBox(height: 7),
            Icon(
              isActive ? activeIcon : icon,
              size: 22,
              color: isActive ? const Color(0xFF6366F1) : const Color(0xFF64748B),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                color: isActive ? const Color(0xFF6366F1) : const Color(0xFF64748B),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSendFAB(BuildContext context) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.mediumImpact();
        context.go('/send');
      },
      child: Container(
        width: 56,
        height: 56,
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]),
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(color: const Color(0xFF6366F1).withOpacity(0.4), blurRadius: 12, offset: const Offset(0, 4)),
          ],
        ),
        child: const Icon(Icons.arrow_upward, color: Colors.white, size: 24),
      ),
    );
  }

  void _showSearchSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A1A2E),
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => const _SearchSheet(),
    );
  }
}

/// Search sheet — equivalent of PWA's Cmd+K command palette.
class _SearchSheet extends StatefulWidget {
  const _SearchSheet();

  @override
  State<_SearchSheet> createState() => _SearchSheetState();
}

class _SearchSheetState extends State<_SearchSheet> {
  final _controller = TextEditingController();
  String _query = '';

  static const _allPages = <_SearchResult>[
    _SearchResult('Dashboard', '/dashboard', Icons.dashboard, 'Home'),
    _SearchResult('Wallet', '/wallet', Icons.account_balance_wallet, 'Money'),
    _SearchResult('Send Money', '/send', Icons.arrow_upward, 'Money'),
    _SearchResult('Receive', '/receive', Icons.arrow_downward, 'Money'),
    _SearchResult('Transactions', '/transactions', Icons.list_alt, 'Money'),
    _SearchResult('Beneficiaries', '/beneficiaries', Icons.people, 'Money'),
    _SearchResult('Cards', '/cards', Icons.credit_card, 'Money'),
    _SearchResult('Bills', '/bill-payment', Icons.receipt_long, 'Payments'),
    _SearchResult('Airtime & Data', '/airtime', Icons.phone_android, 'Payments'),
    _SearchResult('QR Pay', '/qr-pay', Icons.qr_code, 'Payments'),
    _SearchResult('Exchange Rates', '/exchange-rates', Icons.swap_horiz, 'FX'),
    _SearchResult('FX Alerts', '/fx-alerts', Icons.notifications_active, 'FX'),
    _SearchResult('Rate Calculator', '/rate-calculator', Icons.calculate, 'FX'),
    _SearchResult('Rate Lock', '/rate-lock', Icons.lock, 'FX'),
    _SearchResult('Savings', '/savings', Icons.savings, 'Grow'),
    _SearchResult('Savings Goals', '/savings-goals', Icons.flag, 'Grow'),
    _SearchResult('DiasporaVest', '/invest', Icons.trending_up, 'Grow'),
    _SearchResult('BNPL', '/bnpl', Icons.shopping_cart, 'Grow'),
    _SearchResult('CBDC', '/cbdc', Icons.account_balance, 'Grow'),
    _SearchResult('Stablecoin', '/stablecoin', Icons.bolt, 'Grow'),
    _SearchResult('Community Funds', '/community', Icons.favorite, 'Community'),
    _SearchResult('TalentBridge', '/talent-bridge', Icons.work, 'Community'),
    _SearchResult('Referral', '/referral', Icons.card_giftcard, 'Community'),
    _SearchResult('AfriMarket', '/afrimarket', Icons.store, 'Community'),
    _SearchResult('KYC Verification', '/kyc', Icons.verified_user, 'Compliance'),
    _SearchResult('Disputes', '/disputes', Icons.gavel, 'Compliance'),
    _SearchResult('Fraud Monitor', '/fraud-monitor', Icons.warning_amber, 'Compliance'),
    _SearchResult('Settings', '/settings', Icons.settings, 'Account'),
    _SearchResult('Support', '/support', Icons.help_outline, 'Account'),
    _SearchResult('Notifications', '/notifications', Icons.notifications, 'Account'),
    _SearchResult('Profile', '/profile', Icons.person, 'Account'),
    _SearchResult('Partner Portal', '/partner-portal', Icons.dashboard, 'Partners'),
    _SearchResult('API Keys', '/api-keys', Icons.vpn_key, 'Developer'),
    _SearchResult('Webhooks', '/webhook-manager', Icons.webhook, 'Developer'),
    _SearchResult('Admin Overview', '/admin-home', Icons.admin_panel_settings, 'Admin'),
    _SearchResult('Admin Users', '/admin-users', Icons.people, 'Admin'),
    _SearchResult('Feature Flags', '/admin-feature-flags', Icons.flag, 'Admin'),
    _SearchResult('Tenants', '/admin-tenants', Icons.apartment, 'Admin'),
    _SearchResult('Analytics', '/admin-analytics', Icons.analytics, 'Admin'),
    _SearchResult('Microservices', '/admin-microservices', Icons.memory, 'Admin'),
    _SearchResult('Payment Rails', '/payment-rails', Icons.route, 'Money'),
    _SearchResult('Batch Payments', '/batch-payments', Icons.view_module, 'Money'),
    _SearchResult('Recurring', '/recurring-payments', Icons.repeat, 'Money'),
    _SearchResult('Split Bill', '/split-bill', Icons.group, 'Money'),
    _SearchResult('M-Pesa', '/mpesa', Icons.phone_iphone, 'Money'),
    _SearchResult('Bond Market', '/bond-market', Icons.trending_up, 'Trade'),
    _SearchResult('Letter of Credit', '/letter-of-credit', Icons.description, 'Trade'),
    _SearchResult('Invoice Financing', '/invoice-financing', Icons.receipt, 'Trade'),
    _SearchResult('Global Payroll', '/payroll', Icons.work, 'Business'),
    _SearchResult('Expense Management', '/expense-management', Icons.receipt, 'Business'),
  ];

  List<_SearchResult> get _results {
    if (_query.isEmpty) return _allPages.take(10).toList();
    final q = _query.toLowerCase();
    return _allPages.where((p) => p.label.toLowerCase().contains(q) || p.group.toLowerCase().contains(q)).take(10).toList();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.6,
        child: Column(
          children: [
            Container(
              margin: const EdgeInsets.only(top: 8),
              width: 36,
              height: 4,
              decoration: BoxDecoration(color: const Color(0xFF64748B), borderRadius: BorderRadius.circular(2)),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _controller,
                autofocus: true,
                onChanged: (v) => setState(() => _query = v),
                style: const TextStyle(color: Colors.white, fontSize: 15),
                decoration: InputDecoration(
                  hintText: 'Search pages, features...',
                  hintStyle: const TextStyle(color: Color(0xFF64748B)),
                  prefixIcon: const Icon(Icons.search, color: Color(0xFF64748B)),
                  filled: true,
                  fillColor: const Color(0xFF0F0F1A),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF2D2D4E))),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF2D2D4E))),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF6366F1))),
                ),
              ),
            ),
            Expanded(
              child: _results.isEmpty
                  ? const Center(child: Text('No results found', style: TextStyle(color: Color(0xFF64748B))))
                  : ListView.builder(
                      itemCount: _results.length,
                      itemBuilder: (ctx, i) {
                        final r = _results[i];
                        return ListTile(
                          leading: Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: const Color(0xFF6366F1).withOpacity(0.1),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Icon(r.icon, size: 18, color: const Color(0xFF6366F1)),
                          ),
                          title: Text(r.label, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500)),
                          subtitle: Text(r.group, style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                          trailing: const Icon(Icons.chevron_right, color: Color(0xFF64748B), size: 18),
                          onTap: () {
                            Navigator.of(context).pop();
                            context.go(r.path);
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchResult {
  final String label;
  final String path;
  final IconData icon;
  final String group;
  const _SearchResult(this.label, this.path, this.icon, this.group);
}
