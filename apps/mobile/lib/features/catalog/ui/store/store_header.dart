import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/network/image_url.dart';
import '../../../cart/ui/widgets/cart_icon_button.dart';
import '../../data/models/store.dart';
import '../widgets/expandable_text.dart';
import '../widgets/store_tile.dart';
import 'store_hours.dart';
import 'store_info_sheet.dart';

/// Pinned top of the store page. Expanded: a short cover with a soft
/// gradient and the round logo sitting on its lower edge. Collapsed: an
/// iOS-like translucent bar (blurred content behind) with the store name
/// centred between the back and cart buttons.
class StoreNavHeaderDelegate extends SliverPersistentHeaderDelegate {
  StoreNavHeaderDelegate({required this.store, required this.topInset});

  final Store store;
  final double topInset;

  static const double coverHeight = 160;
  static const double logoSize = 72;

  /// Part of the logo hanging below the cover.
  static const double logoOverhang = logoSize / 2;

  /// How far the page scrolls before the bar is fully collapsed.
  double get collapseRange => maxExtent - minExtent;

  @override
  double get maxExtent => topInset + coverHeight + logoOverhang;

  @override
  double get minExtent => topInset + kToolbarHeight;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlaps) {
    // 1 = fully expanded, 0 = collapsed.
    final t = (1 - shrinkOffset / collapseRange).clamp(0.0, 1.0);
    final coverOpacity = ((t - 0.2) / 0.8).clamp(0.0, 1.0);
    final barOpacity = ((0.45 - t) / 0.45).clamp(0.0, 1.0);
    final page = context.pageBackground;

    return Stack(
      fit: StackFit.expand,
      children: [
        // Strip under the cover where the logo overhangs.
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: logoOverhang,
          child: Opacity(
            opacity: t,
            child: ColoredBox(color: page),
          ),
        ),
        // Translucent bar: the content scrolling under it shows blurred.
        if (barOpacity > 0)
          Opacity(
            opacity: barOpacity,
            child: ClipRect(
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: page.withValues(alpha: 0.82),
                    border: Border(
                      bottom: BorderSide(
                        color: context.fieldBorder,
                        width: 0.5,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (coverOpacity > 0)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            bottom: logoOverhang * t,
            child: Opacity(
              opacity: coverOpacity,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  // Flies in from the store card's cover.
                  Hero(
                    tag: storeCoverHeroTag(store.id),
                    child: NetImage(
                      url: store.cover.isNotEmpty || store.coverMedia != null
                          ? store.cover
                          : store.logo,
                      media: store.cover.isNotEmpty || store.coverMedia != null
                          ? store.coverMedia
                          : store.logoMedia,
                      size: ImageSize.large,
                      placeholderIcon: Icons.storefront_outlined,
                    ),
                  ),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          AppColors.ink.withValues(alpha: 0.35),
                          AppColors.ink.withValues(alpha: 0),
                          AppColors.ink.withValues(alpha: 0.25),
                        ],
                        stops: const [0, 0.45, 1],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (coverOpacity > 0)
          PositionedDirectional(
            start: AppSpacing.screenH,
            bottom: 0,
            child: Opacity(
              opacity: coverOpacity,
              child: Transform.scale(
                scale: 0.7 + 0.3 * t,
                alignment: AlignmentDirectional.bottomStart,
                child: Container(
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    color: page,
                    shape: BoxShape.circle,
                    boxShadow: AppShadows.card,
                  ),
                  child: StoreLogo(
                    url: store.logo,
                    media: store.logoMedia,
                    size: logoSize - 6,
                  ),
                ),
              ),
            ),
          ),
        Positioned(
          top: topInset,
          left: 0,
          right: 0,
          height: kToolbarHeight,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Row(
              children: [
                AppRoundIconButton(
                  icon: Icons.adaptive.arrow_back_rounded,
                  tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                  onPressed: () => context.pop(),
                ),
                Expanded(
                  child: ExcludeSemantics(
                    excluding: barOpacity < 0.5,
                    child: Opacity(
                      opacity: barOpacity,
                      child: Text(
                        store.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                        style: AppTextStyles.h3.copyWith(
                          color: context.textMain,
                        ),
                      ),
                    ),
                  ),
                ),
                const CartIconButton(),
              ],
            ),
          ),
        ),
      ],
    );
  }

  @override
  bool shouldRebuild(StoreNavHeaderDelegate old) =>
      old.store != store || old.topInset != topInset;
}

