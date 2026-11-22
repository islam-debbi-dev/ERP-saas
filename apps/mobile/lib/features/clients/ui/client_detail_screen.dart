import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/components/widgets/text_prompt.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/geo/geo_capture.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/phone_links.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../../orders/data/models/order.dart';
import '../../payments/data/models/payment.dart';
import '../../sales/data/models/sale.dart';
import '../../visits/logic/visit_form.dart';
import '../../visits/ui/visit_sheet.dart';
import '../data/models/client.dart';
import '../data/repo/clients_repository.dart';
import '../logic/client_detail_cubit.dart';
import 'widgets/client_actions.dart';

/// A client: balance and plafond, call / WhatsApp, the field actions (sale,
/// order, versement, visit), unpaid documents, last sales, statement, and
/// the GPS point. [basePath] is the client's own path (`/seller/clients/:id`).
class ClientDetailScreen extends StatefulWidget {
  const ClientDetailScreen({
    super.key,
    required this.clientId,
    required this.basePath,
    this.visit,
  });

  final String clientId;
  final String basePath;

  /// Opened from a stop of today's route (route, start, today's documents);
  /// otherwise the visit starts when the screen opens.
  final VisitStart? visit;

  @override
  State<ClientDetailScreen> createState() => _ClientDetailScreenState();
}

class _ClientDetailScreenState extends State<ClientDetailScreen> {
  late final VisitStart _start =
      widget.visit ?? VisitStart(startedAt: DateTime.now());
  late VisitDocs _docs = _start.docs;

  String get clientId => widget.clientId;
  String get basePath => widget.basePath;

  /// A sale, order or versement made from this screen: the visit links it.
  void _onDocument(Object doc) {
    setState(() {
      _docs = switch (doc) {
        SaleResult(:final sale) => _docs.merge(saleId: sale.id),
        Order(:final id) => _docs.merge(orderId: id),
        Payment(:final id) => _docs.merge(paymentId: id),
        _ => _docs,
      };
    });
  }

