import 'package:flutter/material.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/models/media_ref.dart';
import '../../data/models/store.dart';

/// Pins [StoreCategoryBar] under the store's navigation bar.
class StoreCategoryBarDelegate extends SliverPersistentHeaderDelegate {
  StoreCategoryBarDelegate({
    required this.categories,
    required this.total,
    required this.selectedId,
    required this.onSelect,
    required this.textScale,
  });

  final List<StoreMenuCategory> categories;
  final int total;
  final String? selectedId;
  final ValueChanged<String?> onSelect;

  /// Grows the bar with Dynamic Type (the tile names are one line).
  final double textScale;

  static const double baseHeight = 112;

  @override
  double get maxExtent => baseHeight + 16 * (textScale - 1).clamp(0, 0.5);

  @override
  double get minExtent => maxExtent;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlaps) =>
      StoreCategoryBar(
        categories: categories,
        total: total,
        selectedId: selectedId,
        onSelect: onSelect,
        pinned: overlaps,
      );

  @override
  bool shouldRebuild(StoreCategoryBarDelegate old) =>
      old.categories != categories ||
      old.total != total ||
      old.selectedId != selectedId ||
      old.textScale != textScale;
}

/// Horizontally scrolling menu sections as visual tiles: "All" (grid icon),
/// then each category with its image, else its emoji icon, else a
/// monogram; the product count sits in a small badge. The selected tile
/// gets a yellow ring, grows a little, and a short bar slides under it.
/// RTL follows the reading direction; the selected tile scrolls into view.
class StoreCategoryBar extends StatefulWidget {
  const StoreCategoryBar({
    super.key,
    required this.categories,
    required this.total,
    required this.selectedId,
    required this.onSelect,
    this.pinned = false,
  });

  final List<StoreMenuCategory> categories;
  final int total;

  /// `null` = "All".
  final String? selectedId;
  final ValueChanged<String?> onSelect;

  /// Content scrolls under the bar: show its hairline.
  final bool pinned;

  /// Width of one tile and the gap between tiles: fixed, so the sliding
  /// indicator and the scroll-into-view need no measuring.
  static const double tileWidth = 76;
  static const double gap = AppSpacing.xs;
  static const double imageSize = 60;

  @override
  State<StoreCategoryBar> createState() => _StoreCategoryBarState();
}

class _StoreCategoryBarState extends State<StoreCategoryBar> {
  /// Own controller: revealing the selected tile must scroll this list
  /// only, never the page around it.
  final _scroll = ScrollController();

  static const _padding = AppSpacing.screenH - AppSpacing.xs;

