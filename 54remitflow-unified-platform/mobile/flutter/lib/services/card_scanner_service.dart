import 'dart:io';
import 'package:google_ml_kit/google_ml_kit.dart';

class CardScannerService {
  final TextRecognizer _textRecognizer = GoogleMlKit.vision.textRecognizer();

  Future<Map<String, String>> scanCard(String imagePath) async {
    try {
      final inputImage = InputImage.fromFilePath(imagePath);
      final RecognizedText recognizedText = await _textRecognizer.processImage(inputImage);
      
      final text = recognizedText.text;
      return _extractCardDetails(text);
    } catch (e) {
      print('Card scan error: $e');
      rethrow;
    }
  }

  Map<String, String> _extractCardDetails(String text) {
    final cardNumberPattern = RegExp(r'\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b');
    final cardNumberMatch = cardNumberPattern.firstMatch(text);
    final cardNumber = cardNumberMatch != null 
        ? cardNumberMatch.group(1)!.replaceAll(RegExp(r'[\s\-]'), '') 
        : '';

    final expiryPattern = RegExp(r'\b(0[1-9]|1[0-2])[\/\-](\d{2}|\d{4})\b');
    final expiryMatch = expiryPattern.firstMatch(text);
    final expiryDate = expiryMatch != null ? expiryMatch.group(0)! : '';

    return {
      'cardNumber': cardNumber,
      'expiryDate': expiryDate,
      'cardType': _detectCardType(cardNumber),
    };
  }

  String _detectCardType(String cardNumber) {
    if (cardNumber.isEmpty) return 'unknown';
    
    if (RegExp(r'^4').hasMatch(cardNumber)) return 'visa';
    if (RegExp(r'^5[1-5]').hasMatch(cardNumber)) return 'mastercard';
    if (RegExp(r'^3[47]').hasMatch(cardNumber)) return 'amex';
    
    return 'unknown';
  }

  void dispose() {
    _textRecognizer.close();
  }
}