  Future<void> _endVisit() async {
    final messenger = ScaffoldMessenger.of(context);
    final saved = await showVisitSheet(
      context,
      clientId: clientId,
      start: _start,
      docs: _docs,
    );
    if (saved == null || !mounted) return;
    messenger.showSnackBar(SnackBar(content: Text(context.tr('visit.saved'))));
    if (Navigator.of(context).canPop()) Navigator.of(context).pop(saved);
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          ClientDetailCubit(getIt<ClientsRepository>(), clientId)..load(),
      child: BlocBuilder<ClientDetailCubit, LoadState<ClientDetail>>(
        builder: (context, state) => Scaffold(
          appBar: AppBar(
            title: Text(
              state.data?.client.name ?? context.tr('clients.client'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          body: LoadStateView<ClientDetail>(
            state: state,
            onRetry: context.read<ClientDetailCubit>().load,
            skeleton: const ListSkeleton(rows: 4, rowHeight: 96),
            builder: (context, detail) => RefreshIndicator(
              onRefresh: context.read<ClientDetailCubit>().load,
              child: _DetailBody(
                detail: detail,
                basePath: basePath,
                onDocument: _onDocument,
                onEndVisit: _endVisit,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({
    required this.detail,
    required this.basePath,
    required this.onDocument,
    required this.onEndVisit,
  });

  final ClientDetail detail;
  final String basePath;
  final void Function(Object doc) onDocument;
  final VoidCallback onEndVisit;

  @override
  Widget build(BuildContext context) {
    final client = detail.client;
    final text = Theme.of(context).textTheme;
    final user = context.watch<SessionCubit>().state.user;
    final hasGeo = user?.hasFeature(Feature.geoCheck) ?? false;
    final actions = clientActions(
      context,
      client,
      basePath,
      onDocument: onDocument,
    );
    final canVisit = user?.hasFeature(Feature.tournees) ?? false;
    // A screen under a tab: no bottom bar to clear, only the safe area.
    return ListView(
      padding: EdgeInsetsDirectional.fromSTEB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xl + MediaQuery.paddingOf(context).bottom,
      ),
      children: [
        _BalanceCard(client: client),
        AppSpacing.gapMd,
        _ContactRow(client: client, showLocation: hasGeo),
        if (actions.isNotEmpty) ...[
          AppSpacing.gapLg,
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: actions,
          ),
        ],
        if (canVisit) ...[
          AppSpacing.gapMd,
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(AppSpacing.minTouch),
            ),
            onPressed: onEndVisit,
            icon: const Icon(Icons.flag_outlined),
            label: Text(context.tr('visit.end')),
          ),
        ],
        AppSpacing.gapXl,
        AppSectionHeader(
          title: context.tr('clients.unpaid'),
          actionLabel: context.tr('clients.statement'),
          onAction: () => context.push('$basePath/statement'),
        ),
        AppSpacing.gapSm,
        if (detail.unpaid.isEmpty)
          Text(
            context.tr('clients.no_unpaid'),
            style: text.bodyMedium?.copyWith(color: context.textMuted),
          )
        else
          for (final d in detail.unpaid) ...[
            _DocRow(
              title: d.number ?? d.type,
              subtitle: AlgiersDay.display(d.documentDate),
              amount: AmountText(
                d.remaining,
                style: text.titleSmall?.copyWith(color: AppColors.error),
              ),
            ),
            AppSpacing.gapXs,
          ],
        AppSpacing.gapXl,
        AppSectionHeader(title: context.tr('clients.last_sales')),
        AppSpacing.gapSm,
        if (detail.lastSales.isEmpty)
          Text(
            context.tr('clients.no_sales'),
            style: text.bodyMedium?.copyWith(color: context.textMuted),
          )
        else
          for (final s in detail.lastSales) ...[
            _DocRow(
              title: s.number ?? s.type,
              subtitle: AlgiersDay.display(s.documentDate),
              amount: AmountText(s.totalTtc, style: text.titleSmall),
            ),
            AppSpacing.gapXs,
          ],
      ],
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.client});

  final Client client;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final limit = client.creditLimit;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            [
              client.code,
              if (client.commune != null) client.commune!,
            ].join(' · '),
            style: text.bodySmall?.copyWith(color: context.textMuted),
          ),
          AppSpacing.gapSm,
          Text(
            context.tr('clients.balance'),
            style: text.labelLarge?.copyWith(color: context.textMuted),
          ),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: AmountText(
              client.balance,
              colorBySign: true,
              style: text.headlineMedium,
            ),
          ),
          AppSpacing.gapSm,
          Row(
            children: [
              Expanded(
                child: Text(
                  context.tr('clients.credit_limit'),
                  style: text.bodyMedium?.copyWith(color: context.textMuted),
                ),
              ),
              if (limit == null)
                Text(context.tr('clients.no_limit'), style: text.bodyMedium)
              else
                AmountText(limit, style: text.bodyMedium),
            ],
          ),
          if (client.creditLeft != null)
            Row(
              children: [
                Expanded(
                  child: Text(
                    context.tr('clients.credit_left'),
                    style: text.bodyMedium?.copyWith(color: context.textMuted),
                  ),
                ),
                AmountText(client.creditLeft!, style: text.bodyMedium),
              ],
            ),
          if (client.overLimit) ...[
            AppSpacing.gapSm,
            Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: AppColors.error),
                AppSpacing.gapXs,
                Expanded(
                  child: Text(
                    context.tr('clients.over_limit'),
                    style: text.bodyMedium?.copyWith(color: AppColors.error),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ContactRow extends StatefulWidget {
  const _ContactRow({required this.client, required this.showLocation});

  final Client client;
  final bool showLocation;

  @override
  State<_ContactRow> createState() => _ContactRowState();
}

class _ContactRowState extends State<_ContactRow> {
  bool _saving = false;

  /// Saves the point where the user stands; a point set by someone else
  /// needs a supervisor's approval: then it becomes a change request.
  Future<void> _setLocation() async {
    final messenger = ScaffoldMessenger.of(context);
    final repo = getIt<ClientsRepository>();
    setState(() => _saving = true);
    final fix = await captureGeo(context);
    if (!mounted) return;
    if (fix == null) {
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(context.tr('geo.no_fix'))));
      return;
    }
    final result = await repo.setLocation(widget.client.id, fix);
    if (!mounted) return;
    switch (result) {
      case Success():
        messenger.showSnackBar(
          SnackBar(content: Text(context.tr('clients.location_saved'))),
        );
        await context.read<ClientDetailCubit>().load();
      case Failure(:final error) when error.code == 'GEO_CHANGE_NEEDS_APPROVAL':
        final note = await askText(
          context,
          title: context.tr('clients.location_request_title'),
          message: context.tr('clients.location_request_message'),
          label: context.tr('clients.location_request_note'),
          minLength: 0,
          confirmLabel: context.tr('clients.location_request_send'),
        );
        if (note == null || !mounted) break;
        final sent = await repo.requestLocation(
          widget.client.id,
          fix,
          note: note,
        );
        if (!mounted) break;
        messenger.showSnackBar(
          SnackBar(
            content: Text(switch (sent) {
              Success() => context.tr('clients.location_request_sent'),
              Failure(:final error) => apiErrorText(context, error),
            }),
          ),
        );
      case Failure(:final error):
        messenger.showSnackBar(
          SnackBar(content: Text(apiErrorText(context, error))),
        );
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final phone = widget.client.phone;
    final hasPhone = phone != null && phone.trim().isNotEmpty;
    final hasPoint = widget.client.location != null;
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        if (hasPhone) ...[
          _Pill(
            icon: Icons.call_outlined,
            label: context.tr('clients.call'),
            onTap: () => PhoneLinks.call(context, phone),
          ),
          if (PhoneLinks.whatsappNumber(phone) != null)
            _Pill(
              icon: Icons.chat_outlined,
              label: context.tr('clients.whatsapp'),
              onTap: () => PhoneLinks.whatsapp(context, phone),
            ),
        ],
        if (widget.showLocation)
          _Pill(
            icon: hasPoint
                ? Icons.edit_location_alt_outlined
                : Icons.add_location_alt_outlined,
            label: context.tr(
              _saving
                  ? 'geo.locating'
                  : hasPoint
                  ? 'clients.update_location'
                  : 'clients.set_location',
            ),
            onTap: _saving ? null : _setLocation,
          ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.icon, required this.label, this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    style: OutlinedButton.styleFrom(
      minimumSize: const Size(0, AppSpacing.minTouch),
    ),
    onPressed: onTap,
    icon: Icon(icon, size: 20),
    label: Text(label),
  );
}

class _DocRow extends StatelessWidget {
  const _DocRow({
    required this.title,
    required this.subtitle,
    required this.amount,
  });

  final String title;
  final String subtitle;
  final Widget amount;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AppCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  textDirection: TextDirection.ltr,
                  style: text.titleSmall,
                ),
                Text(
                  subtitle,
                  style: text.bodySmall?.copyWith(color: context.textMuted),
                ),
              ],
            ),
          ),
          amount,
        ],
      ),
    );
  }
}
