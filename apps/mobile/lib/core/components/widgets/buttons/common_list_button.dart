import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../shimmer/app_shimmer.dart';
import '../../../theme/app_theme.dart';

/// A professional list button component supporting:
/// - Multiple states: normal, logout (danger), loading, success, failure, disabled
/// - Icon/SVG leading/trailing support
/// - Nested submenu with child buttons
/// - Animated state transitions
/// - Badge support for notifications
/// - Customizable colors and styling
///
/// Perfect for: Settings screens, Drawers, Option menus, Action lists
class CommonListButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;

  /// External control of the button state
  final ListButtonState state;

  /// Whether the button is enabled in the normal state
  final bool enabled;

  /// Determines the button's visual style and semantics
  final ListButtonType type;

  /// Height of the button
  final double height;

  /// Leading icon (takes precedence over leadingSvg)
  final IconData? leadingIcon;

  /// Leading SVG asset path
  final String? leadingSvg;

  /// Trailing icon (usually an arrow or action icon)
  final IconData? trailingIcon;

  /// Trailing SVG asset path
  final String? trailingSvg;

  /// Size of icons
  final double iconSize;

  /// Text style for the label
  final TextStyle? textStyle;

  /// Color for normal state
  final Color normalColor;

  /// Color for logout/danger state (red theme)
  final Color logoutColor;

  /// Text color
  final Color textColor;

  /// Disabled state color
  final Color disabledColor;

  /// Icon color
  final Color iconColor;

  /// Border radius
  final BorderRadius borderRadius;

  /// Padding
  final EdgeInsets padding;

  /// Animation duration
  final Duration animationDuration;

  /// Show a badge with a number (e.g. for notifications)
  final int? badgeCount;

  /// Badge color
  final Color badgeColor;

  /// Subtitle text (shown below the label)
  final String? subtitle;

  /// Subtitle text style
  final TextStyle? subtitleStyle;

  final List<CommonListButton>? childButtons;

  final bool expandedInitially;

  final Function(bool isExpanded)? onExpandChanged;

  final IconData expandedIcon;

  final IconData collapsedIcon;

  final bool showDivider;

  final Color dividerColor;

  final bool animateTrailingIcon;

  final double elementSpacing;

  const CommonListButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.state = ListButtonState.normal,
    this.enabled = true,
    this.type = ListButtonType.normal,
    this.height = 56.0,
    this.leadingIcon,
    this.leadingSvg,
    this.trailingIcon,
    this.trailingSvg,
    this.iconSize = 24.0,
    this.textStyle,
    this.normalColor = AppColors.surface,
    this.logoutColor = AppColors.errorTint,
    this.textColor = Colors.black87,
    this.disabledColor = AppColors.surface,
    this.iconColor = AppColors.textSecondary,
    this.borderRadius = const BorderRadius.all(Radius.circular(18)),
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    this.animationDuration = const Duration(milliseconds: 300),
    this.badgeCount,
    this.badgeColor = AppColors.error,
    this.subtitle,
    this.subtitleStyle,
    this.childButtons,
    this.expandedInitially = false,
    this.onExpandChanged,
    this.expandedIcon = Icons.arrow_drop_up,
    this.collapsedIcon = Icons.arrow_drop_down,
    this.showDivider = false,
    this.dividerColor = AppColors.divider,
    this.animateTrailingIcon = true,
    this.elementSpacing = 12.0,
  });

  const CommonListButton.logout({
    Key? key,
    required VoidCallback? onPressed,
    String label = 'Log Out',
  }) : this(
         key: key,
         label: label,
         onPressed: onPressed,
         type: ListButtonType.logout,
         leadingIcon: Icons.logout,
         logoutColor: AppColors.errorTint,
         textStyle: const TextStyle(
           color: AppColors.error,
           fontSize: 16,
           fontWeight: FontWeight.w600,
         ),
       );

  const CommonListButton.settings({
    Key? key,
    required VoidCallback? onPressed,
    String label = 'Settings',
  }) : this(
         key: key,
         label: label,
         onPressed: onPressed,
         leadingIcon: Icons.settings,
         trailingIcon: Icons.arrow_forward_ios,
       );

  @override
  State<CommonListButton> createState() => _CommonListButtonState();
}

