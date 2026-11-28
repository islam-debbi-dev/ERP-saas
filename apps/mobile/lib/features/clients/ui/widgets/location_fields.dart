import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/locations/algeria_locations.dart';
import '../../../../core/locations/wilayas.dart';
import 'location_picker_sheet.dart';

/// Where a client is, as picked from the official lists. All optional.
@immutable
class ClientPlace {
  const ClientPlace({this.wilaya, this.daira, this.commune});

  final Wilaya? wilaya;

  /// Only narrows the commune list: it is not sent (derived from the commune).
  final Daira? daira;
  final Commune? commune;
}

/// Wilaya → Daïra → Commune. The daïra can be left empty: the commune list
/// then holds every commune of the wilaya.
class LocationFields extends StatefulWidget {
  const LocationFields({
    super.key,
    required this.value,
    required this.onChanged,
  });

  final ClientPlace value;
  final ValueChanged<ClientPlace> onChanged;

  @override
  State<LocationFields> createState() => _LocationFieldsState();
}

class _LocationFieldsState extends State<LocationFields> {
  /// Stops a double tap from opening two sheets while the list loads.
  bool _opening = false;

  String get _language => Localizations.localeOf(context).languageCode;

  Future<void> _open(Future<void> Function() pick) async {
    if (_opening) return;
    _opening = true;
    // Without this the keyboard comes back when the sheet closes.
    FocusManager.instance.primaryFocus?.unfocus();
    try {
      await pick();
    } finally {
      _opening = false;
    }
  }

  Future<void> _pickWilaya() async {
    final picked = await showLocationPicker<Wilaya>(
      context,
      title: context.tr('location.choose_wilaya'),
      icon: Icons.map_outlined,
      selected: widget.value.wilaya,
      options: [
        for (final w in algeriaWilayas)
          LocationOption(
            value: w,
            id: 'wilaya-${w.code}',
            label: _wilayaLabel(w),
            // The two digits find a wilaya by its number.
            searchNames: [_number(w), w.fr, w.ar],
          ),
      ],
    );
    if (picked == null || !mounted) return;
    // The same wilaya again keeps the daïra and commune.
    if (picked.code == widget.value.wilaya?.code) return;
    widget.onChanged(ClientPlace(wilaya: picked));
  }

  Future<void> _pickDaira(Wilaya wilaya) async {
    final locations = await AlgeriaLocations.load();
    if (!mounted) return;
    final dairas = locations.dairasOf(wilaya.code)
      ..sort((a, b) => a.name(_language).compareTo(b.name(_language)));
    final picked = await showLocationPicker<Daira>(
      context,
      title: context.tr('location.choose_daira'),
      icon: Icons.account_tree_outlined,
      selected: dairas
          .where((d) => d.key == widget.value.daira?.key)
          .firstOrNull,
      options: [
        for (final d in dairas)
          LocationOption(
            value: d,
            id: 'daira-${d.key}',
            label: d.name(_language),
            searchNames: [d.fr, d.ar],
          ),
      ],
    );
    if (picked == null || !mounted) return;
    final commune = widget.value.commune;
    widget.onChanged(
      ClientPlace(
        wilaya: wilaya,
        daira: picked,
        commune: commune?.dairaKey == picked.key ? commune : null,
      ),
    );
  }

