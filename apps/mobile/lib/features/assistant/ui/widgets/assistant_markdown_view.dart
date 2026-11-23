import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/text_direction.dart';
import '../../logic/assistant_markdown.dart';

/// An answer rendered with the app's text styles: the Markdown subset of
/// [AssistantMarkdown], the direction of its first strong letter (Arabic →
/// RTL), and every amount isolated left to right so `1 234 567,89 DA`
/// stays in order inside Arabic.
class AssistantMarkdownView extends StatelessWidget {
  const AssistantMarkdownView({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final direction = textDirectionOf(
      text,
      fallback: Directionality.of(context),
    );
    final base = AppTextStyles.bodyLarge.copyWith(
      color: context.textMain,
      height: 1.5,
    );
    final blocks = AssistantMarkdown.parse(text);
    return Directionality(
      textDirection: direction,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < blocks.length; i++) ...[
            if (i > 0)
              SizedBox(
                height: blocks[i] is MdParagraph || blocks[i - 1] is MdParagraph
                    ? AppSpacing.sm
                    : AppSpacing.xs,
              ),
            _block(blocks[i], base),
          ],
        ],
      ),
    );
  }

  Widget _block(MdBlock block, TextStyle base) {
    final body = Text.rich(TextSpan(children: _spans(block.spans, base)));
    final marker = switch (block) {
      MdBullet() => '•',
      MdNumbered(:final number) => '$number.',
      MdParagraph() => null,
    };
    if (marker == null) return body;
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 22),
            child: Text(marker, style: base),
          ),
          const SizedBox(width: AppSpacing.xs),
          Expanded(child: body),
        ],
      ),
    );
  }

  static List<InlineSpan> _spans(List<MdSpan> spans, TextStyle base) => [
    for (final s in spans)
      TextSpan(
        text: isolateAmounts(s.text),
        style: base.copyWith(
          fontWeight: s.bold ? FontWeight.w700 : null,
          decoration: s.link ? TextDecoration.underline : null,
        ),
      ),
  ];
}
