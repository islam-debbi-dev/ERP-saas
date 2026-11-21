import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/buttons/common_list_button.dart';
import '../../../core/components/widgets/buttons/theme_and_long.dart';
import '../../../core/config/app_env.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/helpers/url_helper.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../../core/service/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../../auth/ui/widgets/password_field.dart';
import '../data/repo/account_repository.dart';
import 'widgets/user_card_info.dart';

/// Tab 4 — profile card and settings, backed by the session user (`/me`).
/// Guests get a sign-in prompt plus the settings that work without login.
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  @override
  void initState() {
    super.initState();
    // Picks up changes made elsewhere (e.g. dashboard edits) on each visit.
    context.read<SessionCubit>().refreshUser();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionCubit>().state;
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: context.read<SessionCubit>().refreshUser,
        child: ListView(
          padding: EdgeInsets.only(
            top: MediaQuery.paddingOf(context).top + AppSpacing.lg,
            bottom: 130,
          ),
          children: [
            if (session.isAuthenticated)
              userCardInfo(
                user: session.user,
                onEditProfile: () => context.push(Routes.editProfile),
              )
            else
              const _GuestCard(),
            if (session.user?.isStoreManager ?? false) ...[
              SectionTitle(context.tr('jb.account.my_store')),
              _StoreCard(storeName: session.user?.storeName),
              _item(
                context,
                'jb.account.manage_store',
                Icons.storefront_outlined,
                () => UrlHelper.launchUrl(context, AppEnv.dashboardUrl),
              ),
            ],
            if (session.isAuthenticated) ...[
              SectionTitle(context.tr('jb.account.my_account')),
              _item(
                context,
                'jb.orders.title',
                Icons.receipt_long_outlined,
                () => context.push(Routes.orders),
              ),
              _item(
                context,
                'jb.address.title',
                Icons.place_outlined,
                () => context.push(Routes.addresses),
              ),
              _item(
                context,
                'jb.account.edit_profile',
                Icons.person_outline,
                () => context.push(Routes.editProfile),
              ),
              _item(
                context,
                'jb.account.change_password',
                Icons.lock_outline,
                () => context.push(Routes.changePassword),
              ),
            ],
            SectionTitle(context.tr('general_settings')),
            const ThemeAndLangWidget(),
            SectionTitle(context.tr('support_about')),
            _item(
              context,
              'help_center',
              Icons.help_outline,
              () => context.push(Routes.helpCenter),
            ),
            _item(
              context,
              'privacy_policy',
              Icons.privacy_tip_outlined,
              () => context.push(Routes.privacyPolicy),
            ),
            if (session.isAuthenticated) ...[
              SectionTitle(context.tr('account_actions')),
              CommonListButton.logout(
                label: context.tr('logout'),
                onPressed: () => _logout(context),
              ),
              // A manager's account is tied to a store: only the admin deletes
              // it (the API answers `ACCOUNT_DELETE_STAFF` anyway).
              if (session.user?.isStoreManager ?? false)
                Padding(
                  padding: const EdgeInsetsDirectional.fromSTEB(20, 8, 20, 0),
                  child: Text(
                    context.tr('jb.account.manager_delete_hint'),
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: context.textMuted),
                  ),
                )
              else
                CommonListButton(
                  label: context.tr('delete_account'),
                  leadingIcon: Icons.delete_forever_outlined,
                  normalColor: Theme.of(context).cardColor,
                  textColor: AppColors.error,
                  iconColor: AppColors.error,
                  onPressed: () => _deleteAccount(context),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _item(
    BuildContext context,
    String labelKey,
    IconData icon,
    VoidCallback onTap,
  ) {
    final color = context.textMain;
    return CommonListButton(
      label: context.tr(labelKey),
      leadingIcon: icon,
      trailingIcon: Icons.arrow_forward_ios,
      normalColor: Theme.of(context).cardColor,
      textColor: color,
      iconColor: color,
      onPressed: onTap,
    );
  }

  Future<void> _logout(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(dialog.tr('logout_confirmation')),
        content: Text(dialog.tr('are_you_sure_logout')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(dialog.tr('cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(dialog.tr('logout')),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await context.read<SessionCubit>().logout();
  }
}

/// Password-confirmed `DELETE /me` (Google Play account-deletion policy).
Future<void> _deleteAccount(BuildContext context) async {
  final deleted = await showDialog<bool>(
    context: context,
    builder: (_) => const _DeleteAccountDialog(),
  );
  if (deleted != true || !context.mounted) return;
  await context.read<SessionCubit>().signOutLocally();
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(context.tr('jb.account.account_deleted'))),
  );
}

class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog();

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await getIt<AccountRepository>().deleteAccount(
      password: _password.text,
    );
    if (!mounted) return;
    switch (result) {
      case Success():
        Navigator.pop(context, true);
      case Failure(:final message):
        setState(() {
          _busy = false;
          _error = apiErrorText(context, message);
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(context.tr('delete_account_confirmation')),
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('jb.account.delete_warning')),
            const SizedBox(height: AppSpacing.lg),
            PasswordField(
              controller: _password,
              label: context.tr('jb.account.delete_password'),
              validateLength: false,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
            ),
            if (_error != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(_error!, style: const TextStyle(color: AppColors.error)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context, false),
          child: Text(context.tr('cancel')),
        ),
        TextButton(
          onPressed: _busy ? null : _submit,
          style: TextButton.styleFrom(foregroundColor: AppColors.error),
          child: _busy
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(context.tr('delete_account')),
        ),
      ],
    );
  }
}

/// Store-manager only: the store they run, above the "Manage my store" tile.
class _StoreCard extends StatelessWidget {
  const _StoreCard({required this.storeName});

  /// `null` until `GET /me` answers (the account screen refreshes it on open).
  final String? storeName;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.xs,
      ),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: AppRadius.xlAll,
        ),
        child: Row(
          children: [
            Icon(Icons.store_mall_directory_outlined, color: context.textMain),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (storeName?.isNotEmpty ?? false) ? storeName! : '—',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: text.titleMedium,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    context.tr('jb.account.manage_store_hint'),
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GuestCard extends StatelessWidget {
  const _GuestCard();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: AppSpacing.screen,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.xl),
        decoration: BoxDecoration(
          color: context.isDarkMode ? AppColors.darkElevated : AppColors.accent,
          borderRadius: AppRadius.xlAll,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              context.tr('guest_mode_title'),
              style: text.headlineMedium?.copyWith(
                color: context.isDarkMode ? AppColors.white : AppColors.ink,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              context.tr('jb.account.guest_message'),
              style: text.bodyMedium?.copyWith(
                color: context.isDarkMode
                    ? AppColors.darkTextSecondary
                    : AppColors.ink,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: context.tr('sign_in_short'),
                    onPressed: () => context.push(Routes.login),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton(
                    label: context.tr('sign_up'),
                    variant: AppButtonVariant.secondary,
                    onPressed: () => context.push(Routes.register),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(
        start: 20,
        end: 16,
        top: 20,
        bottom: 12,
      ),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontSize: 20),
      ),
    );
  }
}
