import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart' show SizeExtension;
import 'package:google_nav_bar/google_nav_bar.dart';
import 'package:line_icons/line_icons.dart';

import '../../../../core/design/app_spacing.dart';
import '../../../../core/design/responsive.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/theme/app_theme.dart';

/// Floating bottom bar in the Jibli style: a white pill with a soft shadow,
/// and an ink-black pill with a yellow icon for the active tab.
///
/// Tabs: Home · Fruits & Vegetables · Supermarket · Account (same order as
/// the shell branches in `app_router.dart`).
class CustomBottomNavigation extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onItemTapped;

  const CustomBottomNavigation({
    super.key,
    required this.currentIndex,
    required this.onItemTapped,
  });

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    final Color barColor = isDarkMode ? AppColors.darkSurface : AppColors.white;
    final Color activePill = isDarkMode ? AppColors.yellow : AppColors.ink;
    final Color activeContent = isDarkMode ? AppColors.ink : Colors.white;
    final Color inactiveIcon = isDarkMode
        ? AppColors.darkTextSecondary
        : AppColors.textTertiary;

    // Keeps the bar a comfortable width on tablets instead of stretching.
    final double maxBarWidth = Responsive.isTablet(context) ? 520 : 600;

    GButton tab(IconData icon, String text) => GButton(
      icon: icon,
      text: text,
      iconColor: inactiveIcon,
      iconActiveColor: isDarkMode ? AppColors.ink : AppColors.yellow,
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
                  tabs: [
                    tab(LineIcons.home, context.tr('jb.tabs.home')),
                    tab(LineIcons.carrot, context.tr('jb.tabs.produce_short')),
                    tab(
                      LineIcons.shoppingBasket,
                      context.tr('jb.tabs.supermarket_short'),
                    ),
                    tab(LineIcons.user, context.tr('account')),
                  ],
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