class _CommonListButtonState extends State<CommonListButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnimation;
  late Animation<double> _expandAnimation;

  bool _isExpanded = false;

  @override
  void initState() {
    super.initState();

    _isExpanded = widget.expandedInitially;

    _animController = AnimationController(
      vsync: this,
      duration: widget.animationDuration,
    );

    _scaleAnimation = Tween<double>(begin: 1.0, end: 1.02).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeInOut),
    );

    _expandAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeInOut),
    );

    if (_isExpanded) {
      _animController.forward();
    }
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  void _handleTap() {
    final hasSubmenu =
        widget.childButtons != null && widget.childButtons!.isNotEmpty;

    if (hasSubmenu) {
      // Toggle expansion
      setState(() => _isExpanded = !_isExpanded);

      if (_isExpanded) {
        _animController.forward();
      } else {
        _animController.reverse();
      }

      widget.onExpandChanged?.call(_isExpanded);
    } else {
      // Normal tap
      if (widget.enabled && widget.onPressed != null) {
        widget.onPressed!();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasSubmenu =
        widget.childButtons != null && widget.childButtons!.isNotEmpty;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Main button
        _buildMainButton(hasSubmenu),

        // Submenu (if exists and expanded)
        if (hasSubmenu && _isExpanded) ...[
          SizeTransition(
            sizeFactor: _expandAnimation,
            axisAlignment: -1,
            child: FadeTransition(
              opacity: _expandAnimation,
              child: Padding(
                padding: EdgeInsets.only(left: widget.elementSpacing),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [...widget.childButtons!.map((btn) => btn)],
                ),
              ),
            ),
          ),
        ],

        // Divider
        if (widget.showDivider)
          Padding(
            padding: EdgeInsets.symmetric(horizontal: widget.padding.left),
            child: Divider(color: widget.dividerColor, height: 1),
          ),
      ],
    );
  }

  Widget _buildMainButton(bool hasSubmenu) {
    // Determine button appearance based on state and type
    final buttonColor = _getButtonColor();
    final contentColor = _getContentColor();
    final effectiveIconColor = _getIconColor();

    return ScaleTransition(
      scale: _scaleAnimation,
      child: AnimatedContainer(
        duration: widget.animationDuration,
        height: widget.height,
        margin: widget.padding,
        decoration: BoxDecoration(
          color: buttonColor,
          borderRadius: widget.borderRadius,
          border: Border.all(
            color: widget.type == ListButtonType.logout
                ? widget.logoutColor
                : Colors.transparent,
            width: 1,
          ),
          boxShadow: widget.state == ListButtonState.loading
              ? [
                  BoxShadow(
                    color: AppColors.info.withValues(alpha: 0.1),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ]
              : [],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: widget.borderRadius,
            onTap: widget.enabled ? _handleTap : null,
            child: Padding(
              padding: EdgeInsetsDirectional.symmetric(horizontal: 6.0),
              child: Row(
                children: [
                  // Leading icon/badge
                  if (widget.leadingIcon != null || widget.leadingSvg != null)
                    Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: widget.elementSpacing,
                        end: widget.elementSpacing,
                      ),
                      child: _buildLeadingIcon(effectiveIconColor),
                    ),

                  // Text content (label + subtitle)
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          widget.label,
                          style:
                              (widget.textStyle ??
                                      _defaultTextStyle(widget.type))
                                  .copyWith(color: contentColor),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (widget.subtitle != null)
                          Padding(
                            padding: const EdgeInsetsDirectional.only(top: 2.0),
                            child: Text(
                              widget.subtitle!,
                              style:
                                  (widget.subtitleStyle ??
                                          _defaultSubtitleStyle())
                                      .copyWith(color: Colors.grey.shade600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                    ),
                  ),

                  // Badge (if any)
                  if (widget.badgeCount != null && widget.badgeCount! > 0)
                    Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: widget.elementSpacing,
                        end: widget.elementSpacing,
                      ),
                      child: _buildBadge(),
                    ),

                  // Trailing icon or loading indicator
                  if (widget.state == ListButtonState.loading)
                    Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: widget.elementSpacing,
                        end: widget.elementSpacing,
                      ),
                      child: SizedBox(
                        width: widget.iconSize,
                        height: widget.iconSize,
                        child: ShimmerWrapper(
                          child: ShimmerBlock(
                            width: widget.iconSize,
                            height: widget.iconSize,
                            shape: BoxShape.circle,
                            color: contentColor.withValues(alpha: 0.5),
                          ),
                        ),
                      ),
                    )
                  else if (widget.state == ListButtonState.success)
                    Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: widget.elementSpacing,
                        end: widget.elementSpacing,
                      ),
                      child: Icon(
                        Icons.check_circle,
                        color: AppColors.success,
                        size: widget.iconSize,
                      ),
                    )
                  else if (widget.state == ListButtonState.failure)
                    Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: widget.elementSpacing,
                        end: widget.elementSpacing,
                      ),
                      child: Icon(
                        Icons.error_outline,
                        color: AppColors.error,
                        size: widget.iconSize,
                      ),
                    )
                  else if (hasSubmenu && widget.animateTrailingIcon)
                    Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: widget.elementSpacing,
                        end: widget.elementSpacing,
                      ),
                      child: RotationTransition(
                        turns: _expandAnimation,
                        child: Icon(
                          _isExpanded
                              ? widget.expandedIcon
                              : widget.collapsedIcon,
                          color: effectiveIconColor,
                          size: widget.iconSize,
                        ),
                      ),
                    )
                  else if (widget.trailingIcon != null ||
                      widget.trailingSvg != null)
                    Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: widget.elementSpacing,
                        end: widget.elementSpacing,
                      ),
                      child: _buildTrailingIcon(effectiveIconColor),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLeadingIcon(Color color) {
    if (widget.leadingSvg != null) {
      return SvgPicture.asset(
        widget.leadingSvg!,
        width: widget.iconSize,
        height: widget.iconSize,
        colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
      );
    }

    return Icon(widget.leadingIcon!, size: widget.iconSize, color: color);
  }

  Widget _buildTrailingIcon(Color color) {
    if (widget.trailingSvg != null) {
      return SvgPicture.asset(
        widget.trailingSvg!,
        width: widget.iconSize,
        height: widget.iconSize,
        colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
      );
    }

    return Icon(widget.trailingIcon!, size: widget.iconSize, color: color);
  }

  Widget _buildBadge() {
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: 8,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: widget.badgeColor,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Text(
        widget.badgeCount.toString(),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Color _getButtonColor() {
    if (!widget.enabled) {
      return widget.disabledColor;
    }

    switch (widget.state) {
      case ListButtonState.normal:
      case ListButtonState.loading:
        return widget.type == ListButtonType.logout
            ? widget.logoutColor
            : widget.normalColor;
      case ListButtonState.success:
        return AppColors.successTint;
      case ListButtonState.failure:
        return AppColors.errorTint;
      case ListButtonState.disabled:
        return widget.disabledColor;
    }
  }

  Color _getContentColor() {
    if (!widget.enabled) {
      return Colors.grey.shade400;
    }

    switch (widget.state) {
      case ListButtonState.normal:
      case ListButtonState.loading:
        return widget.type == ListButtonType.logout
            ? AppColors.error
            : widget.textColor;
      case ListButtonState.success:
        return AppColors.success;
      case ListButtonState.failure:
        return AppColors.error;
      case ListButtonState.disabled:
        return Colors.grey.shade400;
    }
  }

  Color _getIconColor() {
    if (!widget.enabled) {
      return Colors.grey.shade400;
    }

    if (widget.type == ListButtonType.logout) {
      return AppColors.error;
    }

    return widget.iconColor;
  }

  TextStyle _defaultTextStyle(ListButtonType type) {
    return TextStyle(
      fontSize: 16,
      fontWeight: FontWeight.w500,
      color: type == ListButtonType.logout
          ? AppColors.error
          : widget.textColor,
    );
  }

  TextStyle _defaultSubtitleStyle() {
    return const TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w400,
      color: Colors.grey,
    );
  }
}

/// Button state for list buttons
enum ListButtonState { normal, loading, success, failure, disabled }

/// Button type/semantic meaning
enum ListButtonType {
  normal,
  logout, // danger/logout style
}
