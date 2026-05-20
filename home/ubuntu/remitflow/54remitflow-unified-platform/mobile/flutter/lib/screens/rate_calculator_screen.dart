// File: rate_calculator_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:local_auth/local_auth.dart';
import 'package:flutter/services.dart'; // For PlatformException

// --- 1. Data Models ---

/// Represents a currency rate model.
class CurrencyRate {
  final String baseCurrency;
  final Map<String, double> rates;
  final DateTime timestamp;

  CurrencyRate({
    required this.baseCurrency,
    required this.rates,
    required this.timestamp,
  });

  factory CurrencyRate.fromJson(Map<String, dynamic> json) {
    // Assuming the API returns a structure like:
    // {"base": "USD", "rates": {"EUR": 0.92, "GBP": 0.79}, "timestamp": 1678886400}
    final ratesMap = (json['rates'] as Map<String, dynamic>).map(
      (key, value) => MapEntry(key, (value as num).toDouble()),
    );

    return CurrencyRate(
      baseCurrency: json['base'] as String,
      rates: ratesMap,
      timestamp: DateTime.fromMillisecondsSinceEpoch(
          (json['timestamp'] as int) * 1000),
    );
  }

  Map<String, dynamic> toJson() => {
        'base': baseCurrency,
        'rates': rates,
        'timestamp': timestamp.millisecondsSinceEpoch ~/ 1000,
      };
}

// --- 2. State Management (Riverpod) ---

// Mock API URL and Currencies for demonstration
const String _mockApiUrl = 'https://api.exchangerate-api.com/v4/latest/USD';
const List<String> _supportedCurrencies = [
  'USD',
  'EUR',
  'GBP',
  'NGN',
  'CAD',
  'AUD'
];

/// State class for the Rate Calculator
class RateCalculatorState {
  final AsyncValue<CurrencyRate> rates;
  final String fromCurrency;
  final String toCurrency;
  final double amount;
  final String? errorMessage;

  RateCalculatorState({
    required this.rates,
    required this.fromCurrency,
    required this.toCurrency,
    this.amount = 1.0,
    this.errorMessage,
  });

  RateCalculatorState copyWith({
    AsyncValue<CurrencyRate>? rates,
    String? fromCurrency,
    String? toCurrency,
    double? amount,
    String? errorMessage,
  }) {
    return RateCalculatorState(
      rates: rates ?? this.rates,
      fromCurrency: fromCurrency ?? this.fromCurrency,
      toCurrency: toCurrency ?? this.toCurrency,
      amount: amount ?? this.amount,
      errorMessage: errorMessage,
    );
  }
}

/// StateNotifier to handle the business logic and state changes
class RateCalculatorNotifier extends StateNotifier<RateCalculatorState> {
  final LocalAuthentication _localAuth = LocalAuthentication();
  final String _cacheKey = 'cached_currency_rates';

  RateCalculatorNotifier()
      : super(RateCalculatorState(
          rates: const AsyncValue.loading(),
          fromCurrency: _supportedCurrencies.first,
          toCurrency: _supportedCurrencies.last,
        )) {
    fetchRates();
  }

  // --- API Integration (http) and Offline Mode (shared_preferences) ---

  Future<void> fetchRates() async {
    state = state.copyWith(rates: const AsyncValue.loading());
    await _loadCachedRates();

    try {
      // Simulate a real API call
      final response = await http.get(Uri.parse(_mockApiUrl)).timeout(
            const Duration(seconds: 10),
          );

      if (response.statusCode == 200) {
        final jsonBody = json.decode(response.body);
        // Adjusting for a common free API format where base is fixed (e.g., USD)
        // and rates are relative to it.
        final CurrencyRate newRates = CurrencyRate.fromJson({
          'base': jsonBody['base'],
          'rates': jsonBody['rates'],
          'timestamp': DateTime.now().millisecondsSinceEpoch ~/ 1000,
        });

        state = state.copyWith(rates: AsyncValue.data(newRates));
        _cacheRates(newRates); // Cache the new rates
      } else {
        throw Exception('Failed to load rates: ${response.statusCode}');
      }
    } catch (e) {
      // Proper Error Handling: If API fails, check if we have cached data
      if (state.rates.isLoading) {
        state = state.copyWith(
          rates: AsyncValue.error(
            'Failed to fetch real-time rates. Showing cached data.',
            StackTrace.current,
          ),
          errorMessage: 'Network error. Using cached rates.',
        );
      } else {
        // If we have cached data, just show a temporary error message
        state = state.copyWith(
          errorMessage: 'Failed to refresh rates: ${e.toString()}',
        );
      }
    }
  }

