import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart' show SizeExtension;
import 'package:google_nav_bar/google_nav_bar.dart';

import '../../../../core/design/app_spacing.dart';
import '../../../../core/design/responsive.dart';
import '../../../../core/theme/app_theme.dart';

/// One entry of the bottom bar.
class NavItem {
  const NavItem({required this.icon, required this.label});
  final IconData icon;
  final String label;
}

/// Floating bottom bar: a pill with a soft shadow, the active tab in the
/// action colour with an accent icon. The items are the role's visible tabs
/// (`RoleScreens`); indexes are positions in [items].
class CustomBottomNavigation extends StatelessWidget {
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
    final Color inactiveIcon = isDarkMode
        ? AppColors.darkTextSecondary
        : AppColors.textTertiary;

    // Keeps the bar a comfortable width on tablets instead of stretching.
    final double maxBarWidth = Responsive.isTablet(context) ? 520 : 600;

    GButton tab(IconData icon, String text) => GButton(
      icon: icon,
      text: text,
      iconColor: inactiveIcon,
      iconActiveColor: isDarkMode ? AppColors.onPrimary : AppColors.accent,
      textColor: activeContent,
      semanticLabel: text,
    );

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
                child: GNav(
                  rippleColor: AppColors.grouped,
                  hoverColor: AppColors.surface,
                  gap: 6,
                  activeColor: activeContent,
                  iconSize: 22,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 12,
                  ),
                  duration: const Duration(milliseconds: 300),
                  tabBackgroundColor: activePill,
                  color: inactiveIcon,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  tabs: [for (final item in items) tab(item.icon, item.label)],
                  selectedIndex: currentIndex,
                  onTabChange: onItemTapped,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
