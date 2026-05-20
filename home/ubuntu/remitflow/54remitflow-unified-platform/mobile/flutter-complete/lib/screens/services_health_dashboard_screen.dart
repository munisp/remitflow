/// RemitFlow Mobile — Services Health Dashboard Screen (Flutter)
/// Displays live health status of all 50 microservices via WebSocket feed.
library;

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

// ─── Data models ──────────────────────────────────────────────────────────────

enum ServiceStatus { healthy, degraded, unavailable }

ServiceStatus _parseStatus(String s) {
  switch (s) {
    case 'healthy': return ServiceStatus.healthy;
    case 'degraded': return ServiceStatus.degraded;
    default: return ServiceStatus.unavailable;
  }
}

class ServiceHealth {
  final String name;
  final String url;
  final ServiceStatus status;
  final int? latencyMs;
  final String? error;

  const ServiceHealth({
    required this.name,
    required this.url,
    required this.status,
    this.latencyMs,
    this.error,
  });

  factory ServiceHealth.fromJson(Map<String, dynamic> j) => ServiceHealth(
    name: j['name'] as String,
    url: j['url'] as String,
    status: _parseStatus(j['status'] as String),
    latencyMs: j['latencyMs'] as int?,
    error: j['error'] as String?,
  );
}

class HealthSummary {
  final int total, healthy, degraded, unavailable;
  final String status;
  const HealthSummary({required this.total, required this.healthy, required this.degraded, required this.unavailable, required this.status});
  factory HealthSummary.fromJson(Map<String, dynamic> j) => HealthSummary(
    total: j['total'] as int,
    healthy: j['healthy'] as int,
    degraded: j['degraded'] as int,
    unavailable: j['unavailable'] as int,
    status: j['status'] as String,
  );
}

