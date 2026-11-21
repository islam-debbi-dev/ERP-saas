import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../../core/service/api_result.dart';
import '../../../core/session/session_cubit.dart';
import '../data/models/address.dart';
import '../data/repo/account_repository.dart';

/// Saved addresses (`/me/addresses`), from the session user.
class AddressesScreen extends StatelessWidget {
  const AddressesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final addresses = context.select<SessionCubit, List<Address>>(
      (c) => c.state.user?.addresses ?? const [],
    );
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('jb.address.title'))),
      floatingActionButton: addresses.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: () => context.push(Routes.addressForm),
              icon: const Icon(Icons.add_rounded),
              label: Text(context.tr('jb.address.add')),
            ),
      body: addresses.isEmpty
          ? AppEmptyState(
              icon: Icons.place_outlined,
              title: context.tr('jb.address.empty_title'),
              message: context.tr('jb.address.empty_message'),
              actionLabel: context.tr('jb.address.add'),
              onAction: () => context.push(Routes.addressForm),
            )
          : RefreshIndicator(
              onRefresh: context.read<SessionCubit>().refreshUser,
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screenH,
                  AppSpacing.sm,
                  AppSpacing.screenH,
                  100,
                ),
                itemCount: addresses.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(height: AppSpacing.md),
                itemBuilder: (context, i) =>
                    _AddressTile(address: addresses[i]),
              ),
            ),
    );
  }
}

class _AddressTile extends StatelessWidget {
  const _AddressTile({required this.address});

  final Address address;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AppCard(
      onTap: () => context.push(Routes.addressForm, extra: address),
      child: Row(
        children: [
          Icon(
            address.isDefault ? Icons.home_rounded : Icons.place_outlined,
            color: address.isDefault ? AppColors.accentDeep : context.textMuted,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(address.label, style: text.titleSmall),
                    ),
                    if (address.isDefault) ...[
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        context.tr('jb.address.default'),
                        style: AppTextStyles.caption.copyWith(
                          color: AppColors.accentDeep,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  [
                    address.fullAddress,
                    if (address.city != null) address.city,
                  ].join(' · '),
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            onSelected: (action) => _onAction(context, action),
            itemBuilder: (menu) => [
              if (!address.isDefault)
                PopupMenuItem(
                  value: 'default',
                  child: Text(menu.tr('jb.address.make_default')),
                ),
              PopupMenuItem(value: 'edit', child: Text(menu.tr('edit'))),
              PopupMenuItem(value: 'delete', child: Text(menu.tr('delete'))),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _onAction(BuildContext context, String action) async {
    final repo = getIt<AccountRepository>();
    final session = context.read<SessionCubit>();
    final messenger = ScaffoldMessenger.of(context);
    switch (action) {
      case 'edit':
        context.push(Routes.addressForm, extra: address);
        return;
      case 'default':
        final result = await repo.updateAddress(
          Address(
            id: address.id,
            label: address.label,
            fullAddress: address.fullAddress,
            city: address.city,
            location: address.location,
            isDefault: true,
          ),
        );
        if (result case Failure(:final message)) {
          if (context.mounted) {
            messenger.showSnackBar(
              SnackBar(content: Text(apiErrorText(context, message))),
            );
          }
        }
      case 'delete':
        final ok = await showDialog<bool>(
          context: context,
          builder: (dialog) => AlertDialog(
            title: Text(dialog.tr('jb.address.delete_title')),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialog, false),
                child: Text(dialog.tr('cancel')),
              ),
              TextButton(
                onPressed: () => Navigator.pop(dialog, true),
                style: TextButton.styleFrom(foregroundColor: AppColors.error),
                child: Text(dialog.tr('delete')),
              ),
            ],
          ),
        );
        if (ok != true) return;
        final result = await repo.deleteAddress(address.id);
        if (result case Failure(:final message)) {
          if (context.mounted) {
            messenger.showSnackBar(
              SnackBar(content: Text(apiErrorText(context, message))),
            );
          }
        }
    }
    // Default flags move server-side; re-read the whole list.
    await session.refreshUser();
  }
}
