import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/features/auth/ui/widgets/password_field.dart';

void main() {
  test('normalizes Algerian mobile numbers like the backend', () {
    expect(normalizeAlgerianPhone('0555 00 02 01'), '+213555000201');
    expect(normalizeAlgerianPhone('+213 6-61-23-45-67'), '+213661234567');
    expect(normalizeAlgerianPhone('00213770000000'), '+213770000000');
    expect(normalizeAlgerianPhone('213555000201'), '+213555000201');
  });

  test('rejects landlines and malformed numbers', () {
    expect(normalizeAlgerianPhone('021 00 00 00'), isNull);
    expect(normalizeAlgerianPhone('0555'), isNull);
    expect(normalizeAlgerianPhone('+33612345678'), isNull);
  });
}
