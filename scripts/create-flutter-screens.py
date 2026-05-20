import os

FL = "/home/ubuntu/remitflow/mobile/flutter/lib/screens"
os.makedirs(FL, exist_ok=True)

def write(name, content):
    path = f"{FL}/{name}"
    with open(path, 'w') as f:
        f.write(content)
    print(f"✅ {name}")

# Template for a simple Flutter screen with tRPC-style API calls via Dio
TEMPLATE = '''import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class {ClassName}Screen extends ConsumerStatefulWidget {{
  const {ClassName}Screen({{super.key}});
  @override
  ConsumerState<{ClassName}Screen> createState() => _{ClassName}ScreenState();
}}

class _{ClassName}ScreenState extends ConsumerState<{ClassName}Screen> {{
  bool _isLoading = true;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() {{
    super.initState();
    _load();
  }}

  Future<void> _load() async {{
    try {{
      final api = ref.read(apiServiceProvider);
      final result = await api.get('{endpoint}');
      setState(() {{ _items = result['result']['data'] ?? []; _isLoading = false; }});
    }} catch (e) {{
      setState(() {{ _error = e.toString(); _isLoading = false; }});
    }}
  }}

  @override
  Widget build(BuildContext context) {{
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('{title}', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Color(0xFF6366F1)),
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: const Color(0xFF2D2D4E)),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Text('⚠️', style: TextStyle(fontSize: 40)),
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF)), textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : _items.isEmpty
                  ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Text('{emptyIcon}', style: TextStyle(fontSize: 48)),
                      const SizedBox(height: 12),
                      const Text('No {title} yet', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 16)),
                    ]))
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: const Color(0xFF6366F1),
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        itemBuilder: (context, index) {{
                          final item = _items[index];
                          return Card(
                            color: const Color(0xFF1A1A2E),
                            margin: const EdgeInsets.only(bottom: 12),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                              side: const BorderSide(color: Color(0xFF2D2D4E)),
                            ),
                            child: ListTile(
                              contentPadding: const EdgeInsets.all(16),
                              title: Text(
                                item['name']?.toString() ?? item['id']?.toString() ?? 'Item ${{index + 1}}',
                                style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600),
                              ),
                              subtitle: item['status'] != null
                                  ? Text(item['status'].toString(), style: const TextStyle(color: Color(0xFF9CA3AF)))
                                  : null,
                              trailing: const Icon(Icons.chevron_right, color: Color(0xFF6366F1)),
                            ),
                          );
                        }},
                      ),
                    ),
    );
  }}
}}
'''

screens = [
    ("cards_screen", "Cards", "/trpc/cards.list", "💳", "Cards"),
    ("savings_goals_screen", "SavingsGoals", "/trpc/savings.goals", "🎯", "Savings Goals"),
    ("bnpl_screen", "Bnpl", "/trpc/bnpl.plans", "💰", "BNPL Plans"),
    ("stablecoin_screen", "Stablecoin", "/trpc/stablecoin.balances", "🪙", "Stablecoin"),
    ("disputes_screen", "Disputes", "/trpc/disputes.list", "⚖️", "Disputes"),
    ("referral_screen", "Referral", "/trpc/referral.stats", "🎁", "Referral"),
    ("batch_payments_screen", "BatchPayments", "/trpc/batchPayments.list", "📦", "Batch Payments"),
    ("rate_lock_screen", "RateLock", "/trpc/rateLock.list", "🔒", "Rate Locks"),
    ("rate_calculator_screen", "RateCalculator", "/trpc/fx.rates", "🧮", "Rate Calculator"),
    ("airtime_screen", "Airtime", "/trpc/airtime.history", "📱", "Airtime"),
    ("bill_payment_screen", "BillPayment", "/trpc/bills.list", "📄", "Bill Payments"),
    ("qr_pay_screen", "QrPay", "/trpc/qrPay.codes", "📷", "QR Pay"),
    ("direct_debit_screen", "DirectDebit", "/trpc/directDebit.mandates", "🏦", "Direct Debit"),
    ("recurring_payments_screen", "RecurringPayments", "/trpc/recurring.list", "🔄", "Recurring Payments"),
    ("virtual_account_screen", "VirtualAccount", "/trpc/virtualAccounts.list", "🏛️", "Virtual Accounts"),
    ("settings_screen", "Settings", "/trpc/auth.me", "⚙️", "Settings"),
    ("support_screen", "Support", "/trpc/support.listSessions", "💬", "Support"),
    ("split_bill_screen", "SplitBill", "/trpc/splitBill.list", "🍽️", "Split Bills"),
    ("cbdc_screen", "Cbdc", "/trpc/cbdc.balances", "🏦", "CBDC"),
    ("checkout_sdk_screen", "CheckoutSdk", "/trpc/checkout.apiKeys", "🔑", "Checkout SDK"),
]

for filename, classname, endpoint, icon, title in screens:
    content = TEMPLATE.format(
        ClassName=classname,
        endpoint=endpoint,
        title=title,
        emptyIcon=icon,
    )
    write(f"{filename}.dart", content)

print(f"\n✅ Created {len(screens)} Flutter screens")
print(f"Total Flutter screens: {len(os.listdir(FL))}")
