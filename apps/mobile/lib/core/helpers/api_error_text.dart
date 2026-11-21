import 'package:flutter/widgets.dart';

import '../localization/tr.dart';
import '../service/api_error_handler.dart';

/// User-facing text for a failed request.
///
/// Backend errors already carry a message localized from the request
/// language; local failures (timeouts, offline) carry an `ApiErrors` key
/// that is translated here.
String apiErrorText(BuildContext context, ErrorHandler error) {
  final message = error.apiErrorModel.message;
  if (message == null || message.isEmpty) return context.tr('error_unknown');
  final code = error.apiErrorModel.code ?? '';
  final isLocal = code.startsWith('-');
  return isLocal ? context.tr(message) : message;
}

/// True when the failure means "no network" rather than a server answer.
bool isOfflineError(ErrorHandler error) {
  final code = error.apiErrorModel.code ?? '';
  return code == ResponseCode.NO_INTERNET_CONNECTION ||
      code == ResponseCode.CONNECT_TIMEOUT ||
      code == ResponseCode.RECIEVE_TIMEOUT;
}
