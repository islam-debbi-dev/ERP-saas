import 'package:flutter/material.dart';

import '../../../../core/components/widgets/search_input.dart';
import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/locations/location_search.dart';

/// One row of a place list.
class LocationOption<T> {
  const LocationOption({
    required this.value,
    required this.id,
    required this.label,
    required this.searchNames,
    this.disabledReason,
  });

  final T value;

  /// Unique in the list; the row's key.
  final String id;
  final String label;

  /// Every spelling a search looks at, in both languages.
  final List<String?> searchNames;

  /// When set, the row cannot be picked and says why.
  final String? disabledReason;
}

/// A searchable list in a bottom sheet. Returns the picked value, or null.
/// [allOptions] adds a first row ([showAllLabel]) that widens the list to them.
Future<T?> showLocationPicker<T>(
  BuildContext context, {
  required String title,
  required IconData icon,
  required List<LocationOption<T>> options,
  T? selected,
  String? note,
  List<LocationOption<T>>? allOptions,
  String? showAllLabel,
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (_) => _LocationPickerSheet<T>(
    title: title,
    icon: icon,
    options: options,
    selected: selected,
    note: note,
    allOptions: allOptions,
    showAllLabel: showAllLabel,
  ),
);

class _LocationPickerSheet<T> extends StatefulWidget {
  const _LocationPickerSheet({
    required this.title,
    required this.icon,
    required this.options,
    this.selected,
    this.note,
    this.allOptions,
    this.showAllLabel,
  });

  final String title;
  final IconData icon;
  final List<LocationOption<T>> options;
  final T? selected;
  final String? note;
  final List<LocationOption<T>>? allOptions;
  final String? showAllLabel;

  @override
  State<_LocationPickerSheet<T>> createState() =>
      _LocationPickerSheetState<T>();
}

class _LocationPickerSheetState<T> extends State<_LocationPickerSheet<T>> {
  String _query = '';
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final options = _showAll ? widget.allOptions! : widget.options;
    final found = [
      for (final o in options)
        if (matchesSearch(_query, o.searchNames)) o,
    ];
    final canShowAll = !_showAll && widget.allOptions != null;
    final theme = Theme.of(context);
    final screen = MediaQuery.sizeOf(context).height;
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboard),
      child: SizedBox(
        height: screen * 0.85,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(widget.title, style: theme.textTheme.titleMedium),
                  AppSpacing.gapMd,
                  SearchInput(onChanged: (v) => setState(() => _query = v)),
                  if (widget.note != null) ...[
                    AppSpacing.gapSm,
                    Text(widget.note!, style: theme.textTheme.bodySmall),
                  ],
                  AppSpacing.gapSm,
                ],
              ),
            ),
            if (canShowAll)
              ListTile(
                key: const Key('show-all'),
                minTileHeight: 56,
                leading: const Icon(Icons.unfold_more_rounded),
                title: Text(widget.showAllLabel!),
                onTap: () => setState(() => _showAll = true),
              ),
            Expanded(
              child: found.isEmpty
                  ? Center(child: Text(context.tr('location.no_result')))
                  : ListView.builder(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      itemCount: found.length,
                      itemBuilder: (context, i) {
                        final o = found[i];
                        final reason = o.disabledReason;
                        final isSelected = o.value == widget.selected;
                        return ListTile(
                          key: Key(o.id),
                          minTileHeight: 56,
                          enabled: reason == null,
                          selected: isSelected,
                          selectedColor: context.textMain,
                          leading: Icon(widget.icon),
                          title: Text(o.label),
                          subtitle: reason == null ? null : Text(reason),
                          trailing: isSelected
                              ? const Icon(Icons.check_rounded)
                              : null,
                          onTap: () => Navigator.of(context).pop(o.value),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
