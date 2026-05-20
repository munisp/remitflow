import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// Define custom colors for the dark theme
class AppColors {
  static const Color background = Color(0xFF0F0F1A);
  static const Color card = Color(0xFF1A1A2E);
  static const Color accent = Color(0xFF6366F1);
  static const Color text = Color(0xFFE2E8F0);
  static const Color muted = Color(0xFF9CA3AF);
  static const Color border = Color(0xFF2D2D4E);
}

// Provider for bond orders (example, will be replaced with actual API calls)
final bondOrdersProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  // Simulate API call
  await Future.delayed(const Duration(seconds: 2));
  // Replace with actual tRPC call: apiService.bondSecondaryMarket.listOpenOrders.query()
  return []; // Empty for now
});

class BondSecondaryMarketScreen extends ConsumerStatefulWidget {
  const BondSecondaryMarketScreen({super.key});

  @override
  ConsumerState<BondSecondaryMarketScreen> createState() => _BondSecondaryMarketScreenState();
}

class _BondSecondaryMarketScreenState extends ConsumerState<BondSecondaryMarketScreen> {
  @override
  Widget build(BuildContext context) {
    final bondOrdersAsyncValue = ref.watch(bondOrdersProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Bond Secondary Market', style: TextStyle(color: AppColors.text)),
        backgroundColor: AppColors.background,
        iconTheme: const IconThemeData(color: AppColors.accent), // Colored icon theme
      ),
      body: bondOrdersAsyncValue.when(
        loading: () => const Center(child: CircularProgressIndicator(color: AppColors.accent)),
        error: (err, stack) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Error: $err', style: const TextStyle(color: AppColors.text)),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () => ref.invalidate(bondOrdersProvider),
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.accent),
                child: const Text('Retry', style: TextStyle(color: AppColors.text)),
              ),
            ],
          ),
        ),
        data: (bondOrders) {
          if (bondOrders.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('📊', style: TextStyle(fontSize: 48)),
                  const SizedBox(height: 16),
                  const Text('No open bond orders found.', style: TextStyle(color: AppColors.muted, fontSize: 16)),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(bondOrdersProvider);
              await ref.read(bondOrdersProvider.future);
            },
            color: AppColors.accent,
            backgroundColor: AppColors.card,
            child: ListView.builder(
              itemCount: bondOrders.length,
              itemBuilder: (context, index) {
                final bond = bondOrders[index];
                return Card(
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  color: AppColors.card,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: AppColors.border)),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(bond['name'] ?? 'Bond Name', style: const TextStyle(color: AppColors.text, fontSize: 18, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Text('Issuer: ${bond['issuer'] ?? 'N/A'}', style: const TextStyle(color: AppColors.muted)),
                        Text('Yield: ${bond['yield'] ?? 'N/A'}%', style: const TextStyle(color: AppColors.muted)),
                        Text('Price: ${bond['price'] ?? 'N/A'}', style: const TextStyle(color: AppColors.muted)),
                        const SizedBox(height: 16),
                        Align(
                          alignment: Alignment.bottomRight,
                          child: ElevatedButton(
                            onPressed: () {
                              // Implement buy bond logic
                              _showBuyBondDialog(context, bond);
                            },
                            style: ElevatedButton.styleFrom(backgroundColor: AppColors.accent),
                            child: const Text('Buy', style: TextStyle(color: AppColors.text)),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateBondOrderDialog(context),
        backgroundColor: AppColors.accent,
        child: const Icon(Icons.add, color: AppColors.text),
      ),
    );
  }

  void _showBuyBondDialog(BuildContext context, dynamic bond) {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: AppColors.card,
          title: Text('Buy ${bond['name'] ?? 'Bond'}', style: const TextStyle(color: AppColors.text)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Current Price: ${bond['price'] ?? 'N/A'}', style: const TextStyle(color: AppColors.text)),
              const TextField(
                decoration: InputDecoration(
                  labelText: 'Quantity',
                  labelStyle: TextStyle(color: AppColors.muted),
                  enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.border)),
                  focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.accent)),
                ),
                keyboardType: TextInputType.number,
                style: TextStyle(color: AppColors.text),
              ),
            ],
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel', style: TextStyle(color: AppColors.muted)),
            ),
            ElevatedButton(
              onPressed: () {
                // Implement actual buy logic using bondSecondaryMarket.buy.mutate()
                Navigator.of(context).pop();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Bond purchase initiated!', style: TextStyle(color: AppColors.text)), backgroundColor: AppColors.accent),
                );
              },
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.accent),
              child: const Text('Confirm Buy', style: TextStyle(color: AppColors.text)),
            ),
          ],
        );
      },
    );
  }

  void _showCreateBondOrderDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: AppColors.card,
          title: const Text('Create New Bond Order', style: TextStyle(color: AppColors.text)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const TextField(
                  decoration: InputDecoration(
                    labelText: 'Bond Name',
                    labelStyle: TextStyle(color: AppColors.muted),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.border)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.accent)),
                  ),
                  style: TextStyle(color: AppColors.text),
                ),
                const SizedBox(height: 16),
                const TextField(
                  decoration: InputDecoration(
                    labelText: 'Issuer',
                    labelStyle: TextStyle(color: AppColors.muted),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.border)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.accent)),
                  ),
                  style: TextStyle(color: AppColors.text),
                ),
                const SizedBox(height: 16),
                const TextField(
                  decoration: InputDecoration(
                    labelText: 'Quantity',
                    labelStyle: TextStyle(color: AppColors.muted),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.border)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.accent)),
                  ),
                  keyboardType: TextInputType.number,
                  style: TextStyle(color: AppColors.text),
                ),
                const SizedBox(height: 16),
                const TextField(
                  decoration: InputDecoration(
                    labelText: 'Desired Price',
                    labelStyle: TextStyle(color: AppColors.muted),
                    enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.border)),
                    focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: AppColors.accent)),
                  ),
                  keyboardType: TextInputType.number,
                  style: TextStyle(color: AppColors.text),
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel', style: TextStyle(color: AppColors.muted)),
            ),
            ElevatedButton(
              onPressed: () {
                // Implement actual create order logic
                Navigator.of(context).pop();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Bond order created!', style: TextStyle(color: AppColors.text)), backgroundColor: AppColors.accent),
                );
              },
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.accent),
              child: const Text('Create Order', style: TextStyle(color: AppColors.text)),
            ),
          ],
        );
      },
    );
  }
}

