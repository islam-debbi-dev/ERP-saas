import 'package:flutter/material.dart';

import '../../../../core/localization/tr.dart';

/// Minimum length of a new password, as the API requires.
const minPasswordLength = 8;

/// Password input with a show/hide toggle. Enforces [minPasswordLength]
/// unless [validateLength] is off (login, "current password").
class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.label,
    this.validator,
    this.validateLength = true,
    this.textInputAction = TextInputAction.next,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String label;
  final FormFieldValidator<String>? validator;
  final bool validateLength;
  final TextInputAction textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _obscure = true;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: widget.controller,
      obscureText: _obscure,
      autocorrect: false,
      enableSuggestions: false,
      textInputAction: widget.textInputAction,
      onFieldSubmitted: widget.onSubmitted,
      autofillHints: const [AutofillHints.password],
      decoration: InputDecoration(
        labelText: widget.label,
        prefixIcon: const Icon(Icons.lock_outline_rounded),
        suffixIcon: IconButton(
          tooltip: context.tr(
            _obscure ? 'auth.show_password' : 'auth.hide_password',
          ),
          icon: Icon(
            _obscure
                ? Icons.visibility_outlined
                : Icons.visibility_off_outlined,
          ),
          onPressed: () => setState(() => _obscure = !_obscure),
        ),
      ),
      validator: (value) {
        final v = value ?? '';
        if (v.isEmpty) return context.tr('auth.password_required');
        // The API's minimum for a new password (passwordField in auth.ts).
        if (widget.validateLength && v.length < minPasswordLength) {
          return context.tr('auth.password_too_short');
        }
        return widget.validator?.call(v);
      },
    );
  }
}
