import 'package:flutter/material.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';

/// Why the app asks for the position (loi 18-07): read once when a sale,
/// versement or visit is saved, never in the background. True = "Autoriser".
Future<bool> showLocationPermissionSheet(
  BuildContext context, {
  bool blocked = false,
}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => LocationPermissionSheet(blocked: blocked),
  );
  return ok ?? false;
}

class LocationPermissionSheet extends StatelessWidget {
  const LocationPermissionSheet({super.key, this.blocked = false});

  /// Refused for good or service off: the button opens the settings.
  final bool blocked;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsetsDirectional.fromSTEB(
          AppSpacing.xl,
          0,
          AppSpacing.xl,
          AppSpacing.xl,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.location_on_outlined,
              size: 40,
              color: Theme.of(context).colorScheme.primary,
            ),
            AppSpacing.gapMd,
            Text(context.tr('geo.why_title'), style: text.headlineSmall),
            AppSpacing.gapSm,
            Text(context.tr('geo.why_body'), style: text.bodyMedium),
            AppSpacing.gapSm,
            Text(
              context.tr('geo.law_notice'),
              style: text.bodySmall?.copyWith(color: context.textMuted),
            ),
            AppSpacing.gapXl,
            AppButton(
              label: context.tr(blocked ? 'geo.open_settings' : 'geo.allow'),
              icon: Icons.my_location,
              onPressed: () => Navigator.of(context).pop(true),
            ),
            AppSpacing.gapSm,
            AppButton(
              label: context.tr('geo.not_now'),
              variant: AppButtonVariant.text,
              onPressed: () => Navigator.of(context).pop(false),
            ),
          ],
        ),
      ),
    );
  }
}