// Placeholder for ApiService - assuming it's structured similarly to tRPC client
// In a real app, this would be generated or manually implemented to call tRPC endpoints.
class ApiService {
  final BondSecondaryMarket bondSecondaryMarket = BondSecondaryMarket();
}

class BondSecondaryMarket {
  Future<List<Map<String, dynamic>>> listOpenOrders() async {
    // Simulate network delay
    await Future.delayed(const Duration(seconds: 1));
    return [
      {'id': '1', 'name': 'Green Energy Bond', 'issuer': 'EcoCorp', 'yield': 3.5, 'price': 1000.00, 'quantity': 10},
      {'id': '2', 'name': 'Tech Innovation Bond', 'issuer': 'InnovateX', 'yield': 4.2, 'price': 1050.00, 'quantity': 5},
      {'id': '3', 'name': 'Healthcare Growth Bond', 'issuer': 'MediCare', 'yield': 3.8, 'price': 980.00, 'quantity': 12},
    ];
  }

  Future<void> buy(String bondId, int quantity) async {
    await Future.delayed(const Duration(seconds: 1));
    print('Buying bond $bondId, quantity $quantity');
  }

  Future<List<Map<String, dynamic>>> myOrders() async {
    await Future.delayed(const Duration(seconds: 1));
    return [
      {'id': '4', 'name': 'My Purchased Bond', 'issuer': 'MyCorp', 'yield': 3.0, 'price': 990.00, 'quantity': 2, 'status': 'completed'},
    ];
  }

  Future<Map<String, dynamic>> getPricing(String bondId) async {
    await Future.delayed(const Duration(seconds: 0));
    return {'bondId': bondId, 'currentPrice': 1010.00};
  }
}

final apiServiceProvider = Provider((ref) => ApiService());
