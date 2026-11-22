import 'package:flutter/widgets.dart';

import '../localization/tr.dart';
import 'api_error.dart';

/// Which API error codes the app translates itself, and how a failure turns
/// into text. Codes come from `packages/shared/src/errors.ts`; the strings are
/// the web's (`apps/web/src/messages/*.json` → `errors`) so both say the same.
class ErrorMessages {
  ErrorMessages._();

  /// Codes a field screen can meet, each with an `errors.<CODE>` string in
  /// ar / fr / en. Any other code shows the API's message.
  static const translatedCodes = <String>{
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'NOT_FOUND',
    'CONFLICT',
    'FORBIDDEN',
    'TOO_MANY_REQUESTS',
    'DB_UNAVAILABLE',
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'TOKEN_EXPIRED',
    'INVALID_TOKEN',
    'SESSION_REVOKED',
    'SESSION_EXPIRED',
    'REFRESH_TOKEN_REUSED',
    'ACCOUNT_LOCKED',
    'PASSWORD_CHANGE_REQUIRED',
    'USER_DEACTIVATED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'STOCK_INSUFFICIENT',
    'CREDIT_LIMIT_EXCEEDED',
    'CLIENT_REQUIRED_FOR_CREDIT',
    'PRICE_OVERRIDE_FORBIDDEN',
    'PRICE_MISSING',
    'SUBSCRIPTION_SUSPENDED',
    'PLAN_LIMIT_REACHED',
    'FEATURE_NOT_IN_PLAN',
    'MOBILE_SELLER_LIMIT',
    'SELLER_HAS_NO_VEHICLE',
    'SESSION_OPEN_ON_VEHICLE',
    'CASH_AFTER_CLOSING',
    'ORDER_NOT_CONFIRMED',
    'ORDER_ALREADY_DELIVERED',
    'ORDER_DELIVERY_QTY_INVALID',
    'ORDER_NOT_DRAFT',
    'ORDER_EMPTY',
    'SALE_EMPTY',
    'GEO_NOTE_REQUIRED',
    'GEO_TOO_FAR',
    'GEO_MOCKED',
    'GEO_CHANGE_NEEDS_APPROVAL',
    'TRANSFER_NOT_DRAFT',
    'TRANSFER_NOT_VALIDATED',
    'TRANSFER_EMPTY',
    'PRODUCT_NOT_IN_WAREHOUSE',
    'INVENTORY_CLOSED',
    'PROMO_OVERRIDE_FORBIDDEN',
    'CLIENT_CODE_TAKEN',
    'PHONE_ALREADY_USED',
    'AI_QUOTA_EXCEEDED',
    'AI_RATE_LIMITED',
    'AI_DAILY_LIMIT',
    'AI_NOT_CONFIGURED',
    'AI_UNAVAILABLE',
  };

  /// The i18n key for [error], or null when the API's message must be shown.
  static String? keyFor(ApiError error) {
    switch (error.kind) {
      case ApiErrorKind.offline:
        return 'errors.offline';
      case ApiErrorKind.timeout:
        return 'errors.timeout';
      case ApiErrorKind.cancelled:
        return 'errors.cancelled';
      case ApiErrorKind.unknown:
        return 'errors.unknown';
      case ApiErrorKind.server:
        if (translatedCodes.contains(error.code)) return 'errors.${error.code}';
        return error.message.isEmpty ? 'errors.unknown' : null;
    }
  }
}

/// The text to show for a failed request: the translated message for a known
/// code, else the API's own message.
String apiErrorText(BuildContext context, ApiError error) {
  final key = ErrorMessages.keyFor(error);
  return key == null ? error.message : context.tr(key);
}