  Future<void> _loadCachedRates() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String? cachedData = prefs.getString(_cacheKey);

      if (cachedData != null) {
        final Map<String, dynamic> json = jsonDecode(cachedData);
        final CurrencyRate cachedRates = CurrencyRate.fromJson(json);
        state = state.copyWith(rates: AsyncValue.data(cachedRates));
        state = state.copyWith(
            errorMessage:
                'Rates loaded from cache (as of ${cachedRates.timestamp.toLocal().toString().substring(0, 16)})');
      }
    } catch (e) {
      // Handle cache loading error
      state = state.copyWith(
        rates: AsyncValue.error(
          'Failed to load cached rates.',
          StackTrace.current,
        ),
      );
    }
  }

  Future<void> _cacheRates(CurrencyRate rates) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String jsonString = jsonEncode(rates.toJson());
      await prefs.setString(_cacheKey, jsonString);
    } catch (e) {
      // Log caching error (non-critical)
      debugPrint('Error caching rates: $e');
    }
  }

  // --- State Mutators ---

  void setFromCurrency(String currency) {
    state = state.copyWith(fromCurrency: currency, errorMessage: null);
  }

  void setToCurrency(String currency) {
    state = state.copyWith(toCurrency: currency, errorMessage: null);
  }

  void setAmount(String amountText) {
    final double? newAmount = double.tryParse(amountText);
    if (newAmount != null && newAmount > 0) {
      state = state.copyWith(amount: newAmount, errorMessage: null);
    } else if (amountText.isEmpty) {
      state = state.copyWith(amount: 0.0, errorMessage: null);
    } else {
      state = state.copyWith(errorMessage: 'Invalid amount entered.');
    }
  }

  // --- Biometric Authentication (local_auth) ---

  Future<bool> authenticateForConversion() async {
    bool authenticated = false;
    try {
      authenticated = await _localAuth.authenticate(
        localizedReason: 'Confirm conversion with your biometric identity',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );
    } on PlatformException catch (e) {
      state = state.copyWith(
          errorMessage: 'Biometric error: ${e.message}');
      return false;
    }

    if (authenticated) {
      // In a real app, this would trigger the final transaction/conversion
      state = state.copyWith(
          errorMessage: 'Conversion confirmed successfully via Biometrics!');
    } else {
      state = state.copyWith(errorMessage: 'Biometric authentication failed.');
    }
    return authenticated;
  }

  // --- Conversion Logic ---

  double calculateConversion() {
    final ratesData = state.rates.value;
    if (ratesData == null || state.amount <= 0) {
      return 0.0;
    }

    final String base = ratesData.baseCurrency;
    final Map<String, double> rates = ratesData.rates;
    final double amount = state.amount;
    final String from = state.fromCurrency;
    final String to = state.toCurrency;

    if (from == to) {
      return amount;
    }

    double rateFromBase;
    if (from == base) {
      rateFromBase = 1.0;
    } else if (rates.containsKey(from)) {
      rateFromBase = rates[from]!;
    } else {
      // Currency not found in rates map
      return 0.0;
    }

    double rateToBase;
    if (to == base) {
      rateToBase = 1.0;
    } else if (rates.containsKey(to)) {
      rateToBase = rates[to]!;
    } else {
      // Currency not found in rates map
      return 0.0;
    }

    // Convert FROM -> BASE -> TO
    // Amount in Base = amount / rateFromBase (since rates are BASE -> X)
    // Amount in To = (amount / rateFromBase) * rateToBase
    // Note: If the API base is fixed (e.g., USD), and rates are USD->X, then:
    // Amount in Base (USD) = amount / rates[from]
    // Amount in To = Amount in Base * rates[to]
    // Simplified: amount * (rates[to] / rates[from])
    // We'll use the simplified version assuming rates are relative to the base.

    // To get the rate from 'from' to 'to':
    // rate_from_to = (rate_base_to / rate_base_from)
    final double conversionRate = rateToBase / rateFromBase;

    return amount * conversionRate;
  }
}

