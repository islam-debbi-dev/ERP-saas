import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../../core/service/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../../auth/ui/widgets/password_field.dart';
import '../data/repo/account_repository.dart';

/// `PATCH /me/password`. The backend revokes every session on success, so
/// the user signs in again with the new password.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final result = await getIt<AccountRepository>().changePassword(
      currentPassword: _current.text,
      newPassword: _next.text,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    switch (result) {
      case Success():
        await context.read<SessionCubit>().signOutLocally();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('jb.auth.password_changed'))),
        );
        context.go(Routes.login);
      case Failure(:final message):
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(apiErrorText(context, message))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('jb.account.change_password'))),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.screenH),
          children: [
            PasswordField(
              controller: _current,
              label: context.tr('jb.auth.current_password'),
              validateLength: false,
            ),
            const SizedBox(height: AppSpacing.md),
            PasswordField(
              controller: _next,
              label: context.tr('jb.auth.new_password'),
            ),
            const SizedBox(height: AppSpacing.md),
            PasswordField(
              controller: _confirm,
              label: context.tr('jb.auth.confirm_password'),
              validator: (v) => v != _next.text
                  ? context.tr('jb.auth.passwords_mismatch')
                  : null,
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              context.tr('jb.auth.relogin_note'),
              style: Theme.of(context).textTheme.bodySmall,
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
