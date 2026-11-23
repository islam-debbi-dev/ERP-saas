import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/text_direction.dart';
import '../../../../core/localization/tr.dart';
import '../assistant_screen.dart' show ProviderNotice;

/// The question box at the bottom of the chat: above the keyboard and the
/// gesture bar (the screen resizes for the keyboard; [SafeArea] keeps the
/// system bar clear). While an answer streams, send gives way to stop.
class ChatInputBar extends StatelessWidget {
  const ChatInputBar({
    super.key,
    required this.controller,
    required this.streaming,
    required this.provider,
    required this.onSend,
    required this.onStop,
  });

  /// `AI_MESSAGE_MAX_LENGTH` of the shared schema.
  static const maxLength = 2000;

  final TextEditingController controller;
  final bool streaming;
  final String? provider;
  final VoidCallback onSend;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.cardColor,
      child: SafeArea(
        top: false,
        child: Container(
          decoration: BoxDecoration(
            border: BorderDirectional(
              top: BorderSide(color: context.fieldBorder),
            ),
          ),
          padding: const EdgeInsetsDirectional.fromSTEB(
            AppSpacing.md,
            AppSpacing.sm,
            AppSpacing.sm,
            AppSpacing.sm,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: controller,
                builder: (context, value, _) {
                  final empty = value.text.trim().isEmpty;
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('assistant-input'),
                          controller: controller,
                          minLines: 1,
                          maxLines: 5,
                          maxLength: maxLength,
                          textDirection: empty
                              ? null
                              : textDirectionOf(value.text),
                          textInputAction: TextInputAction.newline,
                          keyboardType: TextInputType.multiline,
                          style: AppTextStyles.bodyLarge,
                          decoration: InputDecoration(
                            hintText: context.tr('assistant.input_placeholder'),
                            counterText: '',
                            isDense: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      if (streaming)
                        IconButton(
                          key: const Key('assistant-stop'),
                          tooltip: context.tr('assistant.stop'),
                          constraints: const BoxConstraints(
                            minWidth: AppSpacing.minTouch,
                            minHeight: AppSpacing.minTouch,
                          ),
                          onPressed: onStop,
                          icon: const Icon(Icons.stop_circle_outlined),
                        )
                      else
                        IconButton.filled(
                          key: const Key('assistant-send'),
                          tooltip: context.tr('assistant.send'),
                          constraints: const BoxConstraints(
                            minWidth: AppSpacing.minTouch,
                            minHeight: AppSpacing.minTouch,
                          ),
                          onPressed: empty ? null : onSend,
                          icon: const Icon(Icons.send_rounded),
                        ),
                    ],
                  );
                },
              ),
              const SizedBox(height: AppSpacing.xs),
              ProviderNotice(provider: provider),
            ],
          ),
        ),
      ),
    );
  }
}
