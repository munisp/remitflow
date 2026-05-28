import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../providers/nav_flags_provider.dart';

/// Navigation group definition matching the PWA's DashboardLayout nav groups.
class NavItem {
  final IconData icon;
  final String label;
  final String path;
  final bool adminOnly;
  final bool partnerOnly;
  final bool secondary;
  final String? featureKey;

  const NavItem({
    required this.icon,
    required this.label,
    required this.path,
    this.adminOnly = false,
    this.partnerOnly = false,
    this.secondary = false,
    this.featureKey,
  });
}

class NavGroup {
  final String id;
  final String label;
  final IconData icon;
  final List<NavItem> items;
  final bool adminOnly;

  const NavGroup({
    required this.id,
    required this.label,
    required this.icon,
    required this.items,
    this.adminOnly = false,
  });
}

/// All navigation groups — mirrors PWA DashboardLayout's 14 groups.
const _navGroups = <NavGroup>[
  // 1. HOME
  NavGroup(
    id: 'home',
    label: 'Home',
    icon: Icons.dashboard_outlined,
    items: [
      NavItem(icon: Icons.dashboard, label: 'Dashboard', path: '/dashboard'),
    ],
  ),
  // 2. MONEY & PAYMENTS
  NavGroup(
    id: 'money',
    label: 'Money & Payments',
    icon: Icons.account_balance_wallet_outlined,
    items: [
      NavItem(icon: Icons.account_balance_wallet, label: 'Wallet', path: '/wallet', featureKey: 'wallet'),
      NavItem(icon: Icons.arrow_upward, label: 'Send Money', path: '/send', featureKey: 'send_money'),
      NavItem(icon: Icons.arrow_downward, label: 'Receive', path: '/receive', featureKey: 'receive_money'),
      NavItem(icon: Icons.list_alt, label: 'Transactions', path: '/transactions', featureKey: 'transactions'),
      NavItem(icon: Icons.people, label: 'Beneficiaries', path: '/beneficiaries', featureKey: 'beneficiaries'),
      NavItem(icon: Icons.credit_card, label: 'Cards', path: '/cards', featureKey: 'virtual_cards'),
      NavItem(icon: Icons.receipt_long, label: 'Bills', path: '/bill-payment', featureKey: 'bill_payments'),
      NavItem(icon: Icons.phone_android, label: 'Airtime & Data', path: '/airtime', featureKey: 'airtime_data'),
      // Secondary
      NavItem(icon: Icons.qr_code, label: 'QR Pay', path: '/qr-pay', secondary: true, featureKey: 'qr_pay'),
      NavItem(icon: Icons.group, label: 'Split Bill', path: '/split-bill', secondary: true, featureKey: 'split_bill'),
      NavItem(icon: Icons.view_module, label: 'Batch Payments', path: '/batch-payments', secondary: true, featureKey: 'batch_payments'),
      NavItem(icon: Icons.account_balance, label: 'Direct Debit', path: '/direct-debit', secondary: true, featureKey: 'direct_debit'),
      NavItem(icon: Icons.repeat, label: 'Recurring', path: '/recurring-payments', secondary: true, featureKey: 'recurring_payments'),
      NavItem(icon: Icons.schedule, label: 'Scheduled', path: '/scheduled-transfers', secondary: true, featureKey: 'scheduled_transfers'),
      NavItem(icon: Icons.route, label: 'Payment Rails', path: '/payment-rails', secondary: true, featureKey: 'payment_rails'),
      NavItem(icon: Icons.open_in_browser, label: 'Open Banking', path: '/open-banking', secondary: true, featureKey: 'open_banking'),
      NavItem(icon: Icons.currency_exchange, label: 'Multi-Currency', path: '/multi-currency-wallet', secondary: true, featureKey: 'multi_currency_wallet'),
      NavItem(icon: Icons.phone_iphone, label: 'M-Pesa', path: '/mpesa', secondary: true),
      NavItem(icon: Icons.public, label: 'Wise Transfer', path: '/wise-transfer', secondary: true),
    ],
  ),
  // 3. FX & RATES
  NavGroup(
    id: 'fx',
    label: 'FX & Rates',
    icon: Icons.swap_horiz,
    items: [
      NavItem(icon: Icons.swap_horiz, label: 'Exchange Rates', path: '/exchange-rates', featureKey: 'fx_alerts'),
      NavItem(icon: Icons.notifications_active, label: 'FX Alerts', path: '/fx-alerts', featureKey: 'fx_alerts'),
      NavItem(icon: Icons.calculate, label: 'Rate Calculator', path: '/rate-calculator', featureKey: 'rate_calculator'),
      NavItem(icon: Icons.lock, label: 'Rate Lock', path: '/rate-lock', featureKey: 'rate_lock'),
      NavItem(icon: Icons.calculate_outlined, label: 'FX Calculator', path: '/fx-calculator', secondary: true, featureKey: 'fx_calculator'),
      NavItem(icon: Icons.stream, label: 'FX Streaming', path: '/fx-streaming', secondary: true, featureKey: 'fx_streaming'),
      NavItem(icon: Icons.shield, label: 'FX Hedging', path: '/fx-hedging', secondary: true, featureKey: 'fx_hedging'),
    ],
  ),
  // 4. GROW & SAVE
  NavGroup(
    id: 'grow',
    label: 'Grow & Save',
    icon: Icons.trending_up,
    items: [
      NavItem(icon: Icons.savings, label: 'Savings', path: '/savings', featureKey: 'savings_goals'),
      NavItem(icon: Icons.flag, label: 'Savings Goals', path: '/savings-goals', featureKey: 'savings_goals'),
      NavItem(icon: Icons.route, label: 'Corridors', path: '/corridors', featureKey: 'corridors'),
      NavItem(icon: Icons.trending_up, label: 'DiasporaVest', path: '/invest', featureKey: 'investments'),
      NavItem(icon: Icons.show_chart, label: 'Beyond Remittance', path: '/beyond-remittance', featureKey: 'beyond_remittance'),
      // Secondary
      NavItem(icon: Icons.shopping_cart, label: 'BNPL', path: '/bnpl', secondary: true, featureKey: 'bnpl'),
      NavItem(icon: Icons.account_balance, label: 'CBDC', path: '/cbdc', secondary: true, featureKey: 'cbdc'),
      NavItem(icon: Icons.bolt, label: 'Stablecoin', path: '/stablecoin', secondary: true, featureKey: 'stablecoin'),
      NavItem(icon: Icons.pie_chart, label: 'My Portfolio', path: '/invest-portfolio', secondary: true, featureKey: 'investments'),
      NavItem(icon: Icons.bar_chart, label: 'NGX Stocks', path: '/ngx-stocks', secondary: true, featureKey: 'investments'),
      NavItem(icon: Icons.house, label: 'Real Estate', path: '/real-estate', secondary: true, featureKey: 'investments'),
      NavItem(icon: Icons.rocket_launch, label: 'Startups', path: '/startup-deals', secondary: true, featureKey: 'investments'),
    ],
  ),
  // 5. COMMUNITY
  NavGroup(
    id: 'community',
    label: 'Community',
    icon: Icons.favorite_outline,
    items: [
      NavItem(icon: Icons.favorite, label: 'Community Funds', path: '/community', featureKey: 'community_funds'),
      NavItem(icon: Icons.family_restroom, label: 'Family Dashboard', path: '/family-dashboard', featureKey: 'family_dashboard'),
      NavItem(icon: Icons.work, label: 'TalentBridge', path: '/talent-bridge', featureKey: 'talent_bridge'),
      NavItem(icon: Icons.card_giftcard, label: 'Referral Program', path: '/referral', featureKey: 'referral_program'),
      NavItem(icon: Icons.store, label: 'AfriMarket', path: '/afrimarket', featureKey: 'marketplace'),
      // Secondary
      NavItem(icon: Icons.public, label: 'Community Hub', path: '/community-hub', secondary: true, featureKey: 'community_funds'),
      NavItem(icon: Icons.emoji_events, label: 'Leaderboard', path: '/community-leaderboard', secondary: true, featureKey: 'leaderboard'),
      NavItem(icon: Icons.card_giftcard, label: 'Referral Dashboard', path: '/referral-dashboard', secondary: true, featureKey: 'referral_program'),
    ],
  ),
  // 6. COMPLIANCE & IDENTITY
  NavGroup(
    id: 'compliance',
    label: 'Compliance',
    icon: Icons.shield_outlined,
    items: [
      NavItem(icon: Icons.verified_user, label: 'KYC Verification', path: '/kyc', featureKey: 'kyc_verification'),
      NavItem(icon: Icons.description, label: 'GDPR & Privacy', path: '/gdpr', featureKey: 'gdpr_privacy'),
      NavItem(icon: Icons.gavel, label: 'Disputes', path: '/disputes', featureKey: 'disputes'),
      NavItem(icon: Icons.warning_amber, label: 'Fraud Detection', path: '/fraud-monitor', featureKey: 'fraud_detection'),
      NavItem(icon: Icons.policy, label: 'Sanctions Screening', path: '/sanctions-screening', featureKey: 'sanctions_screening'),
      // Secondary
      NavItem(icon: Icons.flight, label: 'Travel Rule', path: '/travel-rule', secondary: true, featureKey: 'travel_rule'),
      NavItem(icon: Icons.score, label: 'Compliance Scoring', path: '/compliance-scoring', secondary: true, featureKey: 'compliance_scoring'),
      NavItem(icon: Icons.assignment, label: 'Compliance Reports', path: '/compliance-reporting', secondary: true, featureKey: 'compliance_scoring'),
      NavItem(icon: Icons.timeline, label: 'KYC Lifecycle', path: '/kyc-lifecycle', secondary: true, featureKey: 'kyc_lifecycle'),
    ],
  ),
  // 7. ACCOUNT
  NavGroup(
    id: 'account',
    label: 'Account',
    icon: Icons.person_outline,
    items: [
      NavItem(icon: Icons.settings, label: 'Settings', path: '/settings', featureKey: 'settings'),
      NavItem(icon: Icons.help_outline, label: 'Support', path: '/support', featureKey: 'support'),
      NavItem(icon: Icons.chat_bubble_outline, label: 'Live Chat', path: '/live-chat', secondary: true, featureKey: 'live_chat'),
      NavItem(icon: Icons.check_circle_outline, label: 'Onboarding', path: '/onboarding', featureKey: 'onboarding'),
      NavItem(icon: Icons.folder, label: 'Document Vault', path: '/document-vault', secondary: true, featureKey: 'document_vault'),
      NavItem(icon: Icons.security, label: 'Security', path: '/security-settings', secondary: true),
      NavItem(icon: Icons.notifications, label: 'Notifications', path: '/notifications', secondary: true),
    ],
  ),
  // 8. PARTNERS & BUSINESS
  NavGroup(
    id: 'partners',
    label: 'Partners & Business',
    icon: Icons.business,
    items: [
      NavItem(icon: Icons.description, label: 'Apply as Partner', path: '/partner-apply', featureKey: 'partner_apply'),
      NavItem(icon: Icons.dashboard, label: 'Partner Portal', path: '/partner-portal', partnerOnly: true, featureKey: 'partner_portal'),
      NavItem(icon: Icons.point_of_sale, label: 'POS & Agents', path: '/pos-management', featureKey: 'pos_agents'),
      NavItem(icon: Icons.storefront, label: 'Merchant Onboarding', path: '/merchant-onboarding', partnerOnly: true, featureKey: 'merchant_onboarding'),
      // Secondary
      NavItem(icon: Icons.attach_money, label: 'Revenue Share', path: '/revenue-share', secondary: true, featureKey: 'partner_revenue'),
      NavItem(icon: Icons.palette, label: 'Branding Preview', path: '/branding-preview', secondary: true, featureKey: 'branding_preview'),
      NavItem(icon: Icons.people, label: 'Agent Network', path: '/agent-network', secondary: true, featureKey: 'agent_network'),
    ],
  ),
  // 9. DEVELOPER
  NavGroup(
    id: 'developer',
    label: 'Developer',
    icon: Icons.code,
    items: [
      NavItem(icon: Icons.webhook, label: 'Webhooks', path: '/webhook-manager', featureKey: 'webhooks'),
      NavItem(icon: Icons.vpn_key, label: 'API Keys', path: '/api-keys', featureKey: 'api_keys'),
      NavItem(icon: Icons.science, label: 'Developer Sandbox', path: '/developer-sandbox', featureKey: 'developer_sandbox'),
      NavItem(icon: Icons.analytics, label: 'API Usage', path: '/api-usage', featureKey: 'api_usage'),
      // Secondary
      NavItem(icon: Icons.phone_android, label: 'Mobile SDK', path: '/pwa-features', secondary: true, featureKey: 'mobile_sdk'),
      NavItem(icon: Icons.notifications, label: 'Push Notifications', path: '/vapid-push-manager', secondary: true, featureKey: 'push_notifications'),
      NavItem(icon: Icons.science, label: 'Sandbox Scenarios', path: '/sandbox-scenarios', secondary: true, featureKey: 'sandbox_scenarios'),
    ],
  ),
  // 10. ADMIN
  NavGroup(
    id: 'admin',
    label: 'Admin',
    icon: Icons.admin_panel_settings,
    adminOnly: true,
    items: [
      NavItem(icon: Icons.dashboard, label: 'Overview', path: '/admin-home', adminOnly: true),
      NavItem(icon: Icons.people, label: 'Users', path: '/admin-users', adminOnly: true),
      NavItem(icon: Icons.verified_user, label: 'KYC Review', path: '/admin-kyc', adminOnly: true),
      NavItem(icon: Icons.shield, label: 'Compliance', path: '/admin-compliance', adminOnly: true),
      NavItem(icon: Icons.receipt_long, label: 'Audit Log', path: '/admin-audit-log', adminOnly: true),
      NavItem(icon: Icons.flag, label: 'Feature Flags', path: '/admin-feature-flags', adminOnly: true),
      NavItem(icon: Icons.apartment, label: 'Tenants', path: '/admin-tenants', adminOnly: true),
      NavItem(icon: Icons.palette, label: 'White Label', path: '/admin-white-label', adminOnly: true),
      // Secondary Admin
      NavItem(icon: Icons.analytics, label: 'Analytics', path: '/admin-analytics', adminOnly: true, secondary: true),
      NavItem(icon: Icons.trending_up, label: 'Transfer Analytics', path: '/transfer-analytics', adminOnly: true, secondary: true),
      NavItem(icon: Icons.gavel, label: 'Disputes', path: '/admin-disputes', adminOnly: true, secondary: true),
      NavItem(icon: Icons.memory, label: 'Microservices', path: '/admin-microservices', adminOnly: true, secondary: true),
      NavItem(icon: Icons.route, label: 'Corridor Pricing', path: '/corridor-pricing-admin', adminOnly: true, secondary: true),
      NavItem(icon: Icons.attach_money, label: 'Revenue Share', path: '/admin-revenue-share', adminOnly: true, secondary: true),
      NavItem(icon: Icons.chat, label: 'Chat Agent', path: '/chat-agent', adminOnly: true, secondary: true),
      NavItem(icon: Icons.settings, label: 'System Config', path: '/system-config', adminOnly: true, secondary: true),
      NavItem(icon: Icons.group_work, label: 'Bulk Actions', path: '/admin-bulk-actions', adminOnly: true, secondary: true),
      NavItem(icon: Icons.local_offer, label: 'Promo Codes', path: '/promo-codes', adminOnly: true, secondary: true),
      NavItem(icon: Icons.webhook, label: 'Webhooks Admin', path: '/webhook-admin', adminOnly: true, secondary: true),
      NavItem(icon: Icons.speed, label: 'Velocity Checks', path: '/velocity-checks', adminOnly: true, secondary: true),
      NavItem(icon: Icons.security, label: 'Security Audit', path: '/security-audit', adminOnly: true, secondary: true),
      NavItem(icon: Icons.health_and_safety, label: 'Services Health', path: '/services-health', adminOnly: true, secondary: true),
      NavItem(icon: Icons.policy, label: 'PBAC Policies', path: '/pbac-policies', adminOnly: true, secondary: true),
      NavItem(icon: Icons.handshake, label: 'Partner Apps', path: '/admin-partner-applications', adminOnly: true, secondary: true),
      NavItem(icon: Icons.account_balance, label: 'Treasury', path: '/treasury', adminOnly: true, secondary: true),
      NavItem(icon: Icons.water_drop, label: 'Liquidity', path: '/liquidity-monitor', adminOnly: true, secondary: true),
      NavItem(icon: Icons.monitor_heart, label: 'SLA Monitor', path: '/sla-monitor', adminOnly: true, secondary: true),
      NavItem(icon: Icons.money_off, label: 'Chargebacks', path: '/chargebacks', adminOnly: true, secondary: true),
      NavItem(icon: Icons.rule, label: 'Fee Rules', path: '/fee-rules-v2', adminOnly: true, secondary: true),
      NavItem(icon: Icons.smart_toy, label: 'AI Hub', path: '/ai-hub', adminOnly: true, secondary: true),
      NavItem(icon: Icons.database_outlined, label: 'Lakehouse', path: '/lakehouse', adminOnly: true, secondary: true),
      NavItem(icon: Icons.hub, label: 'Knowledge Graph', path: '/knowledge-graph', adminOnly: true, secondary: true),
    ],
  ),
  // 11. AGENT NETWORK
  NavGroup(
    id: 'agent',
    label: 'Agent Network',
    icon: Icons.storefront,
    items: [
      NavItem(icon: Icons.point_of_sale, label: 'Agent POS', path: '/agent-pos'),
      NavItem(icon: Icons.person_add, label: 'Become an Agent', path: '/agent-register'),
      NavItem(icon: Icons.money, label: 'Agent Cash-In', path: '/agent-cash-in', secondary: true),
    ],
  ),
  // 12. MY TRANSFERS
  NavGroup(
    id: 'transfers',
    label: 'My Transfers',
    icon: Icons.swap_vert,
    items: [
      NavItem(icon: Icons.list, label: 'Transfer History', path: '/my-transfers'),
      NavItem(icon: Icons.currency_bitcoin, label: 'Send Crypto', path: '/send-crypto', featureKey: 'crypto_transfers'),
      NavItem(icon: Icons.support_agent, label: 'Support Tickets', path: '/support-tickets'),
      NavItem(icon: Icons.work, label: 'Global Payroll', path: '/payroll', featureKey: 'global_payroll'),
    ],
  ),
  // 13. BUSINESS FINANCE
  NavGroup(
    id: 'business-finance',
    label: 'Business Finance',
    icon: Icons.business_center,
    items: [
      NavItem(icon: Icons.receipt, label: 'Expense Management', path: '/expense-management', featureKey: 'expense_management'),
      NavItem(icon: Icons.people, label: 'Contractor Payments', path: '/contractor-payments', featureKey: 'contractor_payments'),
      NavItem(icon: Icons.verified, label: 'Merchant KYB', path: '/merchant-kyb', featureKey: 'merchant_kyb'),
      NavItem(icon: Icons.description, label: 'Payroll & Tax', path: '/payroll-tax', featureKey: 'payroll_tax'),
    ],
  ),
  // 14. TRADE FINANCE & ADVANCED
  NavGroup(
    id: 'trade-finance',
    label: 'Trade & Advanced',
    icon: Icons.rocket_launch,
    items: [
      NavItem(icon: Icons.savings, label: 'Business Savings', path: '/business-savings', featureKey: 'business_savings'),
      NavItem(icon: Icons.trending_up, label: 'Bond Market', path: '/bond-market', featureKey: 'bond_market'),
      NavItem(icon: Icons.description, label: 'Letter of Credit', path: '/letter-of-credit', featureKey: 'letter_of_credit'),
      NavItem(icon: Icons.receipt, label: 'Invoice Financing', path: '/invoice-financing', featureKey: 'invoice_financing'),
      NavItem(icon: Icons.home, label: 'Diaspora Mortgage', path: '/diaspora-mortgage', secondary: true, featureKey: 'diaspora_mortgage'),
      NavItem(icon: Icons.star, label: 'Credit Scoring', path: '/credit-scoring', secondary: true, featureKey: 'credit_scoring'),
      NavItem(icon: Icons.eco, label: 'ESG Reporting', path: '/esg-reporting', secondary: true, featureKey: 'esg_reporting'),
    ],
  ),
];