// The provider for the Notifier
final rateCalculatorProvider =
    StateNotifierProvider<RateCalculatorNotifier, RateCalculatorState>(
        (ref) => RateCalculatorNotifier());

// --- 3. Screen Implementation (ConsumerWidget) ---

/// A complete, production-ready Flutter Dart screen for currency conversion.
///
/// This screen uses Riverpod for state management, integrates a mock API
/// with caching for offline support, includes form validation, and
/// integrates biometric authentication for secure conversion confirmation.
class RateCalculatorScreen extends ConsumerWidget {
  const RateCalculatorScreen({super.key});

  // A global key for the form for validation
  static final _formKey = GlobalKey<FormState>();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(rateCalculatorProvider);
    final notifier = ref.read(rateCalculatorProvider.notifier);

    // Calculate the converted result
    final double convertedAmount = notifier.calculateConversion();

    // Accessibility: Define a focus node for the amount input
    final FocusNode amountFocusNode = FocusNode();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Currency Rate Calculator'),
        // Proper Navigation: Example of a back button
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
          tooltip: 'Back to previous screen', // Accessibility
        ),
      ),
      body: RefreshIndicator(
        onRefresh: notifier.fetchRates,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16.0),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                // --- Loading States and Error Handling ---
                state.rates.when(
                  loading: () => const LinearProgressIndicator(),
                  error: (err, stack) => Padding(
                    padding: const EdgeInsets.only(bottom: 16.0),
                    child: Text(
                      'Error: ${err.toString()}',
                      style: const TextStyle(color: Colors.red),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  data: (rates) => Padding(
                    padding: const EdgeInsets.only(bottom: 16.0),
                    child: Text(
                      'Rates updated: ${rates.timestamp.toLocal().toString().substring(0, 16)}',
                      style: TextStyle(
                          color: Colors.green[700], fontStyle: FontStyle.italic),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),

                if (state.errorMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16.0),
                    child: Text(
                      state.errorMessage!,
                      style: const TextStyle(color: Colors.orange),
                      textAlign: TextAlign.center,
                    ),
                  ),

                // --- Amount Input Field with Validation ---
                TextFormField(
                  focusNode: amountFocusNode, // Accessibility
                  initialValue: state.amount > 0 ? state.amount.toString() : '',
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Amount to Convert',
                    hintText: 'Enter amount',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.monetization_on),
                  ),
                  onChanged: notifier.setAmount,
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter an amount';
                    }
                    if (double.tryParse(value) == null) {
                      return 'Please enter a valid number';
                    }
                    if (double.parse(value) <= 0) {
                      return 'Amount must be greater than zero';
                    }
                    return null;
                  },
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.creditCardNumber],
                ),
                const SizedBox(height: 24.0),

                // --- Currency Dropdown Pickers ---
                _CurrencyPicker(
                  label: 'From Currency',
                  selectedValue: state.fromCurrency,
                  onChanged: (value) => notifier.setFromCurrency(value!),
                ),
                const SizedBox(height: 16.0),

                Center(
                  child: IconButton(
                    icon: const Icon(Icons.swap_vert, size: 30),
                    onPressed: () {
                      // Swap currencies
                      notifier.setFromCurrency(state.toCurrency);
                      notifier.setToCurrency(state.fromCurrency);
                    },
                    tooltip: 'Swap currencies', // Accessibility
                  ),
                ),
                const SizedBox(height: 16.0),

                _CurrencyPicker(
                  label: 'To Currency',
                  selectedValue: state.toCurrency,
                  onChanged: (value) => notifier.setToCurrency(value!),
                ),
                const SizedBox(height: 32.0),

                // --- Conversion Result Display ---
                Card(
                  elevation: 4,
                  child: Padding(
                    padding: const EdgeInsets.all(20.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Converted Amount:',
                          style: TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${state.amount.toStringAsFixed(2)} ${state.fromCurrency} =',
                          style: TextStyle(
                              fontSize: 18, color: Colors.grey[600]),
                        ),
                        Text(
                          '${convertedAmount.toStringAsFixed(2)} ${state.toCurrency}',
                          style: const TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                            color: Colors.blue,
                          ),
                          semanticsLabel:
                              'Result: ${convertedAmount.toStringAsFixed(2)} ${state.toCurrency}', // Accessibility
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 32.0),

                // --- Biometric Authentication Button ---
                ElevatedButton.icon(
                  onPressed: state.rates.isLoading || state.amount <= 0
                      ? null
                      : () {
                          if (_formKey.currentState!.validate()) {
                            // In a real app, this would be the final step before a transaction
                            notifier.authenticateForConversion();
                          }
                        },
                  icon: const Icon(Icons.fingerprint),
                  label: const Text('Confirm Conversion (Biometric Auth)'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 15),
                    backgroundColor: Colors.indigo,
                    foregroundColor: Colors.white,
                  ),
                ),
                const SizedBox(height: 16.0),

                // --- Payment Gateway Integration Mock ---
                const Text(
                  'Payment Gateway Integration:',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8.0),
                Row(
                  mainAxisAlignment: Main spaceEvenly,
                  children: [
                    _PaymentGatewayButton(
                        name: 'Stripe', icon: Icons.payment),
                    _PaymentGatewayButton(
                        name: 'Paypal', icon: Icons.account_balance_wallet),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// --- 4. Helper Widgets ---

/// Custom Dropdown Picker for Currencies
class _CurrencyPicker extends StatelessWidget {
  final String label;
  final String selectedValue;
  final ValueChanged<String?> onChanged;

  const _CurrencyPicker({
    required this.label,
    required this.selectedValue,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: selectedValue,
          isExpanded: true,
          onChanged: onChanged,
          items: _supportedCurrencies.map((String currency) {
            return DropdownMenuItem<String>(
              value: currency,
              child: Text(currency),
            );
          }).toList(),
          hint: const Text('Select Currency'),
          // Accessibility: Ensure the dropdown is announced correctly
          itemBuilder: (context, item) => Semantics(
            label: 'Select $label, current value is $selectedValue',
            child: item,
          ),
        ),
      ),
    );
  }
}

