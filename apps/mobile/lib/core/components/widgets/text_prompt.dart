import 'package:flutter/material.dart';

import '../../localization/tr.dart';

/// Asks for one line of text (a GPS note, a cancel reason). Null when the
/// user cancels. [minLength] mirrors the API's rule (e.g. a reason ≥ 3).
Future<String?> askText(
  BuildContext context, {
  required String title,
  required String label,
  String? message,
  int minLength = 1,
  int maxLength = 255,
  String? confirmLabel,
}) => showDialog<String>(
  context: context,
  builder: (context) => _TextPrompt(
    title: title,
    label: label,
    message: message,
    minLength: minLength,
    maxLength: maxLength,
    confirmLabel: confirmLabel,
  ),
);

class _TextPrompt extends StatefulWidget {
  const _TextPrompt({
    required this.title,
    required this.label,
    required this.minLength,
    required this.maxLength,
    this.message,
    this.confirmLabel,
  });

  final String title;
  final String label;
  final String? message;
  final int minLength;
  final int maxLength;
  final String? confirmLabel;

  @override
  State<_TextPrompt> createState() => _TextPromptState();
}

class _TextPromptState extends State<_TextPrompt> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _valid => _controller.text.trim().length >= widget.minLength;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.message != null) ...[
            Text(widget.message!),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _controller,
            autofocus: true,
            maxLength: widget.maxLength,
            minLines: 1,
            maxLines: 3,
            decoration: InputDecoration(labelText: widget.label),
            onChanged: (_) => setState(() {}),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(context.tr('common.cancel')),
        ),
        FilledButton(
          onPressed: _valid
              ? () => Navigator.of(context).pop(_controller.text.trim())
              : null,
          child: Text(widget.confirmLabel ?? context.tr('common.confirm')),
        ),
      ],
    );
  }
}
