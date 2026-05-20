/// RemitFlow Mobile — PBAC Policies Screen (Flutter)
/// Displays the 14 PBAC policies and deny event log for admin users.
library;

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

// ─── Data models ──────────────────────────────────────────────────────────────

class PbacPolicy {
  final String id, name, resource, action;
  final List<String> conditions;
  final double? maxAmount;
  final bool requiresMfa, enabled;

  const PbacPolicy({
    required this.id,
    required this.name,
    required this.resource,
    required this.action,
    required this.conditions,
    this.maxAmount,
    this.requiresMfa = false,
    this.enabled = true,
  });
}

class DenyEvent {
  final int id, userId;
  final String policy, resource, reason, createdAt;

  const DenyEvent({
    required this.id,
    required this.userId,
    required this.policy,
    required this.resource,
    required this.reason,
    required this.createdAt,
  });

  factory DenyEvent.fromJson(Map<String, dynamic> j) => DenyEvent(
    id: j['id'] as int,
    userId: j['userId'] as int,
    policy: j['policy'] as String,
    resource: j['resource'] as String? ?? '',
    reason: j['reason'] as String? ?? '',
    createdAt: j['createdAt'] as String? ?? '',
  );
}

// ─── Static policy reference (mirrors server/pbac.ts) ─────────────────────────

const _policies = [
  PbacPolicy(id: 'transfer.send', name: 'Transfer Send', resource: 'transfer', action: 'send', conditions: ['KYC verified', 'Daily limit check', 'Anomaly score < 0.85'], maxAmount: 10000),
  PbacPolicy(id: 'wallet.withdraw', name: 'Wallet Withdraw', resource: 'wallet', action: 'withdraw', conditions: ['KYC tier limit', 'Balance check', 'Fraud score < 0.7'], maxAmount: 5000),
  PbacPolicy(id: 'kyc.approve', name: 'KYC Approve', resource: 'kyc', action: 'approve', conditions: ['Admin role', '2FA within 15 min'], requiresMfa: true),
  PbacPolicy(id: 'transactions.export', name: 'Transactions Export', resource: 'transactions', action: 'export', conditions: ['Admin or compliance role', 'Audit logged']),
  PbacPolicy(id: 'beneficiaries.update', name: 'Beneficiary Update', resource: 'beneficiaries', action: 'update', conditions: ['Rate limit: 10/hour', 'Velocity check']),
  PbacPolicy(id: 'admin.impersonate', name: 'Admin Impersonate', resource: 'admin', action: 'impersonate', conditions: ['Admin role', '2FA within 15 min', 'Audit logged'], requiresMfa: true),
  PbacPolicy(id: 'admin.enforce2fa', name: 'Enforce 2FA Policy', resource: 'admin', action: 'enforce2fa', conditions: ['Admin role', '2FA within 15 min'], requiresMfa: true),
  PbacPolicy(id: 'batch.send', name: 'Batch Send', resource: 'batch', action: 'send', conditions: ['KYC tier 2+', 'Max 100 recipients'], maxAmount: 50000),
  PbacPolicy(id: 'card.issue', name: 'Card Issue', resource: 'card', action: 'issue', conditions: ['KYC verified', 'No active freeze']),
  PbacPolicy(id: 'savings.withdraw', name: 'Savings Withdraw', resource: 'savings', action: 'withdraw', conditions: ['Goal maturity check', 'Penalty calculation']),
  PbacPolicy(id: 'compliance.report', name: 'Compliance Report', resource: 'compliance', action: 'report', conditions: ['Compliance role', 'Date range limit 90d']),
  PbacPolicy(id: 'partner.payout', name: 'Partner Payout', resource: 'partner', action: 'payout', conditions: ['Partner role', 'Verified tenant'], maxAmount: 100000),
  PbacPolicy(id: 'fx.lock', name: 'FX Rate Lock', resource: 'fx', action: 'lock', conditions: ['KYC verified', 'Max 60s lock']),
  PbacPolicy(id: 'virtual.account', name: 'Virtual Account', resource: 'virtual', action: 'create', conditions: ['KYC tier 1+', 'Max 5 per user']),
];

// ─── Screen ───────────────────────────────────────────────────────────────────

class PBACPoliciesScreen extends StatefulWidget {
  const PBACPoliciesScreen({Key? key}) : super(key: key);

  @override
  State<PBACPoliciesScreen> createState() => _PBACPoliciesScreenState();
}

