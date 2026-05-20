import 'package:flutter/material.dart';
import '../services/api_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<dynamic> _notifications = [];
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final data = await apiService.query('notifications.list', {'limit': 50});
      setState(() { _notifications = data as List? ?? []; _loading = false; });
    } catch (e) { setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [
        TextButton(onPressed: () async { await apiService.mutate('notifications.markAllRead', {}); _load(); }, child: const Text('Mark all read')),
      ]),
      body: _loading ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _notifications.isEmpty ? const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Text('🔔', style: TextStyle(fontSize: 48)),
              SizedBox(height: 12),
              Text('No notifications', style: TextStyle(color: Color(0xFF6B7280))),
            ]))
          : ListView.builder(
              itemCount: _notifications.length,
              itemBuilder: (ctx, i) {
                final n = _notifications[i] as Map<String, dynamic>;
                final unread = n['isRead'] != true;
                return ListTile(
                  tileColor: unread ? const Color(0xFF1A1A2E) : null,
                  leading: Text({'transfer': '💸', 'kyc': '🪪', 'fx_alert': '📈', 'payout': '💰'}[n['type']] ?? 'ℹ️', style: const TextStyle(fontSize: 24)),
                  title: Text(n['title']?.toString() ?? '', style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                  subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(n['body']?.toString() ?? '', style: const TextStyle(color: Color(0xFF9CA3AF)), maxLines: 2),
                    Text(n['createdAt']?.toString().substring(0, 10) ?? '', style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
                  ]),
                  trailing: unread ? Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFF6366F1), shape: BoxShape.circle)) : null,
                  onTap: () async { if (unread) { await apiService.mutate('notifications.markRead', {'id': n['id']}); _load(); } },
                );
              },
            ),
    );
  }
}
