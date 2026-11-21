import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/models/media_ref.dart';
import '../../../../core/network/image_url.dart';
import '../../../../core/router/routes.dart';
import '../../data/models/store.dart';
import '../store/store_hours.dart';
import 'pressable_card.dart';

/// The two sizes of [StoreTile].
enum StoreTileSize {
  /// Full-width card of the all-stores list (16:10).
  list,

  /// Narrower card of the home "Restaurants" row (280 × 200), so the next
  /// card peeks at the edge.
  row,
}

/// Hero tag shared by the card cover and the store page cover.
String storeCoverHeroTag(String storeId) => 'store-cover-$storeId';

/// Premium store card: the cover fills the card, a soft scrim carries the
/// logo, name, category · address and the open / closed status; a small
/// pill in the corner gives the delivery fee from the app settings.
/// A closed store is slightly desaturated and stays tappable.
class StoreTile extends StatelessWidget {
  const StoreTile({
    super.key,
    required this.store,
    this.size = StoreTileSize.row,
    this.categoryName,
    this.now,
  });

  final Store store;
  final StoreTileSize size;

  /// Main category of the store when the screen knows it (the list
  /// endpoints only send `categoryIds`).
  final String? categoryName;

  /// Clock override for tests.
  final DateTime? now;

  static const double rowWidth = 280;
  static const double rowHeight = 200;
  static const double radius = 20;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;
    final subtitle = [
      if ((categoryName ?? '').isNotEmpty) categoryName!,
      if (store.address.isNotEmpty) store.address,
    ].join(' · ');
    final status = _statusText(context);
    final card = PressableCard(
      semanticLabel: [
        store.name,
        status,
        subtitle,
      ].where((s) => s.isNotEmpty).join(', '),
      onTap: () => context.push(Routes.store(store.id)),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(radius),
          color: dark ? AppColors.darkSurface : AppColors.grouped,
          // Light: one long, soft shadow. Dark: a thin light edge instead.
          boxShadow: dark
              ? null
              : const [
                  BoxShadow(
                    color: Color(0x1F000000),
                    blurRadius: 24,
                    spreadRadius: -6,
                    offset: Offset(0, 12),
                  ),
                ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(radius),
          child: Stack(
            fit: StackFit.expand,
            children: [
              Hero(
                tag: storeCoverHeroTag(store.id),
                child: _Cover(store: store),
              ),
              // Scrim for the text only: clear on the top 40 %.
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Color(0x00000000),
                      Color(0x00000000),
                      Color(0xB3000000),
                    ],
                    stops: [0, 0.4, 1],
                  ),
                ),
              ),
              PositionedDirectional(
                top: AppSpacing.md,
                start: AppSpacing.md,
                child: _GlassPill(
                  dotColor: store.isOpen ? AppColors.success : null,
                  label: status,
                ),
              ),
              PositionedDirectional(
                start: AppSpacing.lg,
                end: AppSpacing.lg,
                bottom: AppSpacing.lg,
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        color: AppColors.white,
                        shape: BoxShape.circle,
                      ),
                      child: StoreLogo(
                        url: store.logo,
                        media: store.logoMedia,
                        size: size == StoreTileSize.list ? 44 : 38,
                        bordered: false,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            store.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.h3.copyWith(
                              color: AppColors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: size == StoreTileSize.list ? 19 : 17,
                              height: 1.2,
                            ),
                          ),
                          if (subtitle.isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.xxs),
                            Text(
                              subtitle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppTextStyles.caption.copyWith(
                                color: AppColors.white.withValues(alpha: 0.78),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    return switch (size) {
      StoreTileSize.row => SizedBox(
        width: rowWidth,
        height: rowHeight,
        child: card,
      ),
      StoreTileSize.list => AspectRatio(aspectRatio: 16 / 10, child: card),
    };
  }

  /// "Open" / "Opens at 18:00" / "Opens Friday 09:00" / "Closed".
  String _statusText(BuildContext context) {
    if (store.isOpen) return context.tr('jb.store.open');
    final next = nextOpening(store, now ?? DateTime.now());
    return switch (next) {
      null => context.tr('jb.store.closed'),
      NextOpening(daysFromNow: 0, :final time) => context.tr(
        'jb.store.opens_at',
        args: {'time': time},
      ),
      NextOpening(:final day, :final time) => context.tr(
        'jb.store.opens_on',
        args: {'day': context.tr('jb.store.day_$day'), 'time': time},
      ),
    };
  }
}

class _Cover extends StatelessWidget {
  const _Cover({required this.store});