/// Store name, a one-line subtitle, compact info pills, the description on
/// two lines and, for a closed store, when it opens. Address and the full
/// week of hours live in the info sheet (ⓘ).
class StoreHeader extends StatelessWidget {
  const StoreHeader({super.key, required this.store, this.now});

  final Store store;

  /// Clock override for tests.
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final subtitle = [
      if (store.categories.isNotEmpty) store.categories.first.name,
      if (store.address.isNotEmpty) store.address,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.md,
        AppSpacing.screenH,
        AppSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  store.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.h1.copyWith(color: context.textMain),
                ),
              ),
              IconButton(
                onPressed: () => showStoreInfoSheet(context, store),
                tooltip: context.tr('jb.store.info'),
                icon: Icon(Icons.info_outline_rounded, color: context.textMain),
              ),
            ],
          ),
          if (subtitle.isNotEmpty)
            Text(
              subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.body.copyWith(color: context.textMuted),
            ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              _StatusPill(store: store, now: now ?? DateTime.now()),
            ],
          ),
          if ((store.description ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            ExpandableText(
              store.description!,
              maxLines: 2,
              style: AppTextStyles.body.copyWith(color: context.textMuted),
              moreKey: 'jb.store.more',
              lessKey: 'jb.store.less',
            ),
          ],
          if (!store.isOpen) ...[
            const SizedBox(height: AppSpacing.md),
            ClosedBanner(store: store, now: now ?? DateTime.now()),
          ],
        ],
      ),
    );
  }
}

/// Small rounded label of the header ("Open · 09:00–23:00", "Delivery
/// 200 DA"). Tappable pills keep a 44 pt touch target.
class InfoPill extends StatelessWidget {
  const InfoPill({
    super.key,
    required this.icon,
    required this.label,
    this.iconColor,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final Color? iconColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final pill = Container(
      height: 32,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      decoration: BoxDecoration(
        color: context.fieldFill,
        borderRadius: AppRadius.pillAll,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: iconColor ?? context.textMain),
          const SizedBox(width: AppSpacing.xs + 2),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.label.copyWith(color: context.textMain),
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return pill;
    return Semantics(
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.pillAll,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Center(widthFactor: 1, child: pill),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.store, required this.now});

  final Store store;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    if (!store.isOpen) {
      return InfoPill(
        icon: Icons.circle,
        iconColor: AppColors.error,
        label: context.tr('jb.store.closed_now'),
      );
    }
    final hours = todayHours(store, now);
    return InfoPill(
      icon: Icons.circle,
      iconColor: AppColors.success,
      label: hours == null
          ? context.tr('jb.store.open')
          : context.tr(
              'jb.store.open_hours',
              args: {'open': hours.open, 'close': hours.close},
            ),
    );
  }
}

/// "Closed now · opens at 18:00": the menu stays readable, "+" is disabled.
class ClosedBanner extends StatelessWidget {
  const ClosedBanner({super.key, required this.store, required this.now});

  final Store store;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final next = nextOpening(store, now);
    final title = switch (next) {
      null => context.tr('jb.store.closed_now'),
      NextOpening(daysFromNow: 0, :final time) => context.tr(
        'jb.store.closed_opens_at',
        args: {'time': time},
      ),
      NextOpening(:final day, :final time) => context.tr(
        'jb.store.closed_opens_on',
        args: {'day': context.tr('jb.store.day_$day'), 'time': time},
      ),
    };
    return Semantics(
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.isDarkMode
              ? AppColors.error.withValues(alpha: 0.16)
              : AppColors.errorTint,
          borderRadius: AppRadius.mdAll,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(
              Icons.nightlight_round,
              size: 20,
              color: AppColors.error,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: AppTextStyles.label.copyWith(
                      color: context.textMain,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    context.tr('jb.store.closed_browse'),
                    style: AppTextStyles.caption.copyWith(
                      color: context.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