class CircuitTrip {
  final String service, previousStatus, currentStatus, timestamp;
  const CircuitTrip({required this.service, required this.previousStatus, required this.currentStatus, required this.timestamp});
  factory CircuitTrip.fromJson(Map<String, dynamic> j) => CircuitTrip(
    service: j['service'] as String,
    previousStatus: j['previousStatus'] as String,
    currentStatus: j['currentStatus'] as String,
    timestamp: j['timestamp'] as String,
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

class ServicesHealthDashboardScreen extends StatefulWidget {
  const ServicesHealthDashboardScreen({Key? key}) : super(key: key);

  @override
  State<ServicesHealthDashboardScreen> createState() => _ServicesHealthDashboardScreenState();
}

class _ServicesHealthDashboardScreenState extends State<ServicesHealthDashboardScreen> {
  static const _wsUrl = 'wss://remitflow.manus.space/ws/services-health';

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;

  List<ServiceHealth> _services = [];
  HealthSummary? _summary;
  List<CircuitTrip> _trips = [];
  String _wsStatus = 'connecting'; // connecting | open | closed
  DateTime? _lastUpdate;
  String _search = '';
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _connect();
  }

  void _connect() {
    _channel?.sink.close();
    _sub?.cancel();
    setState(() => _wsStatus = 'connecting');

    try {
      _channel = WebSocketChannel.connect(Uri.parse(_wsUrl));
      setState(() => _wsStatus = 'open');

      _sub = _channel!.stream.listen(
        (data) {
          final msg = jsonDecode(data as String) as Map<String, dynamic>;
          if (msg['type'] == 'health_update') {
            setState(() {
              _services = (msg['services'] as List).map((s) => ServiceHealth.fromJson(s as Map<String, dynamic>)).toList();
              _summary = HealthSummary.fromJson(msg['summary'] as Map<String, dynamic>);
              _lastUpdate = DateTime.parse(msg['timestamp'] as String);
            });
          } else if (msg['type'] == 'circuit_trip') {
            setState(() {
              _trips = [CircuitTrip.fromJson(msg), ..._trips].take(50).toList();
            });
          }
        },
        onError: (_) => _scheduleReconnect(),
        onDone: () => _scheduleReconnect(),
      );
    } catch (e) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    setState(() => _wsStatus = 'closed');
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), _connect);
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _searchController.dispose();
    super.dispose();
  }

  Color _statusColor(ServiceStatus s) {
    switch (s) {
      case ServiceStatus.healthy: return const Color(0xFF22c55e);
      case ServiceStatus.degraded: return const Color(0xFFeab308);
      case ServiceStatus.unavailable: return const Color(0xFFef4444);
    }
  }

  Color _statusBg(String s) {
    switch (s) {
      case 'healthy': return const Color(0xFFf0fdf4);
      case 'degraded': return const Color(0xFFfefce8);
      default: return const Color(0xFFfef2f2);
    }
  }

  Color _statusFg(String s) {
    switch (s) {
      case 'healthy': return const Color(0xFF15803d);
      case 'degraded': return const Color(0xFF854d0e);
      default: return const Color(0xFF991b1b);
    }
  }

  List<ServiceHealth> get _filtered => _services
      .where((s) => s.name.toLowerCase().contains(_search.toLowerCase()))
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
        title: const Text('Services Health', style: TextStyle(color: Color(0xFF0f172a), fontSize: 18, fontWeight: FontWeight.w700)),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: _wsStatus == 'open' ? const Color(0xFF22c55e22) : const Color(0xFFef444422),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              _wsStatus == 'open' ? 'Live' : _wsStatus == 'connecting' ? 'Connecting' : 'Reconnecting',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _wsStatus == 'open' ? const Color(0xFF22c55e) : const Color(0xFFef4444)),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          _channel?.sink.add(jsonEncode({'type': 'ping'}));
          await Future.delayed(const Duration(seconds: 1));
        },
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            // Summary row
            if (_summary != null) _buildSummaryRow(),
            const SizedBox(height: 12),

            // Status banner
            if (_summary != null) _buildStatusBanner(),
            const SizedBox(height: 12),

            // Circuit trips
            if (_trips.isNotEmpty) _buildTripsCard(),
            if (_trips.isNotEmpty) const SizedBox(height: 12),

            // Search
            TextField(
              controller: _searchController,
              onChanged: (v) => setState(() => _search = v),
              decoration: InputDecoration(
                hintText: 'Search services...',
                prefixIcon: const Icon(Icons.search, size: 18),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFe2e8f0))),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            ),
            const SizedBox(height: 12),

            // Services
            Text('Services (${_filtered.length})', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF0f172a))),
            const SizedBox(height: 8),
            if (_wsStatus == 'connecting' && _services.isEmpty)
              const Center(child: CircularProgressIndicator())
            else
              ..._filtered.map(_buildServiceCard),

            if (_lastUpdate != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text('Last updated: ${_lastUpdate!.toLocal().toString().substring(11, 19)}',
                    textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: Color(0xFF94a3b8))),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryRow() {
    final s = _summary!;
    return Row(
      children: [
        _summaryCard('Total', s.total.toString(), const Color(0xFF3b82f6)),
        const SizedBox(width: 8),
        _summaryCard('Healthy', s.healthy.toString(), const Color(0xFF22c55e)),
        const SizedBox(width: 8),
        _summaryCard('Degraded', s.degraded.toString(), const Color(0xFFeab308)),
        const SizedBox(width: 8),
        _summaryCard('Down', s.unavailable.toString(), const Color(0xFFef4444)),
      ],
    );
  }

  Widget _summaryCard(String label, String value, Color color) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border(top: BorderSide(color: color, width: 3)),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 4)],
      ),
      child: Column(
        children: [
          Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: color == const Color(0xFF3b82f6) ? const Color(0xFF0f172a) : color)),
          Text(label, style: const TextStyle(fontSize: 10, color: Color(0xFF64748b))),
        ],
      ),
    ),
  );

  Widget _buildStatusBanner() {
    final s = _summary!;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _statusBg(s.status),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _statusFg(s.status).withOpacity(0.3)),
      ),
      child: Text(
        'Platform Status: ${s.status.toUpperCase()} — ${s.healthy}/${s.total} services healthy',
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _statusFg(s.status)),
      ),
    );
  }

  Widget _buildTripsCard() => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: const Color(0xFFfed7aa)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Circuit-Breaker Events (${_trips.length})', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFea580c))),
        const SizedBox(height: 8),
        ..._trips.take(5).map((t) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(
            children: [
              Text(DateTime.parse(t.timestamp).toLocal().toString().substring(11, 19), style: const TextStyle(fontSize: 11, color: Color(0xFF94a3b8), width: 70)),
              Expanded(child: Text(t.service, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500))),
              Text('${t.previousStatus} → ${t.currentStatus}', style: const TextStyle(fontSize: 11, color: Color(0xFF64748b))),
            ],
          ),
        )),
      ],
    ),
  );

  Widget _buildServiceCard(ServiceHealth svc) {
    final color = _statusColor(svc.status);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border(left: BorderSide(color: color, width: 4)),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 3)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
              const SizedBox(width: 8),
              Expanded(child: Text(svc.name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF0f172a)))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(10)),
                child: Text(svc.status.name, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(svc.url, style: const TextStyle(fontSize: 11, color: Color(0xFF94a3b8), fontFamily: 'monospace'), overflow: TextOverflow.ellipsis),
          if (svc.latencyMs != null)
            Text('${svc.latencyMs}ms', style: const TextStyle(fontSize: 11, color: Color(0xFF64748b))),
        ],
      ),
    );
  }
}
