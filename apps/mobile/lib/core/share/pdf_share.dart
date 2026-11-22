import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../di/dependency_injection.dart';
import '../network/api_client.dart';
import '../network/api_result.dart';
import '../network/error_messages.dart';

/// Downloads a PDF the API renders (BL, reçu, relevé: printed in French) and
/// opens the share sheet (WhatsApp, e-mail...). Errors show in a snackbar.
Future<void> sharePdf(
  BuildContext context, {
  required String path,
  required String fileName,
  Map<String, dynamic>? query,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final result = await getIt<ApiClient>().getBytes(path, query: query);
  switch (result) {
    case Success(:final data):
      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(data, mimeType: 'application/pdf', name: fileName),
          ],
          fileNameOverrides: [fileName],
        ),
      );
    case Failure(:final error):
      if (!context.mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(apiErrorText(context, error))),
      );
  }
}

/// `BL-2026-000123.pdf`, or a fallback when the document has no number yet.
String pdfName(String? number, String fallback) =>
    '${(number ?? fallback).replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.pdf';
