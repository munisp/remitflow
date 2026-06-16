import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/future_proofing_service.dart';

class SubscriptionTiersScreen extends StatefulWidget {
  const SubscriptionTiersScreen({super.key});

  @override
  State<SubscriptionTiersScreen> createState() => _SubscriptionTiersScreenState();
}

class _SubscriptionTiersScreenState extends State<SubscriptionTiersScreen> {
  List<Map<String, dynamic>> _tiers = [];
  bool _isLoading = true;
  String? _currentTierId;

  @override
  void initState() {
    super.initState();
    _loadTiers();
  }

  Future<void> _loadTiers() async {
    setState(() => _isLoading = true);
    try {
      final result = await futureProofingService.getSubscriptionTiers();
      setState(() {
        _tiers = List<Map<String, dynamic>>.from(result['tiers'] ?? []);
        _currentTierId = result['currentTierId']?.toString();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _subscribe(String tierId, String tierName) async {
    HapticFeedback.heavyImpact();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Subscribe to $tierName?'),
        content: const Text('You can change or cancel your subscription anytime.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Subscribe')),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await futureProofingService.subscribeTier(tierId);
      setState(() => _currentTierId = tierId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Subscribed to $tierName!'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Subscription Plans'), centerTitle: true),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _tiers.length,
              itemBuilder: (context, index) => _buildTierCard(_tiers[index], index),
            ),
    );
  }

  Widget _buildTierCard(Map<String, dynamic> tier, int index) {
    final isCurrentTier = tier['id']?.toString() == _currentTierId;
    final isPopular = index == 1;
    final colors = [Colors.grey, Colors.blue, Colors.purple, Colors.amber];
    final color = colors[index % colors.length];

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: isPopular ? 4 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: isPopular ? BorderSide(color: color, width: 2) : BorderSide.none,
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(tier['name']?.toString() ?? 'Plan',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color[800])),
                const Spacer(),
                if (isPopular)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
                    child: const Text('Popular', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                if (isCurrentTier)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: Colors.green, borderRadius: BorderRadius.circular(12)),
                    child: const Text('Current', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('\$${tier['price'] ?? 0}',
                    style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold)),
                const Text('/month', style: TextStyle(color: Colors.grey, fontSize: 14)),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 12),
            ...(tier['features'] as List? ?? []).map<Widget>((f) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Icon(Icons.check_circle, color: color, size: 18),
                  const SizedBox(width: 8),
                  Expanded(child: Text(f.toString(), style: const TextStyle(fontSize: 14))),
                ],
              ),
            )),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: isCurrentTier
                  ? OutlinedButton(
                      onPressed: null,
                      style: OutlinedButton.styleFrom(
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: const Text('Current Plan'),
                    )
                  : ElevatedButton(
                      onPressed: () => _subscribe(tier['id']?.toString() ?? '', tier['name']?.toString() ?? ''),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: color,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: const Text('Subscribe', style: TextStyle(fontWeight: FontWeight.w600)),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
