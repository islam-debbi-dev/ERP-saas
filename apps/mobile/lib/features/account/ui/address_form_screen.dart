import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/geo_point.dart';
import '../../../core/service/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../data/models/address.dart';
import '../data/repo/account_repository.dart';
import 'widgets/location_picker.dart';

/// Preset address names; [other] reveals a free-text name field.
enum _LabelKind { home, work, other }

/// Create or edit a saved address. Pops `true` after saving.
class AddressFormScreen extends StatefulWidget {
  const AddressFormScreen({super.key, this.address});

  /// Null = new address.
  final Address? address;

  @override
  State<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends State<AddressFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _customLabel = TextEditingController();
  late final _fullAddress = TextEditingController(
    text: widget.address?.fullAddress ?? '',
  );
  late final _city = TextEditingController(text: widget.address?.city ?? '');
  late GeoPoint? _location = widget.address?.location;
  late bool _isDefault = widget.address?.isDefault ?? false;
  _LabelKind? _labelKind;
  bool _saving = false;

  bool get _editing => widget.address != null;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Needs the locale, so it can't run in initState.
    if (_labelKind != null) return;
    final label = widget.address?.label.trim() ?? '';
    if (label.isEmpty || label == context.tr('jb.address.label_home')) {
      _labelKind = _LabelKind.home;
    } else if (label == context.tr('jb.address.label_work')) {
      _labelKind = _LabelKind.work;
    } else {
      _labelKind = _LabelKind.other;
      _customLabel.text = label;
    }
  }

  @override
  void dispose() {
    _customLabel.dispose();
    _fullAddress.dispose();
    _city.dispose();
    super.dispose();
  }

  String get _label => switch (_labelKind!) {
    _LabelKind.home => context.tr('jb.address.label_home'),
    _LabelKind.work => context.tr('jb.address.label_work'),
    _LabelKind.other =>
      _customLabel.text.trim().isEmpty
          ? context.tr('jb.address.label_other')
          : _customLabel.text.trim(),
  };

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _saving = true);
    final repo = getIt<AccountRepository>();
    final address = Address(
      id: widget.address?.id ?? '',
      label: _label,
      fullAddress: _fullAddress.text.trim(),
      city: _city.text.trim().isEmpty ? null : _city.text.trim(),
      location: _location,
      isDefault: _isDefault,
    );
    final result = _editing
        ? await repo.updateAddress(address)
        : await repo.createAddress(address);
    if (!mounted) return;
    switch (result) {
      case Success():
        await context.read<SessionCubit>().refreshUser();
        if (mounted) context.pop(true);
      case Failure(:final message):
        setState(() => _saving = false);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(apiErrorText(context, message))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          context.tr(_editing ? 'jb.address.edit' : 'jb.address.add'),
        ),
      ),
      body: Form(
        key: _form,
        child: ListView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screenH,
            AppSpacing.sm,
            AppSpacing.screenH,
            AppSpacing.xl,
          ),
          children: [
            Text(context.tr('jb.address.label'), style: text.titleSmall),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                _chip(
                  _LabelKind.home,
                  'jb.address.label_home',
                  Icons.home_outlined,
                ),
                _chip(
                  _LabelKind.work,
                  'jb.address.label_work',
                  Icons.work_outline_rounded,
                ),
                _chip(
                  _LabelKind.other,
                  'jb.address.label_other',
                  Icons.place_outlined,
                ),
              ],
            ),
            if (_labelKind == _LabelKind.other) ...[
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _customLabel,
                maxLength: 40,
                autofocus: _customLabel.text.isEmpty,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(
                  labelText: context.tr('jb.address.label_custom'),
                  hintText: context.tr('jb.address.label_custom_hint'),
                  counterText: '',
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
            Text(context.tr('jb.address.details'), style: text.titleSmall),
            const SizedBox(height: AppSpacing.sm),
            TextFormField(
              controller: _fullAddress,
              maxLength: 400,
              minLines: 2,
              maxLines: 3,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: context.tr('address'),
                counterText: '',
                alignLabelWithHint: true,
              ),
              validator: (v) => (v ?? '').trim().length < 4
                  ? context.tr('error_required_address')
                  : null,
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _city,
              maxLength: 80,
              textInputAction: TextInputAction.done,
              decoration: InputDecoration(
                labelText: context.tr('jb.address.city'),
                counterText: '',
              ),
            ),
            if (_location != null) ...[
              const SizedBox(height: AppSpacing.md),
              LocationPicker(
                location: _location,
                onLocationChanged: (p) => setState(() => _location = p),
                onCleared: () => setState(() => _location = null),
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
            AppCard(
              padding: const EdgeInsetsDirectional.fromSTEB(
                AppSpacing.lg,
                AppSpacing.xs,
                AppSpacing.sm,
                AppSpacing.xs,
              ),
              child: SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                value: _isDefault,
                onChanged: (v) => setState(() => _isDefault = v),
                title: Text(
                  context.tr('jb.address.make_default'),
                  style: AppTextStyles.body.copyWith(color: context.textMain),
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screenH,
            AppSpacing.sm,
            AppSpacing.screenH,
            AppSpacing.md,
          ),
          child: AppButton(
            label: context.tr('save'),
            loading: _saving,
            onPressed: _save,
          ),
        ),
      ),
    );
  }

  Widget _chip(_LabelKind kind, String key, IconData icon) => AppChoiceChip(
    label: context.tr(key),
    icon: icon,
    selected: _labelKind == kind,
    onTap: () => setState(() => _labelKind = kind),
  );
}
