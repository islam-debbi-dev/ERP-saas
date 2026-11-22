import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/localization/tr.dart';
import '../../../../core/models/erp_codes.dart';
import '../../../../core/session/session_cubit.dart';
import '../../../sales/ui/sell_screen.dart';
import '../../data/models/client.dart';
import '../../logic/client_detail_cubit.dart';

/// The field actions on a client (sale, order, versement, visit), each shown
/// only with the user's right. [clientPath] is the client's own path; the
/// action screens are pushed under it so they keep the role's prefix. The
/// client is reloaded when one comes back with a document.
List<Widget> clientActions(
  BuildContext context,
  Client client,
  String clientPath, {
  void Function(Object doc)? onDocument,
}) {
  final user = context.watch<SessionCubit>().state.user;
  if (user == null) return const [];
  Future<void> open(String sub) async {
    final done = await context.push<Object?>(
      '$clientPath/$sub',
      extra: basketClientOf(client),
    );
    if (done != null && context.mounted) {
      onDocument?.call(done);
      await context.read<ClientDetailCubit>().load();
    }
  }

  return [
    if (user.can(Permission.salesCreate))
      FilledButton.icon(
        style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
        onPressed: () => open('sell'),
        icon: const Icon(Icons.point_of_sale_outlined),
        label: Text(context.tr('sale.action_sell')),
      ),
    if (user.canTakeOrders)
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
        onPressed: () => open('order'),
        icon: const Icon(Icons.receipt_long_outlined),
        label: Text(context.tr('sale.mode_order')),
      ),
    if (user.can(Permission.paymentsCreate))
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
        onPressed: () => open('versement'),
        icon: const Icon(Icons.payments_outlined),
        label: Text(context.tr('versement.action')),
      ),
  ];
}
