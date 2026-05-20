import 'package:flutter_test/flutter_test.dart';
import 'package:nigerian_remittance_flutter/services/security_service.dart';

void main() {
  group('SecurityService', () {
    test('should hash data correctly', () {
      final hash1 = SecurityService.hash('test data');
      final hash2 = SecurityService.hash('test data');
      expect(hash1, equals(hash2));
    });

    test('should generate different hashes for different data', () {
      final hash1 = SecurityService.hash('test data 1');
      final hash2 = SecurityService.hash('test data 2');
      expect(hash1, isNot(equals(hash2)));
    });

    test('should encrypt data', () {
      final encrypted = SecurityService.encrypt('sensitive data', 'key123');
      expect(encrypted, isNotEmpty);
    });
  });
}
