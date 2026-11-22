import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/buttons/common_list_button.dart';
import '../../../core/components/widgets/buttons/theme_and_long.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../../core/session/session_cubit.dart';
import 'widgets/user_card.dart';

/// The signed-in user, settings (language, theme), password, help, privacy
/// and logout. Every role reaches it (M1 puts it under "Plus").
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  @override
  void initState() {
    super.initState();
    // Picks up rights changed on the web since the last visit.
    context.read<SessionCubit>().refreshUser();
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('account.title'))),
      body: RefreshIndicator(
        onRefresh: context.read<SessionCubit>().refreshUser,
        child: ListView(
          padding: const EdgeInsets.only(top: AppSpacing.md, bottom: 130),
          children: [
            if (user != null) UserCard(user: user),
            SectionTitle(context.tr('account.settings')),
            const ThemeAndLangWidget(),
            _item(
              context,
              'account.change_password',
              Icons.lock_outline,
              () => context.push(Routes.changePassword),
            ),
            SectionTitle(context.tr('account.support')),
            _item(
              context,
              'account.help',
              Icons.help_outline,
              () => context.push(Routes.helpCenter),
            ),
            _item(
              context,
              'account.privacy',
              Icons.privacy_tip_outlined,
              () => context.push(Routes.privacyPolicy),
            ),
            const SizedBox(height: AppSpacing.lg),
            CommonListButton.logout(
              label: context.tr('account.logout'),
              onPressed: () => _logout(context),
            ),
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
        title: Text(dialog.tr('account.logout_confirm_title')),
        content: Text(dialog.tr('account.logout_confirm_message')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(dialog.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(dialog.tr('account.logout')),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await context.read<SessionCubit>().logout();
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
