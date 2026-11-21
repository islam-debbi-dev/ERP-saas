import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../shimmer/app_shimmer.dart';
import '../../../design/app_spacing.dart';
import '../../../theme/app_theme.dart';

/// An animated, stateful button supporting multiple states:
/// - visible: the normal button with label + optional leading/trailing icons
/// - loading: shrinks to a circle and shows a progress indicator
/// - success: shows a success icon (and optional text) with success color
/// - failure: shows a failure icon (and optional text) with failure color
/// - invisible: hidden (either fades out or removed depending on `removeWhenInvisible`)
///
/// All visuals and durations are configurable through parameters.
class CommonButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;

  /// External control of the button state.
  final ButtonState state;

  /// Whether the button is enabled in the normal/visible state.
  final bool enabled;

  /// Dimensions
  final double height;
  final double minWidth;

  /// Colors
  final Color? visibleColor;
  final Color disabledColor;
  final Color loadingColor;
  final Color successColor;
  final Color failureColor;

  /// Iconography
  final IconData? leadingIcon;
  final IconData? trailingIcon;
  final IconData successIcon;
  final IconData failureIcon;

  /// Render the button as an icon-only button (no text). When true, the
  /// button will prefer `socialIcon` or `socialSvg` (if provided) and fall
  /// back to `leadingIcon`.
  final bool iconOnly;

  /// Size for the icon when `iconOnly` is true. Falls back to `height * 0.5`.
  final double? iconSize;

  /// If provided, renders a social-style button for the given platform
  final SocialType? socialType;

  /// Optional override for social icon (IconData) or SVG asset path (socialSvg).
  final IconData? socialIcon;
  final String? socialSvg;

  /// If true, render social button as an outlined button (common for Google)
  final bool socialOutlined;

  /// Text style
  final TextStyle? textStyle;

  /// Shape
  final BorderRadius borderRadius;

  /// Animation
  final Duration animationDuration;
  final Curve animationCurve;

  /// If true the widget will be removed from layout when state==invisible.
  final bool removeWhenInvisible;

  /// Whether the button should automatically expand back to full width after success/failure
  /// (if false, it stays showing success/failure until external state changes).
  final bool autoResetAfterStateChange;

  /// How long to show success/failure before resetting to visible (if autoResetAfterStateChange)
  final Duration stateShowDuration;

  const CommonButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.state = ButtonState.visible,
    this.enabled = true,
    this.height = 52.0,
    this.minWidth = 160.0,
    this.visibleColor,
    this.disabledColor = AppColors.border,
    this.loadingColor = Colors.white,
    this.successColor = AppColors.success,
    this.failureColor = AppColors.error,
    this.leadingIcon,
    this.trailingIcon,
    this.successIcon = Icons.check,
    this.failureIcon = Icons.close_rounded,
    this.textStyle,
    this.borderRadius = AppRadius.mdAll,
    this.animationDuration = const Duration(milliseconds: 350),
    this.animationCurve = Curves.easeInOut,
    this.removeWhenInvisible = false,
    this.autoResetAfterStateChange = true,
    this.stateShowDuration = const Duration(milliseconds: 1400),
    this.socialType,
    this.socialIcon,
    this.socialSvg,
    this.socialOutlined = false,
    this.iconOnly = false,
    this.iconSize,
  });

  /// Convenience preset for a confirm/OK button.
  ///
  /// Example: `CommonButton.confirm(onPressed: () { ... })`
  CommonButton.confirm({
    Key? key,
    required VoidCallback? onPressed,
    String label = 'OK',
  }) : this(
         key: key,
         label: label,
         onPressed: onPressed,
         visibleColor: AppColors.secondaryColor,
         successColor: AppColors.secondaryColor,
         textStyle: const TextStyle(
           color: Colors.white,
           fontSize: 16,
           fontWeight: FontWeight.w600,
         ),
         height: 52.0,
         minWidth: 140.0,
         borderRadius: AppRadius.mdAll,
       );

  /// Convenience preset for a cancel/secondary button.
  ///
  /// Example: `CommonButton.cancel(onPressed: () { ... })`
  const CommonButton.cancel({
    Key? key,
    required VoidCallback? onPressed,
    String label = 'Cancel',
  }) : this(
         key: key,
         label: label,
         onPressed: onPressed,
         visibleColor: AppColors.grouped,
         disabledColor: AppColors.grouped,
         textStyle: const TextStyle(
           color: AppColors.ink,
           fontSize: 16,
           fontWeight: FontWeight.w600,
         ),
         height: 52.0,
         minWidth: 140.0,
         borderRadius: AppRadius.mdAll,
       );

  @override
  State<CommonButton> createState() => _CommonButtonState();
}

