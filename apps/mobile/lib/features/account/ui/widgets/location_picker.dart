import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/models/geo_point.dart';

/// Delivery position of an address.
///
/// The Google Maps / geolocator packages are currently disabled in
/// `pubspec.yaml`, so this only shows that a saved position exists and lets
/// the user remove it; with no position it renders nothing and the typed
/// address is what the delivery team uses. Re-enable those packages to bring
/// back the draggable map (same constructor).
class LocationPicker extends StatelessWidget {
  const LocationPicker({
    super.key,
    required this.location,
    required this.onLocationChanged,
    this.onCleared,
    this.height = 220,
  });

  final GeoPoint? location;
  final ValueChanged<GeoPoint> onLocationChanged;

  /// Shows a "Remove" action when set.
  final VoidCallback? onCleared;
  final double height;

  @override
  Widget build(BuildContext context) {
    if (location == null) return const SizedBox.shrink();
    return AppCard(
      padding: const EdgeInsetsDirectional.fromSTEB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: AppColors.successTint,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.place_rounded,
              color: AppColors.success,
              size: 22,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.tr('jb.address.location_pinned'),
                  style: AppTextStyles.label.copyWith(color: context.textMain),
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  context.tr('jb.address.location_pinned_hint'),
                  style: AppTextStyles.caption.copyWith(
                    color: context.textMuted,
                  ),
                ),
              ],
            ),
          ),
          if (onCleared != null)
            TextButton(
              onPressed: onCleared,
              child: Text(context.tr('jb.address.remove_location')),
            ),
        ],
      ),
    );
  }
}
