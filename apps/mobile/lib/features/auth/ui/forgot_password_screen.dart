import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../../core/service/api_result.dart';
import '../data/repo/auth_repository.dart';
import 'widgets/auth_scaffold.dart';
import 'widgets/password_field.dart';

/// Two steps: request a 6-digit code (`/auth/forgot-password`), then set a
/// new password with it (`/auth/reset-password`).
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _repo = getIt<AuthRepository>();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  String get _normalizedPhone => normalizeAlgerianPhone(_phone.text)!;

  Future<void> _sendCode() async {
    // A resend only needs the (already checked, locked) phone; validating the
    // whole form would block it on the empty code and password fields.
    if (_busy || (!_codeSent && !_form.currentState!.validate())) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await _repo.forgotPassword(_normalizedPhone);
    if (!mounted) return;
    switch (result) {
      case Success(:final data):
        // Non-production backends return the code (no SMS gateway yet).
        if (kDebugMode && data != null) _code.text = data;
        if (_codeSent) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('jb.auth.code_resent'))),
          );
        }
        setState(() {
          _busy = false;
          _codeSent = true;
        });
      case Failure(:final message):
        setState(() {
          _busy = false;
          _error = apiErrorText(context, message);
        });
    }
  }

  Future<void> _reset() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await _repo.resetPassword(
      phone: _normalizedPhone,
      code: _code.text.trim(),
      newPassword: _password.text,
    );
    if (!mounted) return;
    switch (result) {
      case Success():
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('jb.auth.password_reset_done'))),
        );
        context.pushReplacement(Routes.login);
      case Failure(:final message):
        setState(() {
          _busy = false;
          _error = apiErrorText(context, message);
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: context.tr('jb.auth.forgot_title'),
      subtitle: context.tr(
        _codeSent ? 'jb.auth.code_sent_subtitle' : 'jb.auth.forgot_subtitle',
      ),
      child: Form(
        key: _form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            PhoneField(controller: _phone, enabled: !_codeSent),
            if (_codeSent) ...[
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                textDirection: TextDirection.ltr,
                autofillHints: const [AutofillHints.oneTimeCode],
                decoration: InputDecoration(
                  labelText: context.tr('jb.auth.reset_code'),
                  prefixIcon: const Icon(Icons.pin_outlined),
                ),
                validator: (v) => RegExp(r'^\d{6}$').hasMatch((v ?? '').trim())
                    ? null
                    : context.tr('jb.auth.code_invalid'),
              ),
              const SizedBox(height: AppSpacing.sm),
              PasswordField(
                controller: _password,
                label: context.tr('jb.auth.new_password'),
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _reset(),
              ),
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton(
                  onPressed: _busy ? null : _sendCode,
                  child: Text(context.tr('jb.auth.resend_code')),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            if (_error != null) ...[
              AuthErrorBox(message: _error!),
              const SizedBox(height: AppSpacing.md),
            ],
            AppButton(
              label: context.tr(
                _codeSent ? 'jb.auth.reset_password' : 'jb.auth.send_code',
              ),
              loading: _busy,
              onPressed: _codeSent ? _reset : _sendCode,
            ),
          ],
        ),
      ),
    );
  }
}