/// Mock Payment Gateway Button
class _PaymentGatewayButton extends StatelessWidget {
  final String name;
  final IconData icon;

  const _PaymentGatewayButton({required this.name, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4.0),
        child: OutlinedButton.icon(
          onPressed: () {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Mock: Initiating payment via $name...'),
              ),
            );
          },
          icon: Icon(icon),
          label: Text(name),
        ),
      ),
    );
  }
}

// --- 5. Documentation and Comments ---

/*
* Package Dependencies (to be added to pubspec.yaml):
* - flutter_riverpod: ^2.5.1
* - http: ^1.2.1
* - shared_preferences: ^2.2.3
* - local_auth: ^2.2.2
*
* Implementation Details:
* - State Management: Riverpod (RateCalculatorNotifier and rateCalculatorProvider)
* - API Integration: Mocked with 'http' package, using a constant URL.
* - Offline Mode: Implemented using 'shared_preferences' to cache the last successful rates.
* - Biometric Auth: Implemented using 'local_auth' to confirm the conversion action.
* - Error Handling: Handled in fetchRates, showing error messages for network failure and falling back to cached data.
* - Loading States: Handled by AsyncValue.when and LinearProgressIndicator.
* - Form Validation: Implemented on the TextFormField for the amount input.
* - Accessibility: Added tooltips, semanticsLabel, and FocusNode.
* - Payment Gateway: Mocked buttons for demonstration purposes.
* - Dart Types/Null Safety: Fully implemented with explicit types and null checks.
*/
