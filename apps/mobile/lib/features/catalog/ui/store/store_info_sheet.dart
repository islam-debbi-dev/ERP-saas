import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/design/design.dart';
import '../../../../core/helpers/money.dart';
import '../../../../core/localization/tr.dart';
import '../../data/models/store.dart';
import 'store_hours.dart';

/// Address, phone, the week's opening hours and the minimum order, in a
/// bottom sheet with a grabber, so the store header stays short.
Future<void> showStoreInfoSheet(BuildContext context, Store store) =>
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      useSafeArea: true,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
      ),
      builder: (_) => StoreInfoSheet(store: store),
    );

class StoreInfoSheet extends StatelessWidget {
  const StoreInfoSheet({super.key, required this.store});

  final Store store;

  @override
  Widget build(BuildContext context) {
    final location = store.location;
    final today = backendDay(DateTime.now());
    // Backend order: Sunday (0) … Saturday (6).
    final days = [for (var d = 0; d < 7; d++) d];
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.85,
      ),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.screenH,
          0,
          AppSpacing.screenH,
          AppSpacing.xl,
        ),
        children: [
          Text(
            store.name,
            style: AppTextStyles.h2.copyWith(color: context.textMain),
          ),
          if (store.address.isNotEmpty) ...[
            _Title(context.tr('jb.store.address')),
            _Group(
              children: [
                _Row(
                  icon: Icons.place_outlined,
                  text: store.address,
                  actionLabel: location == null
                      ? null
                      : context.tr('jb.store.directions'),
                  onAction: location == null
                      ? null
                      : () => launchUrl(
                          Uri.https('www.google.com', '/maps/search/', {
                            'api': '1',
                            'query': '${location.lat},${location.lng}',
                          }),
                          mode: LaunchMode.externalApplication,
                        ),
                ),
              ],
            ),
          ],
          if (store.phone.isNotEmpty) ...[
            _Title(context.tr('jb.store.phone')),
            _Group(
              children: [
                _Row(
                  icon: Icons.call_outlined,
                  text: store.phone,
                  textDirection: TextDirection.ltr,
                  actionLabel: context.tr('jb.store.call'),
                  onAction: () =>
                      launchUrl(Uri(scheme: 'tel', path: store.phone)),
                ),
              ],
            ),
          ],
          if (store.openingHours.isNotEmpty) ...[
            _Title(context.tr('jb.store.hours')),
            _Group(
              children: [
                for (final day in days)
                  _HoursRow(
                    day: context.tr('jb.store.day_$day'),
                    hours: store.openingHours
                        .where((h) => h.day == day)
                        .firstOrNull,
                    isToday: day == today,
                  ),
              ],
            ),
          ],
          _Title(context.tr('jb.store.min_order')),
          _Group(
            children: [
              _Row(
                icon: Icons.receipt_long_outlined,
                text: store.minimumOrderAmount > 0
                    ? formatDzd(context, store.minimumOrderAmount)
                    : context.tr('jb.store.no_minimum'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Title extends StatelessWidget {
  const _Title(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.xl, bottom: AppSpacing.sm),
    child: Text(
      text,
      style: AppTextStyles.label.copyWith(color: context.textMuted),
    ),
  );
}

/// iOS grouped section: rounded fill, hairlines between rows.
class _Group extends StatelessWidget {
  const _Group({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: context.fieldFill,
      borderRadius: AppRadius.lgAll,
    ),
    child: Column(
      children: [
        for (final (i, child) in children.indexed) ...[
          if (i > 0)
            Divider(
              height: 0.5,
              thickness: 0.5,
              indent: AppSpacing.lg,
              endIndent: AppSpacing.lg,
              color: context.fieldBorder,
            ),
          child,
        ],
      ],
    ),
  );
}

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.text,
    this.textDirection,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String text;
  final TextDirection? textDirection;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
    child: Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.sm,
      ),
      child: Row(
        children: [
          Icon(icon, size: 20, color: context.textMuted),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              text,
              textDirection: textDirection,
              textAlign: TextAlign.start,
              style: AppTextStyles.body.copyWith(color: context.textMain),
            ),
          ),
          if (actionLabel != null)
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
        ],
      ),
    ),
  );
}

class _HoursRow extends StatelessWidget {
  const _HoursRow({
    required this.day,
    required this.hours,
    required this.isToday,
  });

  final String day;
  final OpeningHour? hours;
  final bool isToday;

  @override
  Widget build(BuildContext context) {
    final style = AppTextStyles.body.copyWith(
      color: context.textMain,
      fontWeight: isToday ? FontWeight.w700 : FontWeight.w400,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: [
          Expanded(child: Text(day, style: style)),
          Text(
            hours == null
                ? context.tr('jb.store.closed')
                : '${hours!.open} – ${hours!.close}',
            textDirection: TextDirection.ltr,
            style: hours == null
                ? style.copyWith(color: context.textMuted)
                : style,
          ),
        ],
      ),
    );
  }
}
