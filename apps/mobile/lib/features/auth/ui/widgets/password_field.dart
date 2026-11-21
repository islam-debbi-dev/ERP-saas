import 'package:flutter/material.dart';

import '../../../../core/localization/tr.dart';

/// Password input with a show/hide toggle. Enforces the backend minimum of
/// 6 characters unless [validateLength] is off (e.g. "current password").
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
            _obscure ? 'jb.auth.show_password' : 'jb.auth.hide_password',
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
        if (v.isEmpty) return context.tr('password_required');
        if (widget.validateLength && v.length < 6) {
          return context.tr('password_too_short');
        }
        return widget.validator?.call(v);
      },
    );
  }
}

/// Converts `05 55 12 34 56`, `00213…`, `213…` or `+213…` to the backend's
/// `+213XXXXXXXXX`; returns `null` when it is not an Algerian mobile number.
String? normalizeAlgerianPhone(String input) {
  var raw = input.trim().replaceAll(RegExp(r'[\s\-()._]'), '');
  raw = raw.replaceFirst(RegExp(r'^\+'), '');
  if (raw.startsWith('00213')) {
    raw = '+${raw.substring(2)}';
  } else if (raw.startsWith('213')) {
    raw = '+$raw';
  } else if (raw.startsWith('0')) {
    raw = '+213${raw.substring(1)}';
  }
  return RegExp(r'^\+213[5-7]\d{8}$').hasMatch(raw) ? raw : null;
}

/// Phone input validated with [normalizeAlgerianPhone].
class PhoneField extends StatelessWidget {
  const PhoneField({super.key, required this.controller, this.enabled = true});

  final TextEditingController controller;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      enabled: enabled,
      keyboardType: TextInputType.phone,
      textInputAction: TextInputAction.next,
      autofillHints: const [AutofillHints.telephoneNumber],
      // Numbers read left-to-right even in Arabic.
      textDirection: TextDirection.ltr,
      decoration: InputDecoration(
        labelText: context.tr('phone_number'),
        hintText: '05 XX XX XX XX',
        prefixIcon: const Icon(Icons.phone_outlined),
      ),
      validator: (v) {
        if ((v ?? '').trim().isEmpty) return context.tr('error_required_phone');
        return normalizeAlgerianPhone(v!) == null
            ? context.tr('error_invalid_phone')
            : null;
      },
    );
  }
}