class _CommonButtonState extends State<CommonButton>
    with SingleTickerProviderStateMixin {
  ButtonState get state => widget.state;

  // internal state used to animate transitions for success/failure auto-reset
  ButtonState? _internalState;

  @override
  void initState() {
    super.initState();
    _internalState = widget.state;
  }

  @override
  void didUpdateWidget(covariant CommonButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      setState(() {
        _internalState = widget.state;
      });

      // if we moved to success/failure and autoReset is enabled, schedule reset
      if (widget.autoResetAfterStateChange &&
          (widget.state == ButtonState.success ||
              widget.state == ButtonState.failure)) {
        Future.delayed(widget.stateShowDuration, () {
          if (mounted && widget.autoResetAfterStateChange) {
            // Only revert if the external state hasn't changed meanwhile
            if (widget.state == ButtonState.success ||
                widget.state == ButtonState.failure) {
              setState(() {
                _internalState = ButtonState.visible;
              });
            }
          }
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ButtonState effectiveState = _internalState ?? widget.state;

    if (effectiveState == ButtonState.invisible && widget.removeWhenInvisible) {
      return const SizedBox.shrink();
    }

    // compute visual properties depending on state
    final bool isLoading = effectiveState == ButtonState.loading;
    final bool isSuccess = effectiveState == ButtonState.success;
    final bool isFailure = effectiveState == ButtonState.failure;
    final bool isVisible = effectiveState == ButtonState.visible;
    final bool isInvisibleButPresent =
        effectiveState == ButtonState.invisible && !widget.removeWhenInvisible;

    // Theme sensitivity
    final ThemeData theme = Theme.of(context);
    final bool isDark = theme.brightness == Brightness.dark;

    // Social brand color mapping (simple, high-level). These can be overridden
    // by providing explicit color parameters if needed in the future.
    Color? brandColor;
    if (widget.socialType != null) {
      switch (widget.socialType!) {
        case SocialType.google:
          brandColor = Colors
              .white; // Google commonly uses white background with colored G
          break;
        case SocialType.twitter:
          brandColor = const Color(0xFF1DA1F2);
          break;
        case SocialType.apple:
          brandColor = Colors.black;
          break;
        case SocialType.linkedin:
          brandColor = const Color(0xFF0A66C2);
          break;
      }
    }

    // Determine background/content colors. If socialType is provided, adapt
    // visuals for social branding and for dark/light mode. Supports an
    // "outlined" social style (common for Google sign-in buttons).
    Color backgroundColor;
    Color contentColor;
    BoxBorder? border;

    if (widget.socialType != null && brandColor != null) {
      if (widget.socialOutlined) {
        backgroundColor = isDark ? Colors.transparent : Colors.white;
        border = Border.all(color: brandColor);
        contentColor = brandColor;
      } else {
        backgroundColor = brandColor;
        // If brand is light (like Google's white), use dark text/icon; otherwise white
        contentColor = (brandColor.computeLuminance() > 0.6)
            ? Colors.black
            : Colors.white;
      }
    } else {
      // Non-social default behavior (respect state)
      backgroundColor = isSuccess
          ? widget.successColor
          : isFailure
          ? widget.failureColor
          : (widget.enabled && isVisible)
          ? (widget.visibleColor ?? AppColors.secondaryColor)
          : widget.disabledColor;
      contentColor = widget.textStyle?.color ?? Colors.white;
    }

    final bool isIconOnly = widget.iconOnly;

    // Check if button should take full width
    final bool isFullWidth = widget.minWidth == double.infinity;

    // For full-width buttons, don't shrink on state change. Keep full width.
    // For fixed-width buttons, shrink to circle for loading/icon-only
    final double targetWidth = isFullWidth
        ? double.infinity
        : (isLoading || isIconOnly)
        ? widget
              .height // circle for loading or icon-only
        : (isSuccess || isFailure)
        ? widget.minWidth
        : widget.minWidth;

    // if invisible but present, keep size but fade
    final double opacity = isInvisibleButPresent ? 0.0 : 1.0;

    // For icon-only buttons we remove horizontal padding so the icon sits
    // exactly in the center of the circular button.
    final double horizontalPadding = widget.iconOnly ? 0.0 : 14.0;
    final BorderRadius effectiveInkRadius = widget.iconOnly
        ? BorderRadius.circular(widget.height * 0.5)
        : widget.borderRadius;

    return AnimatedOpacity(
      duration: widget.animationDuration,
      opacity: opacity,
      curve: widget.animationCurve,
      child: SizedBox(
        height: widget.height,
        child: AnimatedContainer(
          duration: widget.animationDuration,
          curve: widget.animationCurve,
          width: targetWidth,
          constraints: BoxConstraints(
            minHeight: widget.height,
            maxHeight: widget.height,
            minWidth: 0,
            maxWidth: double.infinity,
          ),
          decoration: BoxDecoration(
            color: backgroundColor,
            borderRadius: widget.borderRadius,
            border: border,
            boxShadow: [
              if (!isInvisibleButPresent)
                BoxShadow(
                  color: backgroundColor.withValues(alpha: 0.15),
                  blurRadius: 8,
                  offset: const Offset(0, 4),
                ),
            ],
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: effectiveInkRadius,
              onTap: (widget.enabled && widget.onPressed != null && isVisible)
                  ? widget.onPressed
                  : null,
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
                child: Center(
                  child: AnimatedSwitcher(
                    duration: widget.animationDuration,
                    transitionBuilder: (child, animation) {
                      return FadeTransition(
                        opacity: animation,
                        child: ScaleTransition(scale: animation, child: child),
                      );
                    },
                    child: _buildChildForState(effectiveState, contentColor),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildChildForState(ButtonState effectiveState, Color contentColor) {
    switch (effectiveState) {
      case ButtonState.loading:
        return SizedBox(
          key: const ValueKey('loading'),
          height: widget.height * 0.6,
          width: widget.height * 0.6,
          child: ShimmerWrapper(
            child: ShimmerBlock(
              width: widget.height * 0.6,
              height: widget.height * 0.6,
              shape: BoxShape.circle,
              color: widget.loadingColor.withValues(alpha: 0.5),
            ),
          ),
        );
      case ButtonState.success:
        return Row(
          key: const ValueKey('success'),
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              widget.successIcon,
              color: Colors.white,
              size: widget.height * 0.5,
            ),
            const SizedBox(width: 8),
            Text('Success', style: widget.textStyle ?? _defaultTextStyle()),
          ],
        );
      case ButtonState.failure:
        return Row(
          key: const ValueKey('failure'),
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              widget.failureIcon,
              color: Colors.white,
              size: widget.height * 0.5,
            ),
            const SizedBox(width: 8),
            Text('Failed', style: widget.textStyle ?? _defaultTextStyle()),
          ],
        );
      case ButtonState.invisible:
        return SizedBox(
          key: const ValueKey('invisible'),
          width: widget.minWidth,
          height: widget.height,
        );
      case ButtonState.visible:
        // Icon-only mode: prefer socialSvg/socialIcon then leadingIcon
        if (widget.iconOnly) {
          final double iconSz = widget.iconSize ?? (widget.height * 0.5);
          Widget iconWidget;
          if (widget.socialSvg != null) {
            final String path = widget.socialSvg!;
            if (path.toLowerCase().endsWith('.svg')) {
              iconWidget = SvgPicture.asset(
                path,
                width: iconSz,
                height: iconSz,
                color: contentColor,
              );
            } else {
              iconWidget = Image.asset(
                path,
                width: iconSz,
                height: iconSz,
                fit: BoxFit.contain,
              );
            }
          } else if (widget.socialIcon != null) {
            iconWidget = Icon(
              widget.socialIcon,
              color: contentColor,
              size: iconSz,
            );
          } else if (widget.leadingIcon != null) {
            iconWidget = Icon(
              widget.leadingIcon,
              color: contentColor,
              size: iconSz,
            );
          } else {
            // Fallback to a simple circle with a label's first letter if no icon provided
            iconWidget = Text(
              widget.label.isNotEmpty ? widget.label[0] : '?',
              style: (widget.textStyle ?? _defaultTextStyle()).copyWith(
                color: contentColor,
                fontSize: iconSz * 0.9,
              ),
            );
          }

          return Center(key: const ValueKey('icon-only'), child: iconWidget);
        }

        return Row(
          key: const ValueKey('visible'),
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Social icon precedence: use `socialIcon` or `socialSvg` (asset image) when socialType provided,
            // otherwise fall back to leadingIcon.
            if (widget.socialType != null &&
                (widget.socialIcon != null || widget.socialSvg != null)) ...[
              if (widget.socialIcon != null) ...[
                Icon(
                  widget.socialIcon,
                  color: contentColor,
                  size: widget.height * 0.5,
                ),
              ] else ...[
                // fallback to an asset image for socialSvg; assuming caller provides a suitable raster/SVG asset.
                SizedBox(
                  height: widget.height * 0.6,
                  width: widget.height * 0.6,
                  child: Image.asset(widget.socialSvg!, fit: BoxFit.contain),
                ),
              ],
              const SizedBox(width: 8),
            ] else if (widget.leadingIcon != null) ...[
              Icon(widget.leadingIcon, color: contentColor),
              const SizedBox(width: 8),
            ],

            Flexible(
              child: Text(
                widget.label,
                style: (widget.textStyle ?? _defaultTextStyle()).copyWith(
                  color: contentColor,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),

            if (widget.trailingIcon != null) ...[
              const SizedBox(width: 8),
              Icon(widget.trailingIcon, color: contentColor),
            ],
          ],
        );
    }
  }

  TextStyle _defaultTextStyle() {
    return const TextStyle(
      color: Colors.white,
      fontSize: 16,
      fontWeight: FontWeight.w600,
    );
  }
}

enum ButtonState { visible, loading, success, failure, invisible }

/// Supported social button platforms. Used for `CommonButton.socialType`.
enum SocialType { google, twitter, apple, linkedin }
