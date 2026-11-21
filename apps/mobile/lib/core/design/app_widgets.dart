import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

import '../components/logo/jibli_loader.dart';
import '../theme/app_theme.dart';
import 'app_spacing.dart';
import 'app_text_styles.dart';

/// Reusable building blocks that carry the Jibli look. Use these instead of
/// restyling Containers / buttons inside each screen.

enum AppButtonVariant { primary, accent, secondary, outline, text }

/// Full-width (by default) button with a loading state. 52px tall, rounded.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.icon,
    this.loading = false,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final IconData? icon;
  final bool loading;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final bool dark = Theme.of(context).brightness == Brightness.dark;

    Color bg;
    Color fg;
    BorderSide? side;
    switch (variant) {
      case AppButtonVariant.primary:
        bg = dark ? AppColors.yellow : AppColors.ink;
        fg = dark ? AppColors.ink : Colors.white;
        break;
      case AppButtonVariant.accent:
        bg = AppColors.yellow;
        fg = AppColors.ink;
        break;
      case AppButtonVariant.secondary:
        bg = dark ? AppColors.darkElevated : AppColors.grouped;
        fg = Theme.of(context).colorScheme.onSurface;
        break;
      case AppButtonVariant.outline:
        bg = Colors.transparent;
        fg = Theme.of(context).colorScheme.onSurface;
        side = BorderSide(color: Theme.of(context).colorScheme.outline);
        break;
      case AppButtonVariant.text:
        bg = Colors.transparent;
        fg = Theme.of(context).colorScheme.onSurface;
        break;
    }

    final bool disabled = onPressed == null || loading;

    final Widget content = loading
        ? JibliLoader(
            size: 28,
            color: fg,
            trackColor: fg.withValues(alpha: 0.25),
            shadow: false,
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 20, color: fg),
                const SizedBox(width: AppSpacing.sm),
              ],
              // Long labels (e.g. Arabic in half-width buttons) shrink to fit
              // instead of being cut off with an ellipsis.
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    label,
                    maxLines: 1,
                    style: AppTextStyles.button.copyWith(color: fg),
                  ),
                ),
              ),
            ],
          );

    final Widget button = Material(
      color: disabled && variant != AppButtonVariant.text
          ? (variant == AppButtonVariant.outline
                ? bg
                : bg.withValues(alpha: 0.5))
          : bg,
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.mdAll,
        side: side ?? BorderSide.none,
      ),
      child: InkWell(
        borderRadius: AppRadius.mdAll,
        onTap: disabled ? null : onPressed,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52, minWidth: 64),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            // heightFactor keeps the button 52px tall when the parent gives it
            // loose height (e.g. a Scaffold's bottomNavigationBar).
            child: Center(widthFactor: 1, heightFactor: 1, child: content),
          ),
        ),
      ),
    );

    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// Rounded surface used for list rows, summary blocks and form groups.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = AppSpacing.card,
    this.onTap,
    this.color,
    this.shadow = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final bool shadow;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool dark = theme.brightness == Brightness.dark;
    final Color fill =
        color ?? (dark ? AppColors.darkSurface : AppColors.surface);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: AppRadius.lgAll,
        boxShadow: shadow ? AppShadows.card : null,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: AppRadius.lgAll,
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// Section title with an optional trailing action ("See all").
class AppSectionHeader extends StatelessWidget {
  const AppSectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
        ),
        if (actionLabel != null)
          TextButton(onPressed: onAction, child: Text(actionLabel!)),
      ],
    );
  }
}

/// Centered illustration + message used for empty lists.
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    required this.title,
    this.message,
    this.icon = Icons.inbox_outlined,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Center(
      child: SingleChildScrollView(
        padding: AppSpacing.screen,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 88,
                height: 88,
                decoration: const BoxDecoration(
                  color: AppColors.yellowTint,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 40, color: AppColors.ink),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                title,
                textAlign: TextAlign.center,
                style: text.headlineMedium,
              ),
              if (message != null) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  message!,
                  textAlign: TextAlign.center,
                  style: text.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: AppSpacing.xl),
                AppButton(
                  label: actionLabel!,
                  onPressed: onAction,
                  expand: false,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Error variant of the empty state with a retry button.
class AppErrorState extends StatelessWidget {
  const AppErrorState({
    super.key,
    required this.title,
    this.message,
    this.retryLabel,
    this.onRetry,
  });

  final String title;
  final String? message;
  final String? retryLabel;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return AppEmptyState(
      title: title,
      message: message,
      icon: Icons.wifi_off_rounded,
      actionLabel: retryLabel,
      onAction: onRetry,
    );
  }
}

/// Small centered progress indicator in the brand colour.
class AppLoader extends StatelessWidget {
  const AppLoader({super.key, this.size = 64});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Center(child: JibliLoader(size: size));
  }
}

/// [AppLoader] as the first-load state of a scroll view: centered in the
/// space left below the slivers before it.
class AppSliverLoader extends StatelessWidget {
  const AppSliverLoader({super.key});

  @override
  Widget build(BuildContext context) {
    return const SliverFillRemaining(
      hasScrollBody: false,
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.huge),
        child: AppLoader(),
      ),
    );
  }
}

/// Grey shimmering placeholder block for skeleton loading states.
///
/// Alone it runs its own shimmer. Inside an [AppSkeletonGroup] it is a plain
/// block and the group shimmers once for all of them.
class AppSkeleton extends StatelessWidget {
  const AppSkeleton({
    super.key,
    this.width,
    this.height = 16,
    this.radius = AppRadius.sm,
  });

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final block = Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
    if (context.getInheritedWidgetOfExactType<_SkeletonScope>() != null) {
      return block;
    }
    return AppSkeletonGroup(child: block);
  }
}

/// One shimmer for every [AppSkeleton] below it: one animation and one
/// shader layer per skeleton screen, instead of one per block. It stops
/// with the skeleton (when the content replaces it).
class AppSkeletonGroup extends StatelessWidget {
  const AppSkeletonGroup({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    return Shimmer.fromColors(
      baseColor: dark ? AppColors.darkSurface : AppColors.grouped,
      highlightColor: dark ? AppColors.darkElevated : AppColors.white,
      child: _SkeletonScope(child: child),
    );
  }
}

class _SkeletonScope extends InheritedWidget {
  const _SkeletonScope({required super.child});

  @override
  bool updateShouldNotify(_SkeletonScope oldWidget) => false;
}

/// Selectable pill (filters, categories).
class AppChoiceChip extends StatelessWidget {
  const AppChoiceChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    final Color bg = selected
        ? AppColors.yellow
        : (dark ? AppColors.darkSurface : AppColors.surface);
    final Color fg = selected
        ? AppColors.ink
        : Theme.of(context).colorScheme.onSurface;

    return Material(
      color: bg,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 18, color: fg),
                  const SizedBox(width: AppSpacing.xs),
                ],
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.label.copyWith(color: fg),
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

/// Circular icon button that stays readable on top of photos (gallery, store
/// cover): page-coloured disc with a hairline border.
class AppRoundIconButton extends StatelessWidget {
  const AppRoundIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    required this.tooltip,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: dark ? AppColors.darkSurface : AppColors.white,
        shape: CircleBorder(
          side: BorderSide(
            color: dark ? AppColors.darkDivider : AppColors.divider,
          ),
        ),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: 46,
            height: 46,
            child: Icon(
              icon,
              size: 22,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}
