import 'package:flutter/material.dart';
import '../services/api_service.dart';

class RecipientOnboardingScreen extends StatefulWidget {
  const RecipientOnboardingScreen({super.key});
  @override
  State<RecipientOnboardingScreen> createState() => _RecipientOnboardingScreenState();
}

class _RecipientOnboardingScreenState extends State<RecipientOnboardingScreen> {
  List<dynamic> _items = [];
  bool _loading = true;
  String _search = '';
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await apiService.query('recipient.listRecipients');
      setState(() {
        _items = (data is List ? data : (data['items'] as List? ?? []));
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  List<dynamic> get _filtered {
    if (_search.isEmpty) return _items;
    final q = _search.toLowerCase();
    return _items.where((item) => item.toString().toLowerCase().contains(q)).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Recipients', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Colors.white),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: TextField(
              onChanged: (v) => setState(() => _search = v),
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Search Recipients...',
                hintStyle: const TextStyle(color: Color(0xFF64748B)),
                filled: true,
                fillColor: const Color(0xFF0F172A),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                prefixIcon: const Icon(Icons.search, color: Color(0xFF64748B)),
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
                  const SizedBox(height: 12),
                  Text('Failed to load Recipients', style: const TextStyle(color: Color(0xFFEF4444))),
                  const SizedBox(height: 12),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : _filtered.isEmpty
                  ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Text('📋', style: TextStyle(fontSize: 48)),
                      const SizedBox(height: 12),
                      Text(_search.isNotEmpty ? 'No results found.' : 'No Recipients yet.',
                          style: const TextStyle(color: Color(0xFF64748B), fontSize: 15)),
                    ]))
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: const Color(0xFF6366F1),
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _filtered.length,
                        itemBuilder: (ctx, i) {
                          final item = _filtered[i] as Map<String, dynamic>;
                          final entries = item.entries.where((e) => e.key != '__typename').take(5).toList();
                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1E293B),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: const Color(0xFF334155)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: entries.map((e) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 2),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    SizedBox(width: 120, child: Text(
                                      e.key.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[0]}').trim(),
                                      style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                                    )),
                                    Expanded(child: Text(
                                      e.value?.toString() ?? '—',
                                      style: const TextStyle(color: Colors.white, fontSize: 12),
                                      maxLines: 1, overflow: TextOverflow.ellipsis,
                                    )),
                                  ],
                                ),
                              )).toList(),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