  final Store store;

  @override
  Widget build(BuildContext context) {
    final hasCover = store.cover.isNotEmpty || store.coverMedia != null;
    final hasLogo = store.logo.isNotEmpty || store.logoMedia != null;
    // No photo at all: a quiet ink fill so the white text always reads
    // (a light grey fallback under the dark scrim looks muddy).
    final Widget image;
    if (!hasCover && !hasLogo) {
      image = const ColoredBox(
        key: ValueKey('store-cover-fallback'),
        color: AppColors.inkSoft,
        child: Align(
          alignment: Alignment(0, -0.35),
          child: Icon(
            Icons.storefront_outlined,
            size: 36,
            color: Color(0x80FFFFFF),
          ),
        ),
      );
    } else {
      image = NetImage(
        url: hasCover ? store.cover : store.logo,
        media: hasCover ? store.coverMedia : store.logoMedia,
        size: ImageSize.medium,
        placeholderIcon: Icons.storefront_outlined,
        // Slightly desaturated (≈ 60 % saturation) for a closed store, by
        // the image's own colour filter: no `ColorFiltered` layer.
        desaturate: !store.isOpen,
      );
    }
    return image;
  }
}

/// Small translucent pill on the photo. No blur: cards are list items and
/// blur on every one would cost frames; a dark tint reads the same.
class _GlassPill extends StatelessWidget {
  const _GlassPill({required this.label, this.dotColor});

  final String label;
  final Color? dotColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 160),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm + 2,
        vertical: AppSpacing.xs + 1,
      ),
      decoration: BoxDecoration(
        color: const Color(0x73000000),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: const Color(0x33FFFFFF), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dotColor != null) ...[
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                color: dotColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: AppSpacing.xs + 1),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.caption.copyWith(
                color: AppColors.white,
                fontWeight: FontWeight.w700,
                height: 1.2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Loading placeholder with the card's exact size.
class StoreTileSkeleton extends StatelessWidget {
  const StoreTileSkeleton({super.key, this.size = StoreTileSize.row});

  final StoreTileSize size;

  @override
  Widget build(BuildContext context) {
    const skeleton = AppSkeleton(
      height: double.infinity,
      radius: StoreTile.radius,
    );
    return switch (size) {
      StoreTileSize.row => const SizedBox(
        width: StoreTile.rowWidth,
        height: StoreTile.rowHeight,
        child: skeleton,
      ),
      StoreTileSize.list => const AspectRatio(
        aspectRatio: 16 / 10,
        child: skeleton,
      ),
    };
  }
}

class StoreLogo extends StatelessWidget {
  const StoreLogo({
    super.key,
    required this.url,
    this.media,
    this.size = 40,
    this.bordered = true,
  });

  final String url;
  final MediaRef? media;
  final double size;
  final bool bordered;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: context.fieldFill,
        border: bordered ? Border.all(color: context.fieldBorder) : null,
      ),
      clipBehavior: Clip.antiAlias,
      child: NetImage(
        url: url,
        media: media,
        placeholderIcon: Icons.storefront_outlined,
      ),
    );
  }
}

/// Green "Open" / grey "Closed" status line.
class OpenBadge extends StatelessWidget {
  const OpenBadge({super.key, required this.isOpen});

  final bool isOpen;

  @override
  Widget build(BuildContext context) {
    final color = isOpen ? AppColors.success : context.textFaint;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: AppSpacing.xs),
        Text(
          context.tr(isOpen ? 'jb.store.open' : 'jb.store.closed'),
          style: AppTextStyles.caption.copyWith(color: color),
        ),
      ],
    );
  }
}