class _PBACPoliciesScreenState extends State<PBACPoliciesScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<DenyEvent> _denyEvents = [];
  bool _loading = false;
  String _search = '';
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadDenyEvents();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadDenyEvents() async {
    setState(() => _loading = true);
    try {
      final res = await http.get(
        Uri.parse('https://remitflow.manus.space/api/trpc/pbac.getDenyEvents?input={"limit":20}'),
        headers: {'Content-Type': 'application/json'},
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final json = jsonDecode(res.body) as Map<String, dynamic>;
        final events = (json['result']?['data'] as List? ?? [])
            .map((e) => DenyEvent.fromJson(e as Map<String, dynamic>))
            .toList();
        setState(() => _denyEvents = events);
      }
    } catch (e) {
      debugPrint('Error loading deny events: $e');
    } finally {
      setState(() => _loading = false);
    }
  }

  List<PbacPolicy> get _filteredPolicies => _policies
      .where((p) => p.name.toLowerCase().contains(_search.toLowerCase()) || p.resource.toLowerCase().contains(_search.toLowerCase()))
      .toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFf8fafc),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 1,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF3b82f6)),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text('PBAC Policies', style: TextStyle(color: Color(0xFF0f172a), fontSize: 18, fontWeight: FontWeight.w700)),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: const Color(0xFFf1f5f9), borderRadius: BorderRadius.circular(10)),
            child: Text('${_policies.length} policies', style: const TextStyle(fontSize: 12, color: Color(0xFF64748b))),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFF3b82f6),
          unselectedLabelColor: const Color(0xFF64748b),
          indicatorColor: const Color(0xFF3b82f6),
          tabs: const [Tab(text: 'Policies'), Tab(text: 'Deny Events')],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildPoliciesTab(),
          _buildDenyEventsTab(),
        ],
      ),
    );
  }

  Widget _buildPoliciesTab() => Column(
    children: [
      Padding(
        padding: const EdgeInsets.all(12),
        child: TextField(
          controller: _searchController,
          onChanged: (v) => setState(() => _search = v),
          decoration: InputDecoration(
            hintText: 'Search policies...',
            prefixIcon: const Icon(Icons.search, size: 18),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFe2e8f0))),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
        ),
      ),
      Expanded(
        child: ListView.builder(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          itemCount: _filteredPolicies.length,
          itemBuilder: (ctx, i) => _buildPolicyCard(_filteredPolicies[i]),
        ),
      ),
    ],
  );

  Widget _buildPolicyCard(PbacPolicy p) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 3)],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(p.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF0f172a)))),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(color: p.enabled ? const Color(0xFFdcfce7) : const Color(0xFFfee2e2), borderRadius: BorderRadius.circular(10)),
              child: Text(p.enabled ? 'Active' : 'Disabled', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: p.enabled ? const Color(0xFF15803d) : const Color(0xFF991b1b))),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(p.id, style: const TextStyle(fontSize: 11, color: Color(0xFF94a3b8), fontFamily: 'monospace')),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            _metaChip('Resource: ${p.resource}'),
            _metaChip('Action: ${p.action}'),
            if (p.maxAmount != null) _metaChip('Max: \$${p.maxAmount!.toStringAsFixed(0)}'),
            if (p.requiresMfa) _metaChip('Requires 2FA', color: const Color(0xFF7c3aed)),
          ],
        ),
        const SizedBox(height: 8),
        const Text('Conditions:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF64748b))),
        ...p.conditions.map((c) => Text('• $c', style: const TextStyle(fontSize: 12, color: Color(0xFF475569)))),
      ],
    ),
  );

  Widget _metaChip(String text, {Color? color}) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(color: const Color(0xFFf1f5f9), borderRadius: BorderRadius.circular(4)),
    child: Text(text, style: TextStyle(fontSize: 12, color: color ?? const Color(0xFF475569))),
  );

  Widget _buildDenyEventsTab() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_denyEvents.isEmpty) return const Center(child: Text('No deny events recorded', style: TextStyle(color: Color(0xFF94a3b8))));
    return RefreshIndicator(
      onRefresh: _loadDenyEvents,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _denyEvents.length,
        itemBuilder: (ctx, i) => _buildDenyCard(_denyEvents[i]),
      ),
    );
  }

  Widget _buildDenyCard(DenyEvent e) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      border: const Border(left: BorderSide(color: Color(0xFFef4444), width: 3)),
      boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 3)],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(e.policy, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF0f172a)))),
            Text(e.createdAt.isNotEmpty ? e.createdAt.substring(11, 19) : '', style: const TextStyle(fontSize: 11, color: Color(0xFF94a3b8))),
          ],
        ),
        Text('Resource: ${e.resource}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748b))),
        Text(e.reason, style: const TextStyle(fontSize: 12, color: Color(0xFFef4444))),
        Text('User #${e.userId}', style: const TextStyle(fontSize: 11, color: Color(0xFF94a3b8))),
      ],
    ),
  );
}
