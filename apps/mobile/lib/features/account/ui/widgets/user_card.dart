import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/models/auth_user.dart';

/// Who is signed in: initials, name, role, company, phone / email.
class UserCard extends StatelessWidget {
  const UserCard({super.key, required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final contact = [
      user.phone,
      user.email,
    ].whereType<String>().where((s) => s.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: AppCard(
        shadow: true,
        child: Row(
          children: [
            CircleAvatar(
              radius: 28,
              backgroundColor: AppColors.primaryColor,
              foregroundColor: AppColors.onPrimary,
              child: Text(
                _initials(user.fullName),
                style: text.titleMedium?.copyWith(
                  color: AppColors.onPrimary,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user.fullName, style: text.titleMedium),
                  const SizedBox(height: 2),
                  Text(
                    '${context.tr('roles.${user.role}')} · ${user.tenantName}',
                    style: text.bodyMedium?.copyWith(color: context.textMuted),
                  ),
                  if (contact.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      contact,
                      textDirection: TextDirection.ltr,
                      style: text.bodySmall?.copyWith(color: context.textMuted),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    return parts.take(2).map((p) => p.characters.first.toUpperCase()).join();
  }
}
