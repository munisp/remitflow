import 'package:flutter/material.dart';

class QRPayScreen extends StatefulWidget {
  const QRPayScreen({Key? key}) : super(key: key);
  @override
  State<QRPayScreen> createState() => _QRPayScreenState();
}

class _QRPayScreenState extends State<QRPayScreen> {
  bool _isLoading = true;
  String _search = '';
  Map<String, dynamic>? _qrInfo;
  int _tabIndex = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      if (mounted) setState(() => _qrInfo = null);
    } catch (e) {
      debugPrint('Error loading QR Pay: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0f0f1a),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1e1e2e),
        title: const Text('QR Pay', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366f1)))
          : Column(children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: TextField(
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Search...',
                    hintStyle: const TextStyle(color: Colors.grey),
                    filled: true,
                    fillColor: const Color(0xFF1e1e2e),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                    prefixIcon: const Icon(Icons.search, color: Colors.grey),
                  ),
                  onChanged: (v) => setState(() => _search = v),
                ),
              ),
              Expanded(child: RefreshIndicator(
                onRefresh: _loadData,
                child: Column(children: [
                  Row(children: [
                    Expanded(child: GestureDetector(onTap: () => setState(() => _tabIndex = 0), child: Container(padding: const EdgeInsets.all(12), color: _tabIndex == 0 ? const Color(0xFF6366f1) : const Color(0xFF1e1e2e), child: const Text('Receive', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600))))),
                    Expanded(child: GestureDetector(onTap: () => setState(() => _tabIndex = 1), child: Container(padding: const EdgeInsets.all(12), color: _tabIndex == 1 ? const Color(0xFF6366f1) : const Color(0xFF1e1e2e), child: const Text('Scan', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600))))),
                  ]),
                  Expanded(child: _tabIndex == 0 ? ListView(children: [
                    _card(title: 'Your QR Code', label: 'User ID: \${_qrInfo?['userId'] ?? 'N/A'}'),
                    Container(margin: const EdgeInsets.all(16), height: 200, decoration: BoxDecoration(color: const Color(0xFF2e2e3e), borderRadius: BorderRadius.circular(12)), child: const Center(child: Text('QR Code', style: TextStyle(color: Colors.grey, fontSize: 18)))),
                  ]) : ListView(children: [
                    Container(margin: const EdgeInsets.all(16), height: 200, decoration: BoxDecoration(color: const Color(0xFF2e2e3e), borderRadius: BorderRadius.circular(12)), child: const Center(child: Icon(Icons.camera_alt, color: Colors.grey, size: 48))),
                    Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: ElevatedButton(onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Camera access required'))), style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366f1), minimumSize: const Size.fromHeight(44)), child: const Text('Open Camera', style: TextStyle(color: Colors.white)))),
                  ]),
                )],
              )),
            ]),
    );
  }

  Widget _card({required String title, String? subtitle, String? amount, String? label, Color? borderColor, List<Widget>? actions}) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1e1e2e),
        borderRadius: BorderRadius.circular(12),
        border: borderColor != null ? Border(left: BorderSide(color: borderColor, width: 3)) : null,
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
        if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle, style: const TextStyle(color: Colors.grey, fontSize: 13))],
        if (amount != null) ...[const SizedBox(height: 8), Text(amount, style: const TextStyle(color: Color(0xFF6366f1), fontSize: 22, fontWeight: FontWeight.bold))],
        if (label != null) ...[const SizedBox(height: 4), Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12))],
        if (actions != null) ...[const SizedBox(height: 12), Row(children: actions)],
      ]),
    );
  }

  Widget _badge(String text, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
    child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
  );

  Widget _actionBtn(String label, VoidCallback onPressed, {Color? color}) => Expanded(
    child: ElevatedButton(
      onPressed: onPressed,
      style: ElevatedButton.styleFrom(backgroundColor: color ?? const Color(0xFF6366f1), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
      child: Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
    ),
  );
}
