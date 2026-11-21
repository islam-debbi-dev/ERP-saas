import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../cart/logic/cart_cubit.dart';

/// Floating "Call to order" pill over [child]. It sits above the floating
/// bottom navigation, shows its label at rest and shrinks to a round phone
/// button while the user scrolls down, so it never hides the dishes.
/// Renders nothing when the admin set no phone numbers.
class CallToOrderOverlay extends StatefulWidget {
  const CallToOrderOverlay({
    super.key,
    required this.phones,
    required this.closed,
    required this.child,
  });

  final List<String> phones;

  /// Shop is closed: the sheet says so but still lets people call.
  final bool closed;
  final Widget child;

  @override
  State<CallToOrderOverlay> createState() => _CallToOrderOverlayState();
}

class _CallToOrderOverlayState extends State<CallToOrderOverlay> {
  /// Height of `CustomBottomNavigation` above the bottom safe area.
  static const double _navBarHeight = 72;

  /// `FloatingCartBar` in the tab shell: 56 pill + 4 bottom gap.
  static const double _cartBarHeight = 60;

  bool _extended = true;

  bool _onScroll(UserScrollNotification n) {
    if (n.metrics.axis != Axis.vertical) return false;
    final extended = switch (n.direction) {
      ScrollDirection.reverse => false,
      ScrollDirection.forward => true,
      ScrollDirection.idle => n.metrics.pixels <= n.metrics.minScrollExtent,
    };
    // Back at the very top always shows the label again.
    if (extended != _extended &&
        (n.direction != ScrollDirection.idle || extended)) {
      setState(() => _extended = extended);
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final body = NotificationListener<UserScrollNotification>(
      onNotification: _onScroll,
      child: widget.child,
    );
    if (widget.phones.isEmpty) return body;

    // The floating cart pill sits right above the bottom nav while the cart
    // has items; lift the call button over it so they never overlap.
    final cartShown = context.select<CartCubit, bool>((c) => !c.state.isEmpty);
    final bottom =
        MediaQuery.viewPaddingOf(context).bottom +
        _navBarHeight +
        (cartShown ? _cartBarHeight : 0) +
        AppSpacing.lg;
    return Stack(
      children: [
        body,
        AnimatedPositionedDirectional(
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
          end: AppSpacing.screenH,
          bottom: bottom,
          child: _CallFab(
            extended: _extended,
            onPressed: () {
              HapticFeedback.selectionClick();
              showCallToOrderSheet(
                context,
                phones: widget.phones,
                closed: widget.closed,
              );
            },
          ),
        ),
      ],
    );
  }
}

class _CallFab extends StatelessWidget {
  const _CallFab({required this.extended, required this.onPressed});

  final bool extended;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final label = context.tr('jb.home.call_fab');
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 220);

    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: AppColors.ink,
        shape: const StadiumBorder(
          side: BorderSide(color: AppColors.yellow, width: 1.5),
        ),
        elevation: 6,
        shadowColor: Colors.black.withValues(alpha: 0.35),
        child: InkWell(
          customBorder: const StadiumBorder(),
          splashColor: AppColors.yellow.withValues(alpha: 0.2),
          onTap: onPressed,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
            child: AnimatedSize(
              duration: duration,
              curve: Curves.easeOutCubic,
              alignment: AlignmentDirectional.centerStart,
              child: Padding(
                padding: EdgeInsetsDirectional.only(
                  start: AppSpacing.lg,
                  end: extended ? AppSpacing.xl : AppSpacing.lg,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.phone_in_talk_rounded,
                      color: AppColors.yellow,
                      size: 24,
                    ),
                    if (extended) ...[
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        label,
                        maxLines: 1,
                        style: AppTextStyles.button.copyWith(
                          color: AppColors.white,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Bottom sheet listing the admin's order lines; tapping one opens the dialer.
Future<void> showCallToOrderSheet(
  BuildContext context, {
  required List<String> phones,
  bool closed = false,
}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final failedText = context.tr('jb.home.call_failed');

  Future<void> dial(BuildContext sheet, String phone) async {
    Navigator.pop(sheet);
    final uri = Uri(
      scheme: 'tel',
      path: phone.replaceAll(RegExp(r'[^\d+]'), ''),
    );
    final opened = await launchUrl(uri).catchError((_) => false);
    if (!opened) {
      messenger?.showSnackBar(SnackBar(content: Text(failedText)));
    }
  }

  return showModalBottomSheet<void>(
    context: context,
    // Root navigator: the tab navigator sits under the floating bottom bar,
    // which would otherwise cover the bottom of the sheet.
    useRootNavigator: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.screenH,
          0,
          AppSpacing.screenH,
          AppSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 64,
                height: 64,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.yellow,
                ),
                child: const Icon(
                  Icons.support_agent_rounded,
                  color: AppColors.ink,
                  size: 32,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              sheet.tr('jb.home.call_title'),
              textAlign: TextAlign.center,
              style: AppTextStyles.h3.copyWith(color: sheet.textMain),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              sheet.tr('jb.home.call_subtitle'),
              textAlign: TextAlign.center,
              style: AppTextStyles.body.copyWith(color: sheet.textMuted),
            ),
            if (closed) ...[
              const SizedBox(height: AppSpacing.md),
              _ClosedNote(text: sheet.tr('jb.home.call_closed')),
            ],
            const SizedBox(height: AppSpacing.xl),
            for (var i = 0; i < phones.length; i++) ...[
              if (i > 0) const SizedBox(height: AppSpacing.md),
              _PhoneLine(
                label: sheet.tr('jb.home.call_line', args: {'n': '${i + 1}'}),
                phone: phones[i],
                primary: i == 0,
                onTap: () => dial(sheet, phones[i]),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

class _PhoneLine extends StatelessWidget {
  const _PhoneLine({
    required this.label,
    required this.phone,
    required this.primary,
    required this.onTap,
  });

  final String label;
  final String phone;
  final bool primary;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bg = primary ? AppColors.yellow : context.fieldFill;
    final fg = primary ? AppColors.ink : context.textMain;
    final sub = primary
        ? AppColors.ink.withValues(alpha: 0.7)
        : context.textMuted;

    return Semantics(
      button: true,
      label: context.tr('jb.home.call_action', args: {'phone': phone}),
      excludeSemantics: true,
      child: Material(
        color: bg,
        borderRadius: AppRadius.lgAll,
        child: InkWell(
          borderRadius: AppRadius.lgAll,
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 72),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.md,
            ),
            decoration: BoxDecoration(
              borderRadius: AppRadius.lgAll,
              border: primary ? null : Border.all(color: context.fieldBorder),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        label,
                        style: AppTextStyles.caption.copyWith(color: sub),
                      ),
                      const SizedBox(height: AppSpacing.xxs),
                      // Numbers always read left to right, even in Arabic.
                      Directionality(
                        textDirection: TextDirection.ltr,
                        child: Text(
                          phone,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.h3.copyWith(
                            color: fg,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: primary ? AppColors.ink : AppColors.yellow,
                  ),
                  child: Icon(
                    Icons.call_rounded,
                    color: primary ? AppColors.yellow : AppColors.ink,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ClosedNote extends StatelessWidget {
  const _ClosedNote({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.12),
        borderRadius: AppRadius.mdAll,
      ),
      child: Row(
        children: [
          const Icon(
            Icons.schedule_rounded,
            size: 18,
            color: AppColors.warning,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.caption.copyWith(color: context.textMain),
            ),
          ),
        ],
      ),
    );
  }
}
