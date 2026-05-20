import 'package:pay/pay.dart';

class PaymentService {
  final Pay _payClient = Pay.withAssets([
    'default_payment_profile_apple_pay.json',
    'default_payment_profile_google_pay.json',
  ]);

  Future<bool> isApplePayAvailable() async {
    return await _payClient.userCanPay(PayProvider.apple_pay);
  }

  Future<bool> isGooglePayAvailable() async {
    return await _payClient.userCanPay(PayProvider.google_pay);
  }

  Future<void> processApplePay({
    required String amount,
    required String currency,
  }) async {
    final paymentItems = [
      PaymentItem(
        label: 'Total',
        amount: amount,
        status: PaymentItemStatus.final_price,
      )
    ];

    final result = await _payClient.showPaymentSelector(
      PayProvider.apple_pay,
      paymentItems,
    );

    // Process result
    print('Payment result: $result');
  }

  Future<void> processGooglePay({
    required String amount,
    required String currency,
  }) async {
    final paymentItems = [
      PaymentItem(
        label: 'Total',
        amount: amount,
        status: PaymentItemStatus.final_price,
      )
    ];

    final result = await _payClient.showPaymentSelector(
      PayProvider.google_pay,
      paymentItems,
    );

    print('Payment result: $result');
  }
}
