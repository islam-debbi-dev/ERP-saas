import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/logo/debvora_logo.dart';
import '../../../core/config/app_env.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/url_helper.dart';
import '../../../core/localization/tr.dart';
import '../../../core/session/session_cubit.dart';
import '../../../core/session/session_state.dart';

/// An authenticated user the app does not serve: an office role (owner,
/// manager → the web dashboard) or a tenant without the mobile module. The
/// session was already closed on the API.
class RefusedScreen extends StatelessWidget {
  const RefusedScreen({super.key, required this.refusal});

  final Refusal refusal;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final dashboard = AppEnv.dashboardUrl;
    final (title, message, icon) = switch (refusal) {
      Refusal.officeRole => (
        'refusal.office_title',
        'refusal.office_message',
        Icons.desktop_windows_outlined,
      ),
      Refusal.noMobileApp => (
        'refusal.no_mobile_title',
        'refusal.no_mobile_message',
        Icons.phonelink_lock_outlined,
      ),
    };
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: DebvoraBadge(size: 56)),
                  const SizedBox(height: AppSpacing.xl),
                  Icon(icon, size: 48, color: context.textMuted),
                  const SizedBox(height: AppSpacing.lg),
                  Text(
                    context.tr(title),
                    style: text.headlineSmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    context.tr(message),
                    style: text.bodyLarge?.copyWith(color: context.textMuted),
                    textAlign: TextAlign.center,
                  ),
                  if (refusal == Refusal.officeRole &&
                      dashboard.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.md),
                    // The URL itself, readable and LTR, for typing on a PC.
                    SelectableText(
                      dashboard,
                      textAlign: TextAlign.center,
                      textDirection: TextDirection.ltr,
                      style: text.bodyMedium,
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    AppButton(
                      label: context.tr('refusal.open_dashboard'),
                      icon: Icons.open_in_new,
                      onPressed: () => UrlHelper.launchUrl(context, dashboard),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.md),
                  AppButton(
                    label: context.tr('refusal.back_to_login'),
                    variant: AppButtonVariant.secondary,
                    onPressed: () => context.read<SessionCubit>().backToLogin(),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
