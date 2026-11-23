import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../components/widgets/amount_text.dart';
import '../design/design.dart';
import '../helpers/phone_links.dart';
import '../localization/tr.dart';
import 'navigation_links.dart';

/// What the sheet of a tapped marker shows.
class MapClient {
  const MapClient({
    required this.id,
    required this.name,
    required this.balance,
    required this.lat,
    required this.lng,
    this.code,
    this.commune,
    this.phone,
  });

  final String id;
  final String name;
  final String? code;
  final String? commune;
  final String? phone;
  final Decimal balance;
  final double lat;
  final double lng;
}

/// Opens the client's sheet over the tab bar. [onOpen] runs after the sheet
/// closes ("Ouvrir la fiche"); none = the button is hidden. [extra] goes
/// between the balance and the actions (the livreur's orders); it gets the
/// sheet's context so a button in it can close the sheet first.
Future<void> showClientMapSheet(
  BuildContext context, {
  required MapClient client,
  VoidCallback? onOpen,
  Widget Function(BuildContext sheetContext)? extra,
}) async {
  final open = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) => ClientMapSheet(
      client: client,
      canOpen: onOpen != null,
      extra: extra?.call(sheet),
    ),
  );
  if (open == true) onOpen?.call();
}

class ClientMapSheet extends StatelessWidget {
  const ClientMapSheet({
    super.key,
    required this.client,
    this.canOpen = false,
    this.extra,
  });

  final MapClient client;
  final bool canOpen;
  final Widget? extra;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final subtitle = [
      if (client.code != null) client.code!,
      if (client.commune != null && client.commune!.isNotEmpty) client.commune!,
    ].join(' · ');
    final phone = client.phone;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.8,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(
            AppSpacing.lg,
            0,
            AppSpacing.lg,
            AppSpacing.lg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                client.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: text.titleLarge,
              ),
              if (subtitle.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodyMedium?.copyWith(color: context.textMuted),
                ),
              ],
              AppSpacing.gapMd,
              Row(
                children: [
                  Expanded(
                    child: Text(
                      context.tr('map.balance'),
                      style: text.bodyMedium?.copyWith(
                        color: context.textMuted,
                      ),
                    ),
                  ),
                  AmountText(
                    client.balance,
                    colorBySign: true,
                    style: text.titleMedium,
                  ),
                ],
              ),
              if (extra != null) ...[AppSpacing.gapMd, extra!],
              AppSpacing.gapLg,
              Row(
                children: [
                  if (phone != null && phone.trim().isNotEmpty) ...[
                    Expanded(
                      child: AppButton(
                        label: context.tr('map.call'),
                        icon: Icons.call_outlined,
                        variant: AppButtonVariant.outline,
                        onPressed: () => PhoneLinks.call(context, phone),
                      ),
                    ),
                    AppSpacing.gapSm,
                  ],
                  Expanded(
                    child: AppButton(
                      label: context.tr('map.navigate'),
                      icon: Icons.directions_outlined,
                      variant: AppButtonVariant.outline,
                      onPressed: () =>
                          NavigationLinks.open(context, client.lat, client.lng),
                    ),
                  ),
                ],
              ),
              if (canOpen) ...[
                AppSpacing.gapSm,
                AppButton(
                  label: context.tr('map.open_client'),
                  icon: Icons.person_outline,
                  onPressed: () => Navigator.of(context).pop(true),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
