import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class DiasporaUSAScreen extends ConsumerStatefulWidget {
  const DiasporaUSAScreen({super.key});
  @override
  ConsumerState<DiasporaUSAScreen> createState() => _DiasporaUSAScreenState();
}

class _DiasporaUSAScreenState extends ConsumerState<DiasporaUSAScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('/trpc/diasporaUSA.list');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text(
          'Diaspora USA',
          style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700),
        ),
        iconTheme: const IconThemeData(color: Color(0xFFE2E8F0)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFFE2E8F0)),
            onPressed: _load,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6C63FF)))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, color: Colors.red, size: 48),
                      const SizedBox(height: 16),
                      Text(_error!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _load,
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6C63FF)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : _items.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.flag, color: const Color(0xFF6C63FF), size: 64),
                          const SizedBox(height: 16),
                          const Text(
                            'No Diaspora USA data yet',
                            style: TextStyle(color: Color(0xFF94A3B8), fontSize: 16),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: const Color(0xFF6C63FF).withOpacity(0.2),
                              child: Icon(Icons.flag, color: const Color(0xFF6C63FF), size: 20),
                            ),
                            title: Text(
                              item['state']?.toString() ?? item['name']?.toString() ?? 'Item ${index + 1}',
                              style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              item['status']?.toString() ?? item['description']?.toString() ?? '',
                              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                            ),
                            trailing: const Icon(Icons.chevron_right, color: Color(0xFF64748B)),
                            onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Details coming soon')),
                            ),
                          ),
                        );
                      },
                    ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: const Color(0xFF6C63FF),
        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Create feature coming soon')),
        ),
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
}
