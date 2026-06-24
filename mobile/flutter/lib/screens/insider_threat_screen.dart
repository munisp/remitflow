import 'package:flutter/material.dart';

/// Insider Threat Controls Screen (Flutter)
///
/// Provides mobile-optimized views for:
/// - Maker-Checker approval workflow
/// - JIT access request/revoke
/// - WebAuthn/FIDO2 key management (via platform authenticator)
/// - Security alerts (canary trips, DLP blocks)
/// - Geo/time fence status
class InsiderThreatScreen extends StatefulWidget {
  const InsiderThreatScreen({super.key});

  @override
  State<InsiderThreatScreen> createState() => _InsiderThreatScreenState();
}

class _InsiderThreatScreenState extends State<InsiderThreatScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Security Controls'),
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: const [
            Tab(text: 'Approvals'),
            Tab(text: 'JIT Access'),
            Tab(text: 'Alerts'),
            Tab(text: 'Keys'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _MakerCheckerTab(),
          _JITAccessTab(),
          _AlertsTab(),
          _SecurityKeysTab(),
        ],
      ),
    );
  }
}

// ─── Maker-Checker Tab ───────────────────────────────────────────────────────

class _MakerCheckerTab extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StatusBanner(
          icon: Icons.security,
          title: 'Dual Authorization Required',
          subtitle:
              'Operations above threshold require approval from a second admin.',
          color: Colors.blue,
        ),
        const SizedBox(height: 16),
        _PendingApprovalCard(
          operationType: 'Transfer Reversal',
          amount: '\$75,000',
          requestedBy: 'User #42',
          riskScore: 65,
          timeAgo: '1 hour ago',
          approvalsNeeded: 2,
          currentApprovals: 1,
        ),
        const SizedBox(height: 12),
        _PendingApprovalCard(
          operationType: 'FX Rate Override',
          amount: 'USD/NGN → 1550.00',
          requestedBy: 'User #15',
          riskScore: 85,
          timeAgo: '2 hours ago',
          approvalsNeeded: 2,
          currentApprovals: 0,
        ),
      ],
    );
  }
}

class _PendingApprovalCard extends StatelessWidget {
  final String operationType;
  final String amount;
  final String requestedBy;
  final int riskScore;
  final String timeAgo;
  final int approvalsNeeded;
  final int currentApprovals;

  const _PendingApprovalCard({
    required this.operationType,
    required this.amount,
    required this.requestedBy,
    required this.riskScore,
    required this.timeAgo,
    required this.approvalsNeeded,
    required this.currentApprovals,
  });

  Color get _riskColor {
    if (riskScore >= 70) return Colors.red;
    if (riskScore >= 40) return Colors.orange;
    return Colors.green;
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  operationType,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 16),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: _riskColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: _riskColor.withOpacity(0.3)),
                  ),
                  child: Text(
                    'Risk: $riskScore',
                    style: TextStyle(
                        color: _riskColor,
                        fontSize: 12,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(amount, style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 4),
            Text(
              '$requestedBy • $timeAgo • Approvals: $currentApprovals/$approvalsNeeded',
              style: TextStyle(color: Colors.grey[600], fontSize: 12),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {},
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green[600],
                      foregroundColor: Colors.white,
                    ),
                    child: const Text('Approve'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {},
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red[600],
                      side: BorderSide(color: Colors.red[300]!),
                    ),
                    child: const Text('Reject'),
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

// ─── JIT Access Tab ──────────────────────────────────────────────────────────

class _JITAccessTab extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StatusBanner(
          icon: Icons.timer,
          title: 'Just-In-Time Privileges',
          subtitle: 'Request temporary elevated access (max 2 hours, 3/day).',
          color: Colors.purple,
        ),
        const SizedBox(height: 16),
        _JITRequestForm(),
        const SizedBox(height: 24),
        const Text('Active Grants',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),
        _ActiveGrantCard(
          privilege: 'Bulk Export',
          userId: 7,
          expiresIn: '90 minutes',
          actionsPerformed: 3,
        ),
      ],
    );
  }
}

