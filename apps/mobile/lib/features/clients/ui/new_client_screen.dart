import 'package:flutter/material.dart';

import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../auth/ui/widgets/form_error_banner.dart';
import '../data/repo/clients_repository.dart';

/// A new client from the road (CLIENTS_CREATE): code, name, phone, address,
/// commune. Pops with the created client.
class NewClientScreen extends StatefulWidget {
  const NewClientScreen({super.key});

  @override
  State<NewClientScreen> createState() => _NewClientScreenState();
}

class _NewClientScreenState extends State<NewClientScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _commune = TextEditingController();
  bool _professional = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_code, _name, _phone, _address, _commune]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || !(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final result = await getIt<ClientsRepository>().create(
      NewClient(
        code: _code.text,
        name: _name.text,
        phone: _phone.text,
        address: _address.text,
        commune: _commune.text,
        professional: _professional,
      ),
    );
    if (!mounted) return;
    switch (result) {
      case Success(:final data):
        Navigator.of(context).pop(data);
      case Failure(:final error):
        setState(() {
          _saving = false;
          _error = apiErrorText(context, error);
        });
    }
  }

  String? _required(String? v) =>
      (v ?? '').trim().isEmpty ? context.tr('common.required') : null;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('clients.new'))),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: AppButton(
            label: context.tr('common.save'),
            loading: _saving,
            onPressed: _save,
          ),
        ),
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            if (_error != null) ...[
              FormErrorBanner(message: _error!),
              AppSpacing.gapLg,
            ],
            TextFormField(
              controller: _code,
              textDirection: TextDirection.ltr,
              textInputAction: TextInputAction.next,
              maxLength: 30,
              decoration: InputDecoration(
                labelText: context.tr('clients.code'),
              ),
              validator: _required,
            ),
            AppSpacing.gapSm,
            TextFormField(
              controller: _name,
              textInputAction: TextInputAction.next,
              maxLength: 160,
              decoration: InputDecoration(
                labelText: context.tr('clients.name'),
              ),
              validator: _required,
            ),
            AppSpacing.gapSm,
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              textInputAction: TextInputAction.next,
              maxLength: 40,
              decoration: InputDecoration(
                labelText: context.tr('clients.phone'),
                prefixIcon: const Icon(Icons.phone_outlined),
              ),
            ),
            AppSpacing.gapSm,
            TextFormField(
              controller: _address,
              textInputAction: TextInputAction.next,
              maxLength: 255,
              decoration: InputDecoration(
                labelText: context.tr('clients.address'),
              ),
            ),
            AppSpacing.gapSm,
            TextFormField(
              controller: _commune,
              textInputAction: TextInputAction.done,
              maxLength: 80,
              decoration: InputDecoration(
                labelText: context.tr('clients.commune'),
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _professional,
              title: Text(context.tr('clients.professional')),
              onChanged: (v) => setState(() => _professional = v),
            ),
          ],
        ),
      ),
    );
  }
}
