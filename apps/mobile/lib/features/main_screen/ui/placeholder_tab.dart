import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/role_screens.dart';
import '../../../core/session/session_cubit.dart';

/// A role tab whose screen comes in a later sub-phase (M1 vendeur, M2 livreur,
/// M3 superviseur, M3b magasinier). Shows the tab's name, the user and his
/// company so a login can be checked end to end.
class PlaceholderTab extends StatelessWidget {
  const PlaceholderTab({super.key, required this.tab});

  final RoleTab tab;

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr(tab.labelKey))),
      body: AppEmptyState(
        icon: tab.icon,
        title: context.tr(tab.labelKey),
        message: [
          context.tr('tabs.coming_soon'),
          if (user != null)
            '${user.fullName} · ${context.tr('roles.${user.role}')} · ${user.tenantName}',
        ].join('\n'),
      ),
    );
  }
}
