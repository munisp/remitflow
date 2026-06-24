import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class StablecoinScreen extends ConsumerStatefulWidget {
  const StablecoinScreen({super.key});
  @override
  ConsumerState<StablecoinScreen> createState() => _StablecoinScreenState();
}

class _StablecoinScreenState extends ConsumerState<StablecoinScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  List<dynamic> _balances = [];
  String? _error;

  // Form state
  String _buyFiat = 'USD';
  String _buyStable = 'USDC';
  String _sellStable = 'USDC';
  String _sellFiat = 'USD';
  String _bridgeSymbol = 'USDC';
  String _bridgeFrom = 'ethereum';
  String _bridgeTo = 'polygon';
  String _billBiller = 'electricity';
  String _billStable = 'USDC';
  String _stakeSymbol = 'USDC';

  final _amountController = TextEditingController();
  final _sellAmountController = TextEditingController();
  final _bridgeAmountController = TextEditingController();
  final _billAmountController = TextEditingController();
  final _billAcctController = TextEditingController();
  final _stakeAmountController = TextEditingController();
  final _sendAddrController = TextEditingController();
  final _sendAmountController = TextEditingController();

  static const _stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'NGNT', 'cUSD', 'PYUSD'];
  static const _fiats = ['USD', 'NGN', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'XOF'];
  static const _chains = ['ethereum', 'polygon', 'bsc', 'solana', 'tron', 'arbitrum', 'optimism', 'base', 'avalanche'];
  static const _billers = ['electricity', 'water', 'internet', 'rent', 'phone', 'insurance', 'tax'];

  static const _coinInfo = {
    'USDT': {'name': 'Tether USD', 'apy': 4.2, 'color': 0xFF26A17B},
    'USDC': {'name': 'USD Coin', 'apy': 4.5, 'color': 0xFF2775CA},
    'BUSD': {'name': 'Binance USD', 'apy': 3.5, 'color': 0xFFF0B90B},
    'DAI': {'name': 'Dai', 'apy': 3.8, 'color': 0xFFF5AC37},
    'NGNT': {'name': 'Naira Token', 'apy': 0.0, 'color': 0xFF22C55E},
    'cUSD': {'name': 'Celo Dollar', 'apy': 0.0, 'color': 0xFF14B8A6},
    'PYUSD': {'name': 'PayPal USD', 'apy': 4.0, 'color': 0xFF6366F1},
  };

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 7, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _amountController.dispose();
    _sellAmountController.dispose();
    _bridgeAmountController.dispose();
    _billAmountController.dispose();
    _billAcctController.dispose();
    _stakeAmountController.dispose();
    _sendAddrController.dispose();
    _sendAmountController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('/trpc/stablecoin.balances');
      setState(() { _balances = result['result']['data'] ?? []; _isLoading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  Future<void> _callMutation(String endpoint, Map<String, dynamic> body, String successMsg) async {
    try {
      final api = ref.read(apiServiceProvider);
      await api.post('/trpc/$endpoint', body);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(successMsg), backgroundColor: const Color(0xFF22C55E)));
        _load();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: Colors.red));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    const bg = Color(0xFF0F0F1A);
    const card = Color(0xFF1A1A2E);
    const border = Color(0xFF2D2D4E);
    const text = Color(0xFFE2E8F0);
    const muted = Color(0xFF9CA3AF);
    const primary = Color(0xFF6366F1);
    const green = Color(0xFF22C55E);

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: card,
        title: const Text('Stablecoins', style: TextStyle(color: text, fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: primary),
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          indicatorColor: primary,
          labelColor: primary,
          unselectedLabelColor: muted,
          tabAlignment: TabAlignment.start,
          tabs: const [
            Tab(text: 'On-Ramp'),
            Tab(text: 'Off-Ramp'),
            Tab(text: 'Swap'),
            Tab(text: 'Send'),
            Tab(text: 'Yield'),
            Tab(text: 'Bridge'),
            Tab(text: 'Bill Pay'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: primary))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.error_outline, color: Colors.red, size: 48),
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: muted), textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _load, style: ElevatedButton.styleFrom(backgroundColor: primary), child: const Text('Retry')),
                ]))
              : Column(children: [
                  // Balance summary
                  Container(
                    padding: const EdgeInsets.all(16),
                    color: card,
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Text('Total Balance', style: TextStyle(color: muted, fontSize: 12)),
                        const SizedBox(height: 4),
                        Text(
                          '\$${_balances.fold<double>(0, (s, b) => s + (b['balance'] as num? ?? 0).toDouble()).toStringAsFixed(2)}',
                          style: const TextStyle(color: text, fontSize: 24, fontWeight: FontWeight.w800),
                        ),
                      ])),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(color: green.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                        child: Text('${_balances.length} coins', style: const TextStyle(color: green, fontSize: 12, fontWeight: FontWeight.w600)),
                      ),
                    ]),
                  ),
                  // Balance cards
                  SizedBox(
                    height: 80,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      itemCount: _balances.length,
                      itemBuilder: (context, index) {
                        final b = _balances[index];
                        final info = _coinInfo[b['symbol']] ?? {'name': b['symbol'], 'apy': 0.0, 'color': 0xFF6366F1};
                        return Container(
                          width: 140,
                          margin: const EdgeInsets.only(right: 8),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: card,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: border),
                          ),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                            Text(b['symbol'] ?? '', style: TextStyle(color: Color(info['color'] as int), fontWeight: FontWeight.w700, fontSize: 14)),
                            const SizedBox(height: 4),
                            Text('\$${(b['balance'] as num? ?? 0).toStringAsFixed(2)}', style: const TextStyle(color: text, fontWeight: FontWeight.w800, fontSize: 16)),
                          ]),
                        );
                      },
                    ),
                  ),
                  // Tab content
                  Expanded(
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        _buildOnRamp(card, border, text, muted, primary),
                        _buildOffRamp(card, border, text, muted, primary),
                        _buildSwap(card, border, text, muted, primary),
                        _buildSend(card, border, text, muted, primary),
                        _buildYield(card, border, text, muted, primary, green),
                        _buildBridge(card, border, text, muted, primary),
                        _buildBillPay(card, border, text, muted, primary),
                      ],
                    ),
                  ),
                ]),
    );
  }

  Widget _buildDropdown(String value, List<String> items, ValueChanged<String?> onChanged, Color card, Color border, Color text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(color: card, borderRadius: BorderRadius.circular(8), border: Border.all(color: border)),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          dropdownColor: card,
          style: TextStyle(color: text, fontSize: 14),
          items: items.map((i) => DropdownMenuItem(value: i, child: Text(i))).toList(),
          onChanged: onChanged,
        ),
      ),
    );
  }

  Widget _buildInput(TextEditingController controller, String hint, Color card, Color border, Color text, {TextInputType keyboardType = TextInputType.number}) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      style: TextStyle(color: text, fontSize: 15),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFF6B7280)),
        filled: true,
        fillColor: card,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: border)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      ),
    );
  }

  Widget _buildActionButton(String label, VoidCallback onPressed, Color primary) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(backgroundColor: primary, padding: const EdgeInsets.symmetric(vertical: 14), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
        child: Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 15)),
      ),
    );
  }

  Widget _buildOnRamp(Color card, Color border, Color text, Color muted, Color primary) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Buy Stablecoin with Fiat', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        Text('Fiat Currency', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_buyFiat, _fiats, (v) => setState(() => _buyFiat = v!), card, border, text),
        const SizedBox(height: 12),
        Text('Stablecoin', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_buyStable, _stablecoins, (v) => setState(() => _buyStable = v!), card, border, text),
        const SizedBox(height: 12),
        _buildInput(_amountController, 'Amount in $_buyFiat', card, border, text),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: primary.withOpacity(0.05), borderRadius: BorderRadius.circular(8)),
          child: Row(children: [
            Icon(Icons.shield, color: primary, size: 16),
            const SizedBox(width: 8),
            Expanded(child: Text('KYC, AML, sanctions screening on every on-ramp', style: TextStyle(color: muted, fontSize: 11))),
          ]),
        ),
        const SizedBox(height: 16),
        _buildActionButton('Buy $_buyStable', () {
          final amt = double.tryParse(_amountController.text) ?? 0;
          if (amt <= 0) return;
          _callMutation('stablecoin.buyWithFiat', {'fiatCurrency': _buyFiat, 'stablecoin': _buyStable, 'fiatAmount': amt}, 'On-ramp complete!');
        }, primary),
      ]),
    );
  }

  Widget _buildOffRamp(Color card, Color border, Color text, Color muted, Color primary) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Sell Stablecoin to Fiat', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        Text('Stablecoin', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_sellStable, _stablecoins, (v) => setState(() => _sellStable = v!), card, border, text),
        const SizedBox(height: 12),
        Text('Fiat Currency', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_sellFiat, _fiats, (v) => setState(() => _sellFiat = v!), card, border, text),
        const SizedBox(height: 12),
        _buildInput(_sellAmountController, 'Amount in $_sellStable', card, border, text),
        const SizedBox(height: 16),
        _buildActionButton('Sell $_sellStable', () {
          final amt = double.tryParse(_sellAmountController.text) ?? 0;
          if (amt <= 0) return;
          _callMutation('stablecoin.sellToFiat', {'stablecoin': _sellStable, 'fiatCurrency': _sellFiat, 'stablecoinAmount': amt}, 'Off-ramp complete!');
        }, primary),
      ]),
    );
  }

  Widget _buildSwap(Color card, Color border, Color text, Color muted, Color primary) {
    String fromSym = 'USDT';
    String toSym = 'USDC';
    final swapAmtController = TextEditingController();
    return StatefulBuilder(builder: (context, setLocalState) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Swap Stablecoins', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('From', style: TextStyle(color: muted, fontSize: 12)),
              const SizedBox(height: 6),
              _buildDropdown(fromSym, _stablecoins, (v) => setLocalState(() => fromSym = v!), card, border, text),
            ])),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('To', style: TextStyle(color: muted, fontSize: 12)),
              const SizedBox(height: 6),
              _buildDropdown(toSym, _stablecoins, (v) => setLocalState(() => toSym = v!), card, border, text),
            ])),
          ]),
          const SizedBox(height: 12),
          _buildInput(swapAmtController, 'Amount to swap', card, border, text),
          const SizedBox(height: 16),
          _buildActionButton('Swap $fromSym -> $toSym', () {
            final amt = double.tryParse(swapAmtController.text) ?? 0;
            if (amt <= 0) return;
            _callMutation('stablecoin.swap', {'from': fromSym, 'to': toSym, 'amount': amt}, 'Swap complete!');
          }, primary),
        ]),
      );
    });
  }

  Widget _buildSend(Color card, Color border, Color text, Color muted, Color primary) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Send Stablecoin', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        _buildInput(_sendAddrController, 'Recipient address (0x...)', card, border, text, keyboardType: TextInputType.text),
        const SizedBox(height: 12),
        _buildInput(_sendAmountController, 'Amount', card, border, text),
        const SizedBox(height: 16),
        _buildActionButton('Send', () {
          final amt = double.tryParse(_sendAmountController.text) ?? 0;
          if (amt <= 0 || _sendAddrController.text.isEmpty) return;
          _callMutation('stablecoin.send', {'symbol': 'USDC', 'toAddress': _sendAddrController.text, 'amount': amt}, 'Sent!');
        }, primary),
      ]),
    );
  }

  Widget _buildYield(Color card, Color border, Color text, Color muted, Color primary, Color green) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('DeFi Yield', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: green.withOpacity(0.05), borderRadius: BorderRadius.circular(12), border: Border.all(color: green.withOpacity(0.2))),
          child: Text('Stake stablecoins in vetted DeFi protocols for yield.', style: TextStyle(color: muted, fontSize: 12)),
        ),
        const SizedBox(height: 16),
        ..._coinInfo.entries.where((e) => (e.value['apy'] as num) > 0).map((e) => Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: card, borderRadius: BorderRadius.circular(12), border: Border.all(color: border)),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(e.key, style: TextStyle(color: text, fontWeight: FontWeight.w600)),
              Text('${e.value['name']}', style: TextStyle(color: muted, fontSize: 12)),
            ]),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: green.withOpacity(0.1), borderRadius: BorderRadius.circular(6)),
              child: Text('${e.value['apy']}% APY', style: TextStyle(color: green, fontSize: 12, fontWeight: FontWeight.w600)),
            ),
          ]),
        )),
        const SizedBox(height: 16),
        Text('Stablecoin', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_stakeSymbol, _stablecoins, (v) => setState(() => _stakeSymbol = v!), card, border, text),
        const SizedBox(height: 12),
        _buildInput(_stakeAmountController, 'Amount to stake', card, border, text),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: _buildActionButton('Stake', () {
            final amt = double.tryParse(_stakeAmountController.text) ?? 0;
            if (amt <= 0) return;
            _callMutation('stablecoin.stakeForYield', {'stablecoin': _stakeSymbol, 'amount': amt}, 'Staked!');
          }, primary)),
          const SizedBox(width: 12),
          Expanded(child: ElevatedButton(
            onPressed: () {
              final amt = double.tryParse(_stakeAmountController.text) ?? 0;
              if (amt <= 0) return;
              _callMutation('stablecoin.unstake', {'stablecoin': _stakeSymbol, 'amount': amt}, 'Unstaked!');
            },
            style: ElevatedButton.styleFrom(backgroundColor: border, padding: const EdgeInsets.symmetric(vertical: 14), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
            child: const Text('Unstake', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
          )),
        ]),
      ]),
    );
  }

  Widget _buildBridge(Color card, Color border, Color text, Color muted, Color primary) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Cross-Chain Bridge', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        Text('Stablecoin', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_bridgeSymbol, _stablecoins, (v) => setState(() => _bridgeSymbol = v!), card, border, text),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('From', style: TextStyle(color: muted, fontSize: 12)),
            const SizedBox(height: 6),
            _buildDropdown(_bridgeFrom, _chains, (v) => setState(() => _bridgeFrom = v!), card, border, text),
          ])),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('To', style: TextStyle(color: muted, fontSize: 12)),
            const SizedBox(height: 6),
            _buildDropdown(_bridgeTo, _chains.where((c) => c != _bridgeFrom).toList(), (v) => setState(() => _bridgeTo = v!), card, border, text),
          ])),
        ]),
        const SizedBox(height: 12),
        _buildInput(_bridgeAmountController, 'Amount', card, border, text),
        const SizedBox(height: 16),
        _buildActionButton('Bridge $_bridgeSymbol', () {
          final amt = double.tryParse(_bridgeAmountController.text) ?? 0;
          if (amt <= 0) return;
          _callMutation('stablecoin.bridgeChain', {'stablecoin': _bridgeSymbol, 'fromChain': _bridgeFrom, 'toChain': _bridgeTo, 'amount': amt}, 'Bridge initiated!');
        }, primary),
      ]),
    );
  }

  Widget _buildBillPay(Color card, Color border, Color text, Color muted, Color primary) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Pay Bills with Stablecoin', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        Text('Biller Type', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_billBiller, _billers, (v) => setState(() => _billBiller = v!), card, border, text),
        const SizedBox(height: 12),
        _buildInput(_billAcctController, 'Account / Reference number', card, border, text, keyboardType: TextInputType.text),
        const SizedBox(height: 12),
        Text('Pay with', style: TextStyle(color: muted, fontSize: 12)),
        const SizedBox(height: 6),
        _buildDropdown(_billStable, _stablecoins, (v) => setState(() => _billStable = v!), card, border, text),
        const SizedBox(height: 12),
        _buildInput(_billAmountController, 'Amount', card, border, text),
        const SizedBox(height: 16),
        _buildActionButton('Pay Bill', () {
          final amt = double.tryParse(_billAmountController.text) ?? 0;
          if (amt <= 0 || _billAcctController.text.isEmpty) return;
          _callMutation('stablecoin.payBill', {'billType': _billBiller, 'billerName': _billBiller, 'billerAccountNumber': _billAcctController.text, 'stablecoin': _billStable, 'amount': amt}, 'Bill paid!');
        }, primary),
      ]),
    );
  }
}
