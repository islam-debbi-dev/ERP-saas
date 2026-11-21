import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';

/// Text clamped to [maxLines] with a "Read more" / "Show less" toggle, shown
/// only when the text is longer.
class ExpandableText extends StatefulWidget {
  const ExpandableText(
    this.text, {
    super.key,
    this.maxLines = 4,
    this.style,
    this.moreKey = 'jb.product.read_more',
    this.lessKey = 'jb.product.read_less',
  });

  final String text;
  final int maxLines;
  final TextStyle? style;
  final String moreKey;
  final String lessKey;

  @override
  State<ExpandableText> createState() => _ExpandableTextState();
}

class _ExpandableTextState extends State<ExpandableText> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final style =
        widget.style ??
        AppTextStyles.bodyLarge.copyWith(color: context.textMuted);
    return LayoutBuilder(
      builder: (context, constraints) {
        final painter = TextPainter(
          text: TextSpan(text: widget.text, style: style),
          maxLines: widget.maxLines,
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(maxWidth: constraints.maxWidth);
        final overflows = painter.didExceedMaxLines;
        painter.dispose();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AnimatedSize(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
              alignment: AlignmentDirectional.topStart,
              child: Text(
                widget.text,
                style: style,
                maxLines: _expanded ? null : widget.maxLines,
                overflow: _expanded ? null : TextOverflow.ellipsis,
              ),
            ),
            if (overflows)
              TextButton(
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, AppSpacing.minTouch),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: () => setState(() => _expanded = !_expanded),
                child: Text(
                  context.tr(_expanded ? widget.lessKey : widget.moreKey),
                ),
              ),
          ],
        );
      },
    );
  }
}
