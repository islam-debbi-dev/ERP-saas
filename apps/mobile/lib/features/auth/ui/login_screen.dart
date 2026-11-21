import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/session/session_cubit.dart';
import 'widgets/auth_scaffold.dart';
import 'widgets/form_error_banner.dart';
import 'widgets/password_field.dart';

/// Email or phone + password. No sign-up: users are invited from the web.
/// On success the router sends the user to his role's home (or to the
/// password change / refusal screen, from the session state).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading || !_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    final error = await context.read<SessionCubit>().login(
      _identifier.text,
      _password.text,
    );
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error == null ? null : apiErrorText(context, error);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      showBack: false,
      title: context.tr('auth.login_title'),
      subtitle: context.tr('auth.login_subtitle'),
      footer: Text(
        context.tr('auth.invited_only'),
        textAlign: TextAlign.center,
        style: Theme.of(
          context,
        ).textTheme.bodySmall?.copyWith(color: context.textMuted),
      ),
      child: Form(
        key: _form,
        child: AutofillGroup(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_error != null) ...[
                FormErrorBanner(message: _error!),
                const SizedBox(height: AppSpacing.lg),
              ],
              TextFormField(
                controller: _identifier,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autocorrect: false,
                autofillHints: const [
                  AutofillHints.username,
                  AutofillHints.telephoneNumber,
                ],
                // Emails and phone numbers read left to right, even in Arabic.
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: context.tr('auth.identifier'),
                  hintText: context.tr('auth.identifier_hint'),
                  prefixIcon: const Icon(Icons.person_outline_rounded),
                ),
                validator: (v) => (v ?? '').trim().isEmpty
                    ? context.tr('auth.identifier_required')
                    : null,
              ),
              const SizedBox(height: AppSpacing.md),
              PasswordField(
                controller: _password,
                label: context.tr('auth.password'),
                validateLength: false,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: context.tr('auth.sign_in'),
                loading: _loading,
                onPressed: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
