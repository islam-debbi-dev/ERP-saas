import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/session/session_cubit.dart';
import 'widgets/auth_scaffold.dart';
import 'widgets/form_error_banner.dart';
import 'widgets/password_field.dart';

/// `POST /auth/password`. [forced] when the user signed in with a temporary
/// password: no back button, only this screen or logout (every other API
/// route answers PASSWORD_CHANGE_REQUIRED until it is done).
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key, this.forced = false});

  final bool forced;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading || !_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    final error = await context.read<SessionCubit>().changePassword(
      _current.text,
      _next.text,
    );
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error == null ? null : apiErrorText(context, error);
    });
    if (error != null) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.tr('auth.password_changed'))),
    );
    // Forced: the router leaves this screen on the new session state.
    if (!widget.forced && context.canPop()) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      showBack: !widget.forced,
      title: context.tr('auth.change_password_title'),
      subtitle: context.tr(
        widget.forced
            ? 'auth.change_password_forced'
            : 'auth.change_password_subtitle',
      ),
      footer: widget.forced
          ? TextButton(
              onPressed: () => context.read<SessionCubit>().logout(),
              child: Text(context.tr('account.logout')),
            )
          : null,
      child: Form(
        key: _form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_error != null) ...[
              FormErrorBanner(message: _error!),
              const SizedBox(height: AppSpacing.lg),
            ],
            PasswordField(
              controller: _current,
              label: context.tr('auth.current_password'),
              validateLength: false,
            ),
            const SizedBox(height: AppSpacing.md),
            PasswordField(
              controller: _next,
              label: context.tr('auth.new_password'),
            ),
            const SizedBox(height: AppSpacing.md),
            PasswordField(
              controller: _confirm,
              label: context.tr('auth.confirm_password'),
              validateLength: false,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
              validator: (v) =>
                  v != _next.text ? context.tr('auth.password_mismatch') : null,
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: context.tr('auth.save_password'),
              loading: _loading,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}
