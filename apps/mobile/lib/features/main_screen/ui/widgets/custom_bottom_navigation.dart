import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart' show SizeExtension;

import '../../../../core/design/app_spacing.dart';
import '../../../../core/design/responsive.dart';
import '../../../../core/theme/app_theme.dart';

/// One entry of the bottom bar.
class NavItem {
  const NavItem({required this.icon, required this.label, this.badge = 0});
  final IconData icon;
  final String label;

  /// A count on the icon (e.g. deliveries left); 0 shows none.
  final int badge;
}

/// Floating bottom bar: a pill with a soft shadow, a word under every icon
/// (an icon alone is not obvious to everyone), the active tab in the action
/// colour with an accent icon. The items are the role's visible tabs
/// (`RoleScreens`); indexes are positions in [items].
class CustomBottomNavigation extends StatelessWidget {
  /// Height of one tab (a touch target well over 48 dp).
  static const double tabHeight = 56;

  /// Height of the bar above the safe area: the pill (tab + its 8 dp padding
  /// on both sides) plus the gap under it. Floating buttons sit [clearance]
  /// above the bottom safe area to clear it.
  static const double height = tabHeight + 2 * AppSpacing.sm + AppSpacing.sm;

  /// [height] plus the usual 16 dp margin of a floating button.
  static const double clearance = height + 16;

  /// What the assistant button covers above the bar: its 56 dp, the 16 dp
  /// margin under it and a 16 dp gap over it.
  static const double _buttonZone = 56 + 16 + 16;

  /// The end padding of the scrolling content of every tab root: one value,
  /// so the last row always clears the bar (with the home-indicator inset)
  /// and the floating buttons.
  static double listEnd(BuildContext context) =>
      MediaQuery.paddingOf(context).bottom + height + _buttonZone;

  final List<NavItem> items;
  final int currentIndex;
  final ValueChanged<int> onItemTapped;

  const CustomBottomNavigation({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onItemTapped,
  });

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    final Color barColor = isDarkMode ? AppColors.darkSurface : AppColors.white;
    final Color activePill = isDarkMode
        ? AppColors.accent
        : AppColors.secondaryColor;
    final Color activeContent = isDarkMode
        ? AppColors.onPrimary
        : AppColors.onSecondary;
    // Readable on the bar (at least 4.5:1): these are words, not decoration.
    final Color inactive = isDarkMode
        ? AppColors.darkTextSecondary
        : AppColors.textSecondary;
    final Color activeIcon = isDarkMode
        ? AppColors.onPrimary
        : AppColors.accent;

    // Keeps the bar a comfortable width on tablets instead of stretching.
    final double maxBarWidth = Responsive.isTablet(context) ? 520 : 600;

    // Bottom inset only: the bar sits at the screen bottom, and a top inset
    // would add an invisible status-bar-high gap above it.
    return SafeArea(
      top: false,
      child: Align(
        alignment: Alignment.bottomCenter,
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxBarWidth),
          child: Padding(
            padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, AppSpacing.sm),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: barColor,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                border: Border.all(
                  color: isDarkMode ? AppColors.darkDivider : AppColors.divider,
                ),
                boxShadow: AppShadows.floating,
              ),
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.sm),
                // A big system text size must not grow the bar over the
                // content: the words scale up to 1.2x.
                child: MediaQuery.withClampedTextScaling(
                  maxScaleFactor: 1.2,
                  child: Row(
                    children: [
                      for (var i = 0; i < items.length; i++)
                        Expanded(
                          child: _Tab(
                            key: Key('nav-tab-$i'),
                            item: items[i],
                            active: i == currentIndex,
                            pill: activePill,
                            activeContent: activeContent,
                            activeIcon: activeIcon,
                            inactive: inactive,
                            onTap: () => onItemTapped(i),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One tab: the icon (with its count) and its word under it. The whole cell
/// takes the tap.
class _Tab extends StatelessWidget {
  const _Tab({
    super.key,
    required this.item,
    required this.active,
    required this.pill,
    required this.activeContent,
    required this.activeIcon,
    required this.inactive,
    required this.onTap,
  });

  final NavItem item;
  final bool active;
  final Color pill;
  final Color activeContent;
  final Color activeIcon;
  final Color inactive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final iconColor = active ? activeIcon : inactive;
    final icon = Icon(item.icon, size: 22, color: iconColor);
    return Semantics(
      button: true,
      selected: active,
      excludeSemantics: true,
      label: item.badge <= 0 ? item.label : '${item.label} (${item.badge})',
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: Material(
          color: active ? pill : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: CustomBottomNavigation.tabHeight,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    item.badge <= 0
                        ? icon
                        : Badge(
                            label: Text(
                              item.badge > 99 ? '99+' : '${item.badge}',
                              textDirection: TextDirection.ltr,
                            ),
                            child: icon,
                          ),
                    const SizedBox(height: 2),
                    // Long words (fr, five tabs at 360 px) shrink a little
                    // instead of being cut.
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        item.label,
                        maxLines: 1,
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.2,
                          fontWeight: active
                              ? FontWeight.w700
                              : FontWeight.w600,
                          color: active ? activeContent : inactive,
                        ),
                      ),
                    ),
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
