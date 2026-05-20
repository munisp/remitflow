import 'package:flutter/material.dart';
import '../services/api_service.dart';

class FormalizationDashboardScreen extends StatefulWidget {
  const FormalizationDashboardScreen({super.key});
  @override
  State<FormalizationDashboardScreen> createState() => _FormalizationDashboardScreenState();
}

class _FormalizationDashboardScreenState extends State<FormalizationDashboardScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await apiService.query('formalization.getDashboard');
      setState(() {
        _data = data is Map<String, dynamic> ? data : {};
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String _renderValue(dynamic v) {
    if (v == null) return '—';
    if (v is Map || v is List) return v.toString().length > 80 ? '${v.toString().substring(0, 80)}...' : v.toString();
    return v.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Formalization Dashboard', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(icon: const Icon(Icons.refresh, color: Colors.white), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
                  const SizedBox(height: 12),
                  Text('Failed to load Formalization Dashboard', style: const TextStyle(color: Color(0xFFEF4444))),
                  const SizedBox(height: 12),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : _data == null || _data!.isEmpty
                  ? const Center(child: Text('No data available.', style: TextStyle(color: Color(0xFF64748B))))
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: const Color(0xFF6366F1),
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: _data!.entries.map((e) => Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E293B),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFF334155)),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SizedBox(width: 140, child: Text(
                                e.key.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[0]}').trim(),
                                style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                              )),
                              Expanded(child: Text(
                                _renderValue(e.value),
                                style: const TextStyle(color: Colors.white, fontSize: 13),
                                maxLines: 3, overflow: TextOverflow.ellipsis,
                              )),
                            ],
                          ),
                        )).toList(),
                      ),
                    ),
    );
  }
}
