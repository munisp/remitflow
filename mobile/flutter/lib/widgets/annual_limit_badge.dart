/// AnnualLimitBadge — v199
/// Shows CBN annual limit utilization for a given purpose code.
/// Calls the /api/trpc/outbound.swift.getAnnualLimit endpoint.
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;

const _purposeLabels = {
  'EDU': 'Education', 'MED': 'Medical', 'TRV': 'Travel',
  'REM': 'Remittance', 'SME': 'SME / Trade', 'HNW': 'High Net Worth',
  'INV': 'Investment', 'DIVI': 'Dividends',
};

const _cbnLimits = {
  'EDU': 10000, 'MED': 15000, 'TRV': 4000, 'REM': 50000,
  'SME': 200000, 'HNW': 500000, 'INV': 100000, 'DIVI': 200000,
};

class AnnualLimitBadge extends StatefulWidget {
  final String purposeCode;
  final String baseUrl;
  final String? sessionCookie;
  final bool compact;

  const AnnualLimitBadge({
    super.key,
    required this.purposeCode,
    required this.baseUrl,
    this.sessionCookie,
    this.compact = false,
  });

  @override
  State<AnnualLimitBadge> createState() => _AnnualLimitBadgeState();
}

class _AnnualLimitBadgeState extends State<AnnualLimitBadge> {
  _LimitData? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchLimit();
  }

  @override
  void didUpdateWidget(AnnualLimitBadge old) {
    super.didUpdateWidget(old);
    if (old.purposeCode != widget.purposeCode) _fetchLimit();
  }

  Future<void> _fetchLimit() async {
    if (!mounted) return;
    setState(() { _loading = true; _error = null; });
    try {
      final uri = Uri.parse(
        '${widget.baseUrl}/api/trpc/outbound.swift.getAnnualLimit'
        '?input=${Uri.encodeComponent(jsonEncode({"purpose_code": widget.purposeCode}))}',
      );
      final headers = <String, String>{'Content-Type': 'application/json'};
      if (widget.sessionCookie != null) {
        headers['Cookie'] = 'app_session_id=${widget.sessionCookie}';
      }
      final res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body) as Map<String, dynamic>;
        final result = body['result']?['data'] as Map<String, dynamic>?;
        if (result != null) {
          setState(() {
            _data = _LimitData.fromJson(result);
            _loading = false;
          });
          return;
        }
      }
      // Fallback: use static limits
      _useFallback();
    } catch (_) {
      _useFallback();
    }
  }

  void _useFallback() {
    final cap = _cbnLimits[widget.purposeCode] ?? 0;
    setState(() {
      _data = _LimitData(
        purposeCode: widget.purposeCode,
        annualCapUsd: cap.toDouble(),
        usedUsd: 0,
        remainingUsd: cap.toDouble(),
        utilizationPct: 0,
        isExceeded: false,
        calendarYear: DateTime.now().year,
      );
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Container(
        height: 24, width: 140,
        decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(6)),
      );
    }
    if (_data == null || _data!.annualCapUsd == 0) return const SizedBox.shrink();

    final d = _data!;
    final label = _purposeLabels[d.purposeCode] ?? d.purposeCode;
    final pct = d.utilizationPct.clamp(0, 100).toDouble();

    final Color barColor = d.isExceeded
        ? Colors.red
        : pct >= 80 ? Colors.amber : Colors.green;

    if (widget.compact) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: d.isExceeded ? Colors.red.withOpacity(0.15) : Colors.white10,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: barColor.withOpacity(0.4)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(d.isExceeded ? Icons.warning_amber_rounded : Icons.check_circle_outline,
            size: 13, color: barColor),
          const SizedBox(width: 4),
          Text(
            d.isExceeded
                ? 'Limit reached'
                : '\$${_fmt(d.remainingUsd)} remaining',
            style: GoogleFonts.inter(fontSize: 11, color: barColor, fontWeight: FontWeight.w600),
          ),
        ]),
      );
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: d.isExceeded ? Colors.red.withOpacity(0.08) : Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: d.isExceeded ? Colors.red.withOpacity(0.3) : Colors.white12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(d.isExceeded ? Icons.warning_amber_rounded : Icons.verified_outlined,
            size: 15, color: barColor),
          const SizedBox(width: 6),
          Expanded(child: Text(
            '$label Annual Limit (${d.calendarYear})',
            style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.white70),
          )),
          Text(
            d.isExceeded ? 'EXCEEDED' : '${d.utilizationPct}% used',
            style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w700, color: barColor),
          ),
        ]),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: pct / 100,
            backgroundColor: Colors.white12,
            valueColor: AlwaysStoppedAnimation<Color>(barColor),
            minHeight: 6,
          ),
        ),
        const SizedBox(height: 6),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('Used: \$${_fmt(d.usedUsd)}',
            style: GoogleFonts.inter(fontSize: 10, color: Colors.white54)),
          Text('Cap: \$${_fmt(d.annualCapUsd)}',
            style: GoogleFonts.inter(fontSize: 10, color: Colors.white54)),
          if (!d.isExceeded)
            Text('Left: \$${_fmt(d.remainingUsd)}',
              style: GoogleFonts.inter(fontSize: 10, color: barColor, fontWeight: FontWeight.w600)),
        ]),
        if (d.isExceeded) ...[
          const SizedBox(height: 4),
          Text(
            '⚠ Annual limit exceeded. Transfers blocked until ${d.calendarYear + 1}.',
            style: GoogleFonts.inter(fontSize: 10, color: Colors.red, fontWeight: FontWeight.w500),
          ),
        ],
      ]),
    );
  }

  String _fmt(double v) {
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
    return v.toStringAsFixed(0);
  }
}

class _LimitData {
  final String purposeCode;
  final double annualCapUsd;
  final double usedUsd;
  final double remainingUsd;
  final int utilizationPct;
  final bool isExceeded;
  final int calendarYear;

  _LimitData({
    required this.purposeCode, required this.annualCapUsd, required this.usedUsd,
    required this.remainingUsd, required this.utilizationPct, required this.isExceeded,
    required this.calendarYear,
  });

  factory _LimitData.fromJson(Map<String, dynamic> j) => _LimitData(
    purposeCode: j['purposeCode'] as String? ?? '',
    annualCapUsd: (j['annualCapUsd'] as num?)?.toDouble() ?? 0,
    usedUsd: (j['usedUsd'] as num?)?.toDouble() ?? 0,
    remainingUsd: (j['remainingUsd'] as num?)?.toDouble() ?? 0,
    utilizationPct: (j['utilizationPct'] as num?)?.toInt() ?? 0,
    isExceeded: j['isExceeded'] as bool? ?? false,
    calendarYear: (j['calendarYear'] as num?)?.toInt() ?? DateTime.now().year,
  );
}
