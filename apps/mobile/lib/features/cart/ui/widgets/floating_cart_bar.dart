import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/router/routes.dart';
import '../../../catalog/data/models/product.dart';
import '../../logic/cart_cubit.dart';
import 'cart_flight.dart';

/// Pill that floats above the content while the cart has items: count,
/// "View cart" and the subtotal. Tapping it opens the cart.
///
/// After every add it briefly reads "Added: {product}" and the count bumps,
/// so the client sees the tap landed without a blocking snackbar.
class FloatingCartBar extends StatefulWidget {
  const FloatingCartBar({super.key, this.padding = _defaultPadding});

  /// Height the bar takes (with its default padding) when shown; lists that
  /// scroll under it add this at the end so their last row stays reachable.
  static const double clearance = 56 + AppSpacing.sm * 2;

  static const EdgeInsets _defaultPadding = EdgeInsets.fromLTRB(
    AppSpacing.lg,
    AppSpacing.sm,
    AppSpacing.lg,
    AppSpacing.sm,
  );

  final EdgeInsets padding;

  @override
  State<FloatingCartBar> createState() => _FloatingCartBarState();
}

class _FloatingCartBarState extends State<FloatingCartBar>
    with SingleTickerProviderStateMixin {
  final List<StreamSubscription<Product>> _subs = [];
  Timer? _resetTimer;
  String? _addedName;

  /// Count and subtotal on screen (lag behind the cart during a flight).
  (int, num)? _shown;

  late final AnimationController _bump = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 380),
  );
  late final Animation<double> _bumpScale = TweenSequence<double>([
    TweenSequenceItem(tween: Tween(begin: 1, end: 1.28), weight: 35),
    TweenSequenceItem(
      tween: Tween<double>(
        begin: 1.28,
        end: 1,
      ).chain(CurveTween(curve: Curves.elasticOut)),
      weight: 65,
    ),
  ]).animate(_bump);

  @override
  void initState() {
    super.initState();
    // With a fly-to-cart thumbnail in the air, the bump waits for its impact
    // so the bar and the cart icon react together.
    _subs
      ..add(
        context.read<CartCubit>().added.listen((product) {
          if (!CartFlight.deferring) _onAdded(product);
        }),
      )
      ..add(CartFlight.impacts.listen(_onAdded));
  }

  void _onAdded(Product product) {
    if (!mounted) return;
    final cart = context.read<CartCubit>().state;
    setState(() {
      _addedName = product.name;
      _shown = (cart.lineCount, cart.subtotal);
    });
    if (!MediaQuery.disableAnimationsOf(context)) _bump.forward(from: 0);
    _resetTimer?.cancel();
    _resetTimer = Timer(const Duration(milliseconds: 1800), () {
      if (mounted) setState(() => _addedName = null);
    });
  }

  @override
  void dispose() {
    for (final sub in _subs) {
      sub.cancel();
    }
    _resetTimer?.cancel();
    _bump.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final live = context.select<CartCubit, (int, num)>(
      (c) => (c.state.lineCount, c.state.subtotal),
    );
    // While a fly-to-cart thumbnail is in the air the bar keeps its last
    // numbers, so they change with the cart icon's badge, on impact.
    if (_shown == null || !CartFlight.deferring || live.$1 < _shown!.$1) {
      _shown = live;
    }
    final (count, subtotal) = _shown!;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    return AnimatedSwitcher(
      duration: reduceMotion
          ? Duration.zero
          : const Duration(milliseconds: 260),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) => SizeTransition(
        sizeFactor: animation,
        alignment: Alignment.bottomCenter,
        child: FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween(
              begin: const Offset(0, 0.4),
              end: Offset.zero,
            ).animate(animation),
            child: child,
          ),
        ),
      ),
      child: count == 0
          ? const SizedBox(width: double.infinity, key: ValueKey('empty'))
          : Padding(
              key: const ValueKey('bar'),
              padding: widget.padding,
              child: Center(
                heightFactor: 1,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: _Pill(
                    count: count,
                    subtotal: subtotal,
                    addedName: _addedName,
                    bumpScale: _bumpScale,
                    reduceMotion: reduceMotion,
                  ),
                ),
              ),
            ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({
    required this.count,
    required this.subtotal,
    required this.addedName,
    required this.bumpScale,
    required this.reduceMotion,
  });

  final int count;
  final num subtotal;
  final String? addedName;
  final Animation<double> bumpScale;
  final bool reduceMotion;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    // Ink pill with a yellow count in light mode; inverted in dark mode so
    // it still stands out from the dark surface.
    final bg = dark ? AppColors.yellow : AppColors.ink;
    final fg = dark ? AppColors.ink : AppColors.white;
    final badgeBg = dark ? AppColors.ink : AppColors.yellow;
    final badgeFg = dark ? AppColors.yellow : AppColors.ink;
    final added = addedName != null;
    final label = added
        ? context.tr('jb.cart.added_named', args: {'name': addedName!})
        : context.tr('jb.cart.view');

    return Semantics(
      button: true,
      liveRegion: added,
      label: added
          ? context.tr('jb.cart.added')
          : '${context.tr('jb.cart.view')}, $count, '
                '${formatDzd(context, subtotal)}',
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          borderRadius: AppRadius.pillAll,
          boxShadow: AppShadows.floating,
        ),
        child: Material(
          color: bg,
          borderRadius: AppRadius.pillAll,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => context.push(Routes.cart),
            child: Container(
              height: 56,
              padding: const EdgeInsetsDirectional.fromSTEB(
                AppSpacing.sm,
                0,
                AppSpacing.lg,
                0,
              ),
              child: Row(
                children: [
                  ScaleTransition(
                    scale: bumpScale,
                    child: Container(
                      width: 40,
                      height: 40,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: badgeBg,
                        shape: BoxShape.circle,
                      ),
                      child: AnimatedSwitcher(
                        duration: reduceMotion
                            ? Duration.zero
                            : const Duration(milliseconds: 200),
                        child: added
                            ? Icon(
                                Icons.check_rounded,
                                key: const ValueKey('check'),
                                size: 22,
                                color: badgeFg,
                              )
                            : Text(
                                count > 99 ? '99+' : '$count',
                                key: ValueKey(count),
                                style: AppTextStyles.label.copyWith(
                                  color: badgeFg,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: reduceMotion
                          ? Duration.zero
                          : const Duration(milliseconds: 220),
                      transitionBuilder: (child, a) => FadeTransition(
                        opacity: a,
                        child: SlideTransition(
                          position: Tween(
                            begin: const Offset(0, 0.35),
                            end: Offset.zero,
                          ).animate(a),
                          child: child,
                        ),
                      ),
                      layoutBuilder: (current, previous) => Stack(
                        alignment: AlignmentDirectional.centerStart,
                        children: [...previous, if (current != null) current],
                      ),
                      child: Text(
                        label,
                        key: ValueKey(label),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.button.copyWith(color: fg),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    formatDzd(context, subtotal),
                    style: AppTextStyles.label.copyWith(
                      color: fg,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  Icon(
                    Directionality.of(context) == TextDirection.rtl
                        ? Icons.chevron_left_rounded
                        : Icons.chevron_right_rounded,
                    color: fg,
                    size: 22,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
