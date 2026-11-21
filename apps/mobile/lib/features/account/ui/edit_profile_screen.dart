import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/service/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../data/repo/account_repository.dart';

/// `PATCH /me` — name and email. The phone is the login and is read-only.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _form = GlobalKey<FormState>();
  late final _user = context.read<SessionCubit>().user;
  late final _name = TextEditingController(text: _user?.name ?? '');
  late final _email = TextEditingController(text: _user?.email ?? '');
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final email = _email.text.trim();
    final result = await getIt<AccountRepository>().updateProfile(
      name: _name.text.trim(),
      email: email.isEmpty ? null : email,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    switch (result) {
      case Success(:final data):
        context.read<SessionCubit>().updateUser(data);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('profile_updated_successfully'))),
        );
        context.pop();
      case Failure(:final message):
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(apiErrorText(context, message))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('jb.account.edit_profile'))),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.screenH),
          children: [
            TextFormField(
              controller: _name,
              maxLength: 120,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(labelText: context.tr('user_name')),
              validator: (v) => (v ?? '').trim().length < 2
                  ? context.tr('username_too_short')
                  : null,
            ),
            const SizedBox(height: AppSpacing.sm),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(
                labelText:
                    '${context.tr('email')} (${context.tr('jb.common.optional')})',
              ),
              validator: (v) {
                final value = (v ?? '').trim();
                if (value.isEmpty) return null;
                return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value)
                    ? null
                    : context.tr('jb.auth.invalid_email');
              },
            ),
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              initialValue: _user?.phone ?? '',
              enabled: false,
              decoration: InputDecoration(labelText: context.tr('phone')),
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
}