class _JITRequestForm extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Request Elevated Access',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              decoration: const InputDecoration(
                labelText: 'Privilege',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(
                    value: 'admin_panel', child: Text('Admin Panel')),
                DropdownMenuItem(
                    value: 'bulk_export', child: Text('Bulk Export')),
                DropdownMenuItem(
                    value: 'user_management', child: Text('User Management')),
                DropdownMenuItem(
                    value: 'fx_override', child: Text('FX Override')),
                DropdownMenuItem(
                    value: 'system_config', child: Text('System Config')),
              ],
              onChanged: (v) {},
            ),
            const SizedBox(height: 12),
            TextFormField(
              decoration: const InputDecoration(
                labelText: 'Duration (minutes)',
                border: OutlineInputBorder(),
                hintText: '15-120',
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            TextFormField(
              decoration: const InputDecoration(
                labelText: 'Reason',
                border: OutlineInputBorder(),
                hintText: 'Why do you need elevated access?',
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {},
                child: const Text('Request Access'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActiveGrantCard extends StatelessWidget {
  final String privilege;
  final int userId;
  final String expiresIn;
  final int actionsPerformed;

  const _ActiveGrantCard({
    required this.privilege,
    required this.userId,
    required this.expiresIn,
    required this.actionsPerformed,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.blue[50],
      child: ListTile(
        leading: const Icon(Icons.vpn_key, color: Colors.blue),
        title: Text(privilege),
        subtitle: Text(
            'User #$userId • Expires: $expiresIn • Actions: $actionsPerformed'),
        trailing: TextButton(
          onPressed: () {},
          child: const Text('Revoke', style: TextStyle(color: Colors.red)),
        ),
      ),
    );
  }
}

// ─── Alerts Tab ──────────────────────────────────────────────────────────────

class _AlertsTab extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StatusBanner(
          icon: Icons.warning_amber,
          title: 'Security Alerts',
          subtitle: 'Canary tokens, DLP blocks, and anomaly detections.',
          color: Colors.orange,
        ),
        const SizedBox(height: 16),
        _AlertCard(
          severity: 'warning',
          title: 'DLP Block: Bulk PII Access',
          detail: 'User #23 attempted to access 500 records from users table.',
          time: '10 minutes ago',
        ),
        const SizedBox(height: 12),
        _AlertCard(
          severity: 'info',
          title: 'Admin Anomaly Detected',
          detail:
              'User #8 performed 15 bulk queries this hour (baseline: 2/hour).',
          time: '25 minutes ago',
        ),
        const SizedBox(height: 24),
        const Text('Canary Token Status',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),
        ...[
          'users',
          'wallets',
          'transactions',
          'kyc_documents',
          'agent_network'
        ].map(
          (table) => _CanaryStatusTile(table: table, tripCount: 0),
        ),
      ],
    );
  }
}

class _AlertCard extends StatelessWidget {
  final String severity;
  final String title;
  final String detail;
  final String time;

  const _AlertCard({
    required this.severity,
    required this.title,
    required this.detail,
    required this.time,
  });

  @override
  Widget build(BuildContext context) {
    final color = severity == 'critical'
        ? Colors.red
        : severity == 'warning'
            ? Colors.orange
            : Colors.blue;
    return Card(
      child: ListTile(
        leading: Icon(
          severity == 'critical'
              ? Icons.error
              : severity == 'warning'
                  ? Icons.warning
                  : Icons.info,
          color: color,
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(detail, style: const TextStyle(fontSize: 12)),
            Text(time,
                style: TextStyle(fontSize: 11, color: Colors.grey[500])),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}

class _CanaryStatusTile extends StatelessWidget {
  final String table;
  final int tripCount;

  const _CanaryStatusTile({required this.table, required this.tripCount});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: CircleAvatar(
        radius: 8,
        backgroundColor: tripCount > 0 ? Colors.red : Colors.green,
      ),
      title: Text(table, style: const TextStyle(fontFamily: 'monospace')),
      subtitle: Text('Record #9999 • Trips: $tripCount'),
      dense: true,
    );
  }
}

// ─── Security Keys Tab ───────────────────────────────────────────────────────

class _SecurityKeysTab extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StatusBanner(
          icon: Icons.fingerprint,
          title: 'Hardware Security Keys',
          subtitle:
              'Register FIDO2/WebAuthn keys for high-risk operations. Uses platform authenticator on mobile.',
          color: Colors.teal,
        ),
        const SizedBox(height: 16),
        _SecurityKeyCard(
          name: 'Platform Biometric',
          type: 'Face ID / Fingerprint',
          lastUsed: '2 hours ago',
          registeredAt: 'Jan 15, 2024',
        ),
        const SizedBox(height: 12),
        _SecurityKeyCard(
          name: 'YubiKey 5 NFC',
          type: 'USB-A / NFC',
          lastUsed: '5 days ago',
          registeredAt: 'Jan 20, 2024',
        ),
        const SizedBox(height: 24),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.add),
            label: const Text('Register New Key'),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ),
      ],
    );
  }
}

class _SecurityKeyCard extends StatelessWidget {
  final String name;
  final String type;
  final String lastUsed;
  final String registeredAt;

  const _SecurityKeyCard({
    required this.name,
    required this.type,
    required this.lastUsed,
    required this.registeredAt,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Color(0xFFE8F5E9),
          child: Icon(Icons.vpn_key, color: Colors.green),
        ),
        title: Text(name),
        subtitle: Text('$type • Last used: $lastUsed\nRegistered: $registeredAt'),
        isThreeLine: true,
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline, color: Colors.red),
          onPressed: () {},
        ),
      ),
    );
  }
}

// ─── Shared Widgets ──────────────────────────────────────────────────────────

class _StatusBanner extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;

  const _StatusBanner({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: color,
                        fontSize: 14)),
                const SizedBox(height: 4),
                Text(subtitle,
                    style: TextStyle(
                        color: Colors.grey[700], fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