/// The main app drawer with grouped navigation, role-based visibility,
/// feature flag gating, primary/secondary split with "More" toggle,
/// and search functionality.
class AppDrawer extends ConsumerStatefulWidget {
  const AppDrawer({super.key});

  @override
  ConsumerState<AppDrawer> createState() => _AppDrawerState();
}

class _AppDrawerState extends ConsumerState<AppDrawer> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  final Map<String, bool> _moreExpanded = {};
  final Map<String, bool> _groupCollapsed = {};

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  bool _isItemVisible(NavItem item, String? role, NavFlagsState navFlags) {
    final isAdmin = role == 'admin';
    final isPartner = role == 'partner' || isAdmin;
    if (item.adminOnly && !isAdmin) return false;
    if (item.partnerOnly && !isPartner) return false;
    // Feature flag gate (server-driven)
    if (item.featureKey != null && !navFlags.isEnabled(item.featureKey)) return false;
    return true;
  }

  bool _isGroupVisible(NavGroup group, String? role, NavFlagsState navFlags) {
    final isAdmin = role == 'admin';
    if (group.adminOnly && !isAdmin) return false;
    return group.items.any((item) => _isItemVisible(item, role, navFlags));
  }

  List<NavItem> _filterBySearch(List<NavItem> items) {
    if (_searchQuery.isEmpty) return items;
    final q = _searchQuery.toLowerCase();
    return items.where((item) => item.label.toLowerCase().contains(q)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final navFlags = ref.watch(navFlagsProvider);
    final user = authState.user;
    final role = user?.role;
    final currentLocation = GoRouterState.of(context).uri.toString();

    return Drawer(
      backgroundColor: const Color(0xFF0F0F1A),
      child: SafeArea(
        child: Column(
          children: [
            // Header
            Container(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Column(
                children: [
                  Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.bolt, color: Colors.white, size: 22),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('RemitFlow', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
                            Text(user?.name ?? 'Guest', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                          ],
                        ),
                      ),
                      if (role == 'admin')
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF6366F1).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text('Admin', style: TextStyle(color: Color(0xFF6366F1), fontSize: 10, fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Search
                  Container(
                    height: 40,
                    decoration: BoxDecoration(
                      color: const Color(0xFF1A1A2E),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFF2D2D4E)),
                    ),
                    child: TextField(
                      controller: _searchController,
                      onChanged: (v) => setState(() => _searchQuery = v),
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        hintText: 'Search pages...',
                        hintStyle: TextStyle(color: Color(0xFF64748B), fontSize: 13),
                        prefixIcon: Icon(Icons.search, color: Color(0xFF64748B), size: 18),
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(color: Color(0xFF2D2D4E), height: 1),
            // Navigation groups
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: _navGroups
                    .where((g) => _isGroupVisible(g, role, navFlags))
                    .map((group) => _buildGroup(group, role, navFlags, currentLocation))
                    .toList(),
              ),
            ),
            // Footer
            const Divider(color: Color(0xFF2D2D4E), height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: const Color(0xFF6366F1).withOpacity(0.2),
                    child: Text(
                      (user?.name ?? 'U').substring(0, 1).toUpperCase(),
                      style: const TextStyle(color: Color(0xFF6366F1), fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user?.name ?? 'Guest', style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
                        Text(user?.email ?? '', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 11)),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.logout, color: Color(0xFFEF4444), size: 20),
                    onPressed: () {
                      ref.read(authProvider.notifier).logout();
                      if (context.mounted) context.go('/login');
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGroup(NavGroup group, String? role, NavFlagsState navFlags, String currentLocation) {
    final isCollapsed = _groupCollapsed[group.id] ?? false;
    final visibleItems = group.items.where((i) => _isItemVisible(i, role, navFlags)).toList();
    final filteredItems = _filterBySearch(visibleItems);

    if (_searchQuery.isNotEmpty && filteredItems.isEmpty) return const SizedBox.shrink();

    final primaryItems = filteredItems.where((i) => !i.secondary).toList();
    final secondaryItems = filteredItems.where((i) => i.secondary).toList();
    final hasActive = filteredItems.any((i) => currentLocation.startsWith(i.path));
    final isMoreOpen = _moreExpanded[group.id] ?? false;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Group header
        InkWell(
          onTap: () => setState(() => _groupCollapsed[group.id] = !isCollapsed),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(group.icon, size: 16, color: hasActive ? const Color(0xFF6366F1) : const Color(0xFF64748B)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    group.label.toUpperCase(),
                    style: TextStyle(
                      color: hasActive ? const Color(0xFF6366F1) : const Color(0xFF64748B),
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                    ),
                  ),
                ),
                Icon(
                  isCollapsed ? Icons.chevron_right : Icons.expand_more,
                  size: 16,
                  color: const Color(0xFF64748B),
                ),
              ],
            ),
          ),
        ),
        // Items
        if (!isCollapsed) ...[
          ...primaryItems.map((item) => _buildNavItem(item, currentLocation)),
          if (secondaryItems.isNotEmpty) ...[
            if (isMoreOpen) ...secondaryItems.map((item) => _buildNavItem(item, currentLocation)),
            InkWell(
              onTap: () => setState(() => _moreExpanded[group.id] = !isMoreOpen),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                child: Row(
                  children: [
                    const SizedBox(width: 24),
                    Icon(isMoreOpen ? Icons.expand_less : Icons.expand_more, size: 14, color: const Color(0xFF64748B)),
                    const SizedBox(width: 6),
                    Text(
                      isMoreOpen ? 'Less' : 'More (${secondaryItems.length})',
                      style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ],
    );
  }

  Widget _buildNavItem(NavItem item, String currentLocation) {
    final isActive = currentLocation == item.path || currentLocation.startsWith('${item.path}/');

    return InkWell(
      onTap: () {
        Navigator.of(context).pop(); // close drawer
        context.go(item.path);
      },
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isActive ? const Color(0xFF6366F1).withOpacity(0.1) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Icon(
              item.icon,
              size: 18,
              color: isActive ? const Color(0xFF6366F1) : const Color(0xFF9CA3AF),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                item.label,
                style: TextStyle(
                  color: isActive ? const Color(0xFF6366F1) : const Color(0xFFE2E8F0),
                  fontSize: 13,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            if (isActive)
              Container(
                width: 6,
                height: 6,
                decoration: const BoxDecoration(
                  color: Color(0xFF6366F1),
                  shape: BoxShape.circle,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
