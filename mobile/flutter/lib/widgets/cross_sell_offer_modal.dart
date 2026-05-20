/// CrossSellOfferModal — v199
/// Shows a personalised cross-sell offer when Python scoreCrossSell > 0.7.
/// Call [CrossSellOfferModal.checkAndShow] after login / on dashboard mount.
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;

const _offerIcons = {
  'savings_account': Icons.savings_outlined,
  'diaspora_bond': Icons.trending_up_outlined,
  'insurance': Icons.shield_outlined,
  'investment_fund': Icons.business_center_outlined,
  'credit_card': Icons.credit_card_outlined,
};

const _offerColors = {
  'savings_account': Color(0xFF10B981),
  'diaspora_bond': Color(0xFF3B82F6),
  'insurance': Color(0xFF8B5CF6),
  'investment_fund': Color(0xFFF59E0B),
  'credit_card': Color(0xFFEF4444),
};

class CrossSellOfferModal {
  /// Call on login / dashboard mount.
  /// Fires checkAndTrigger mutation; shows modal if an offer is returned.
  static Future<void> checkAndShow(
    BuildContext context, {
    required String baseUrl,
    required String? sessionCookie,
    String? segment,
  }) async {
    if (!context.mounted) return;
    try {
      final uri = Uri.parse('$baseUrl/api/trpc/outbound.crossSell.checkAndTrigger');
      final headers = <String, String>{'Content-Type': 'application/json'};
      if (sessionCookie != null) {
        headers['Cookie'] = 'app_session_id=$sessionCookie';
      }
      final body = jsonEncode({
        'json': {'segment': segment ?? 'labor'},
      });
      final res = await http.post(uri, headers: headers, body: body)
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return;
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      final offer = json['result']?['data']?['offer'] as Map<String, dynamic>?;
      if (offer == null || offer['status'] != 'pending') return;
      if (!context.mounted) return;
      await showDialog(
        context: context,
        barrierDismissible: false,
        builder: (_) => _CrossSellDialog(
          offer: offer,
          baseUrl: baseUrl,
          sessionCookie: sessionCookie,
        ),
      );
    } catch (_) {
      // Silently swallow — offer display is non-critical
    }
  }
}

class _CrossSellDialog extends StatefulWidget {
  final Map<String, dynamic> offer;
  final String baseUrl;
  final String? sessionCookie;

  const _CrossSellDialog({
    required this.offer,
    required this.baseUrl,
    this.sessionCookie,
  });

  @override
  State<_CrossSellDialog> createState() => _CrossSellDialogState();
}

class _CrossSellDialogState extends State<_CrossSellDialog> {
  bool _responding = false;

  Future<void> _respond(String response) async {
    if (_responding) return;
    setState(() { _responding = true; });
    try {
      final offerId = widget.offer['id'] as int?;
      if (offerId != null) {
        final uri = Uri.parse('${widget.baseUrl}/api/trpc/outbound.crossSell.respond');
        final headers = <String, String>{'Content-Type': 'application/json'};
        if (widget.sessionCookie != null) {
          headers['Cookie'] = 'app_session_id=${widget.sessionCookie}';
        }
        await http.post(uri, headers: headers,
          body: jsonEncode({'json': {'offerId': offerId, 'response': response}}))
          .timeout(const Duration(seconds: 5));
      }
    } catch (_) {}
    if (mounted) Navigator.of(context).pop(response);
  }

  @override
  Widget build(BuildContext context) {
    final offerType = widget.offer['offerType'] as String? ?? 'savings_account';
    final headline = widget.offer['headline'] as String? ?? 'Special Offer';
    final body = widget.offer['body'] as String? ?? '';
    final ctaLabel = widget.offer['ctaLabel'] as String? ?? 'Learn More';
    final score = double.tryParse(widget.offer['score']?.toString() ?? '0') ?? 0;

    final icon = _offerIcons[offerType] ?? Icons.star_outline;
    final color = _offerColors[offerType] ?? const Color(0xFF6366F1);

    return Dialog(
      backgroundColor: const Color(0xFF1A1A2E),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        // Header gradient
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [color.withOpacity(0.25), color.withOpacity(0.05)],
              begin: Alignment.topLeft, end: Alignment.bottomRight,
            ),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white10,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.auto_awesome, size: 10, color: color),
                  const SizedBox(width: 4),
                  Text('Personalised for you',
                    style: GoogleFonts.inter(fontSize: 10, color: color, fontWeight: FontWeight.w600)),
                ]),
              ),
              const SizedBox(height: 6),
              Text(headline,
                style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
            ])),
            GestureDetector(
              onTap: () => _respond('dismissed'),
              child: const Icon(Icons.close, size: 18, color: Colors.white38),
            ),
          ]),
        ),
        // Body
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(body,
              style: GoogleFonts.inter(fontSize: 13, color: Colors.white70, height: 1.5)),
            if (score > 0) ...[
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: score,
                    backgroundColor: Colors.white12,
                    valueColor: AlwaysStoppedAnimation<Color>(color),
                    minHeight: 4,
                  ),
                )),
                const SizedBox(width: 8),
                Text('${(score * 100).round()}% match',
                  style: GoogleFonts.inter(fontSize: 10, color: Colors.white38)),
              ]),
            ],
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: OutlinedButton(
                onPressed: _responding ? null : () => _respond('dismissed'),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.white24),
                  foregroundColor: Colors.white60,
                ),
                child: Text('Not now', style: GoogleFonts.inter(fontSize: 13)),
              )),
              const SizedBox(width: 12),
              Expanded(child: ElevatedButton(
                onPressed: _responding ? null : () => _respond('accepted'),
                style: ElevatedButton.styleFrom(backgroundColor: color),
                child: _responding
                    ? const SizedBox(width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text(ctaLabel, style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600)),
                        const SizedBox(width: 4),
                        const Icon(Icons.arrow_forward, size: 14),
                      ]),
              )),
            ]),
          ]),
        ),
      ]),
    );
  }
}