  int get _selectedIndex {
    if (widget.selectedId == null) return 0;
    final i = widget.categories.indexWhere((c) => c.id == widget.selectedId);
    return i < 0 ? 0 : i + 1;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(jump: true));
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(StoreCategoryBar old) {
    super.didUpdateWidget(old);
    if (old.selectedId != widget.selectedId) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _reveal());
    }
  }

  /// Centres the selected tile (offsets run along the reading direction,
  /// so the same maths works in RTL).
  void _reveal({bool jump = false}) {
    if (!mounted || !_scroll.hasClients) return;
    final position = _scroll.position;
    const stride = StoreCategoryBar.tileWidth + StoreCategoryBar.gap;
    final target =
        (_padding +
                _selectedIndex * stride +
                StoreCategoryBar.tileWidth / 2 -
                position.viewportDimension / 2)
            .clamp(0.0, position.maxScrollExtent);
    if (jump || MediaQuery.disableAnimationsOf(context)) {
      _scroll.jumpTo(target);
    } else {
      _scroll.animateTo(
        target,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    const stride = StoreCategoryBar.tileWidth + StoreCategoryBar.gap;
    final count = widget.categories.length + 1;
    return Semantics(
      container: true,
      label: context.tr('jb.store.menu'),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: context.pageBackground,
          border: Border(
            bottom: BorderSide(
              color: widget.pinned ? context.fieldBorder : Colors.transparent,
              width: 0.5,
            ),
          ),
        ),
        child: SingleChildScrollView(
          controller: _scroll,
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: _padding),
          child: SizedBox(
            width: count * stride - StoreCategoryBar.gap,
            child: Stack(
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < count; i++) ...[
                      if (i > 0) const SizedBox(width: StoreCategoryBar.gap),
                      _tile(context, i),
                    ],
                  ],
                ),
                // Sliding indicator under the selected tile.
                AnimatedPositionedDirectional(
                  duration: reduce
                      ? Duration.zero
                      : const Duration(milliseconds: 280),
                  curve: Curves.easeOutCubic,
                  start:
                      _selectedIndex * stride +
                      (StoreCategoryBar.tileWidth - 24) / 2,
                  bottom: 4,
                  width: 24,
                  height: 3,
                  child: const DecoratedBox(
                    decoration: BoxDecoration(
                      color: AppColors.yellowDeep,
                      borderRadius: AppRadius.pillAll,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _tile(BuildContext context, int i) {
    if (i == 0) {
      return CategoryTile(
        key: const ValueKey('category-tile-all'),
        name: context.tr('jb.store.all'),
        count: widget.total,
        selected: widget.selectedId == null,
        onTap: () => widget.onSelect(null),
        allTile: true,
      );
    }
    final c = widget.categories[i - 1];
    return CategoryTile(
      key: ValueKey('category-tile-${c.id}'),
      name: c.name,
      count: c.productCount,
      image: c.image,
      imageMedia: c.imageMedia,
      icon: c.icon,
      selected: c.id == widget.selectedId,
      onTap: () => widget.onSelect(c.id),
    );
  }
}

/// What a [CategoryTile] shows in its square, in order of preference.
enum CategoryTileVisual { all, image, icon, monogram }

/// One menu section: a rounded square (image, emoji icon or monogram) with
/// the count badge, and the name underneath.
class CategoryTile extends StatelessWidget {
  const CategoryTile({
    super.key,
    required this.name,
    required this.count,
    required this.selected,
    required this.onTap,
    this.image = '',
    this.imageMedia,
    this.icon = '',
    this.allTile = false,
  });

  final String name;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  final String image;
  final MediaRef? imageMedia;
  final String icon;
  final bool allTile;

  CategoryTileVisual get visual {
    if (allTile) return CategoryTileVisual.all;
    if (image.isNotEmpty || imageMedia != null) return CategoryTileVisual.image;
    if (icon.trim().isNotEmpty) return CategoryTileVisual.icon;
    return CategoryTileVisual.monogram;
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    const size = StoreCategoryBar.imageSize;
    const radius = BorderRadius.all(Radius.circular(18));
    return Semantics(
      button: true,
      selected: selected,
      label: context.tr(
        'jb.store.section_label',
        args: {'name': name, 'count': count},
      ),
      container: true,
      excludeSemantics: true,
      onTap: onTap,
      child: SizedBox(
        width: StoreCategoryBar.tileWidth,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.mdAll,
          child: Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm + 2),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedScale(
                  scale: selected && !reduce ? 1.05 : 1,
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOutBack,
                  child: SizedBox(
                    width: size + 8,
                    height: size + 8,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        // Ring: 2.5 pt of yellow around a 1.5 pt gap.
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            borderRadius: const BorderRadius.all(
                              Radius.circular(22),
                            ),
                            border: Border.all(
                              color: selected
                                  ? AppColors.yellowDeep
                                  : Colors.transparent,
                              width: 2.5,
                            ),
                          ),
                          child: ClipRRect(
                            borderRadius: radius,
                            child: SizedBox.expand(child: _visual(context)),
                          ),
                        ),
                        if (count > 0)
                          PositionedDirectional(
                            top: -2,
                            end: -4,
                            child: _CountBadge(
                              count: count,
                              selected: selected,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xs + 2),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: AppTextStyles.caption.copyWith(
                      color: selected ? context.textMain : context.textMuted,
                      fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _visual(BuildContext context) {
    final fill = context.fieldFill;
    switch (visual) {
      case CategoryTileVisual.all:
        return ColoredBox(
          key: const ValueKey('tile-all'),
          color: selected ? AppColors.yellow : fill,
          child: Icon(
            Icons.grid_view_rounded,
            size: 26,
            color: selected ? AppColors.ink : context.textMain,
          ),
        );
      case CategoryTileVisual.image:
        return KeyedSubtree(
          key: const ValueKey('tile-image'),
          child: NetImage(
            url: image,
            media: imageMedia,
            emoji: icon.trim().isEmpty ? null : icon,
            placeholderIcon: Icons.restaurant_menu_rounded,
          ),
        );
      case CategoryTileVisual.icon:
        return ColoredBox(
          key: const ValueKey('tile-icon'),
          color: fill,
          child: Center(
            child: Text(
              icon.trim(),
              style: const TextStyle(fontSize: 28),
              textScaler: TextScaler.noScaling,
            ),
          ),
        );
      case CategoryTileVisual.monogram:
        final tint = monogramTint(name);
        return ColoredBox(
          key: const ValueKey('tile-monogram'),
          color: tint.withValues(alpha: context.isDarkMode ? 0.28 : 0.16),
          child: Center(
            child: Text(
              monogram(name),
              textScaler: TextScaler.noScaling,
              style: AppTextStyles.h2.copyWith(
                color: context.isDarkMode ? AppColors.white : tint,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        );
    }
  }
}

/// First letter of [name] (first character for scripts without case).
String monogram(String name) {
  final trimmed = name.trim();
  if (trimmed.isEmpty) return '•';
  return String.fromCharCode(trimmed.runes.first).toUpperCase();
}

/// A calm tint picked from the name, so each monogram keeps its colour.
Color monogramTint(String name) {
  const tints = [
    Color(0xFFB7791F), // amber
    Color(0xFF2F855A), // green
    Color(0xFF2B6CB0), // blue
    Color(0xFF9B2C2C), // red
    Color(0xFF6B46C1), // violet
    Color(0xFF285E61), // teal
  ];
  final hash = name.runes.fold<int>(0, (h, r) => (h * 31 + r) & 0x7fffffff);
  return tints[hash % tints.length];
}

class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.count, required this.selected});

  final int count;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 20),
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: selected ? AppColors.ink : context.textMain,
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: context.pageBackground, width: 2),
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        textScaler: TextScaler.noScaling,
        style: AppTextStyles.caption.copyWith(
          color: selected ? AppColors.white : context.pageBackground,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          height: 1,
        ),
      ),
    );
  }
}