  Future<void> _pickCommune(Wilaya wilaya) async {
    final locations = await AlgeriaLocations.load();
    if (!mounted) return;
    final daira = widget.value.daira;
    final underReview = isWilayaUnderReview(wilaya.code);
    LocationOption<Commune> option(Commune c) => LocationOption(
      value: c,
      id: 'commune-${c.code}',
      label: c.name(_language),
      searchNames: [c.fr, c.ar, ...c.aliases],
      disabledReason: underReview ? context.tr('location.under_review') : null,
    );
    List<LocationOption<Commune>> options({String? dairaKey}) {
      final communes = locations.communesOf(wilaya.code, dairaKey: dairaKey)
        ..sort((a, b) => a.name(_language).compareTo(b.name(_language)));
      return communes.map(option).toList();
    }

    final picked = await showLocationPicker<Commune>(
      context,
      title: context.tr('location.choose_commune'),
      icon: Icons.location_city_outlined,
      selected: widget.value.commune,
      note: underReview ? context.tr('location.under_review_note') : null,
      options: options(dairaKey: daira?.key),
      // Under a daïra, one tap brings back the whole wilaya: some communes
      // have no daïra.
      allOptions: daira == null ? null : options(),
      showAllLabel: context.tr('location.all_communes'),
    );
    if (picked == null || !mounted) return;
    widget.onChanged(
      ClientPlace(
        wilaya: wilaya,
        daira: picked.dairaKey == daira?.key ? daira : null,
        commune: picked,
      ),
    );
  }

  static String _number(Wilaya w) => '${w.code}'.padLeft(2, '0');

  /// `28 · M'Sila`: the number first, as on a plate.
  String _wilayaLabel(Wilaya w) => '${_number(w)} · ${w.name(_language)}';

  @override
  Widget build(BuildContext context) {
    final ClientPlace(:wilaya, :daira, :commune) = widget.value;
    final chooseWilaya = context.tr('location.wilaya_first');
    return Column(
      children: [
        _PickerField(
          key: const Key('pick-wilaya'),
          label: context.tr('location.wilaya'),
          icon: Icons.map_outlined,
          value: wilaya == null ? null : _wilayaLabel(wilaya),
          onTap: () => _open(_pickWilaya),
          onClear: () => widget.onChanged(const ClientPlace()),
        ),
        AppSpacing.gapMd,
        _PickerField(
          key: const Key('pick-daira'),
          label: context.tr('location.daira'),
          icon: Icons.account_tree_outlined,
          value: daira?.name(_language),
          helper: wilaya == null ? chooseWilaya : null,
          onTap: wilaya == null ? null : () => _open(() => _pickDaira(wilaya)),
          onClear: () =>
              widget.onChanged(ClientPlace(wilaya: wilaya, commune: commune)),
        ),
        AppSpacing.gapMd,
        _PickerField(
          key: const Key('pick-commune'),
          label: context.tr('location.commune'),
          icon: Icons.location_city_outlined,
          value: commune?.name(_language),
          helper: wilaya == null
              ? chooseWilaya
              : isWilayaUnderReview(wilaya.code)
              ? context.tr('location.under_review_note')
              : null,
          onTap: wilaya == null
              ? null
              : () => _open(() => _pickCommune(wilaya)),
          onClear: () =>
              widget.onChanged(ClientPlace(wilaya: wilaya, daira: daira)),
        ),
      ],
    );
  }
}

/// A form box that opens a list instead of the keyboard. A null [onTap]
/// disables it.
class _PickerField extends StatelessWidget {
  const _PickerField({
    super.key,
    required this.label,
    required this.icon,
    required this.value,
    required this.onTap,
    required this.onClear,
    this.helper,
  });

  final String label;
  final IconData icon;
  final String? value;
  final String? helper;
  final VoidCallback? onTap;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      child: InkWell(
        borderRadius: AppRadius.mdAll,
        onTap: onTap,
        child: InputDecorator(
          isEmpty: value == null,
          decoration: InputDecoration(
            enabled: enabled,
            labelText: label,
            helperText: helper,
            helperMaxLines: 3,
            prefixIcon: Icon(icon),
            suffixIcon: value == null
                ? const Icon(Icons.expand_more_rounded)
                : IconButton(
                    tooltip: context.tr('common.clear'),
                    icon: const Icon(Icons.close_rounded),
                    onPressed: onClear,
                  ),
          ),
          child: value == null
              ? null
              : Text(
                  value!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
        ),
      ),
    );
  }
}
