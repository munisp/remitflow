import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'package:intl/intl.dart'; // For currency formatting

class DiasporaBondMarketScreen extends ConsumerStatefulWidget {
  const DiasporaBondMarketScreen({super.key});
  @override
  ConsumerState<DiasporaBondMarketScreen> createState() => _DiasporaBondMarketScreenState();
}
class _DiasporaBondMarketScreenState extends ConsumerState<DiasporaBondMarketScreen> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;
  
  @override
  void initState() { super.initState(); _load(); }
  
  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      // Using a tRPC route specific to Diaspora Bond Market
      final result = await api.get('/trpc/diasporaBondMarket.list');
      setState(() { _items = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) { setState(() { _error = e.toString(); _isLoading = false; }); }
  }
  
  @override
  Widget build(BuildContext context) {
    final currencyFormat = NumberFormat.currency(symbol: '$', decimalDigits: 2); // Assuming USD for now
    final percentFormat = NumberFormat.decimalPercentPattern(decimalDigits: 2); // For interest rates

    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Diaspora Bond Market', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Color(0xFFE2E8F0)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6C63FF)))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : _items.isEmpty
                  ? const Center(child: Text('No bonds available', style: TextStyle(color: Color(0xFF94A3B8))))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        final String bondName = item['name']?.toString() ?? 'Bond ${index + 1}';
                        final String issuer = item['issuer']?.toString() ?? 'Unknown Issuer';
                        final String maturityDate = item['maturityDate']?.toString() ?? 'N/A';
                        final double interestRate = (item['interestRate'] as num?)?.toDouble() ?? 0.0;
                        final double currentPrice = (item['currentPrice'] as num?)?.toDouble() ?? 0.0;

                        return Card(
                          color: const Color(0xFF1A1A2E),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: ListTile(
                            title: Text(bondName,
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600)),
                            subtitle: Text('$issuer - Maturity: $maturityDate',
                                style: const TextStyle(color: Color(0xFF94A3B8))),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(percentFormat.format(interestRate),
                                    style: const TextStyle(color: Color(0xFF6C63FF), fontWeight: FontWeight.w600)),
                                Text(currencyFormat.format(currentPrice),
                                    style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 12)),
                              ],
                            ),
                            onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Tapped on $bondName'))),
                          ),
                        );
                      },
                    ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: const Color(0xFF6C63FF),
        onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Feature coming soon'))),
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
}
