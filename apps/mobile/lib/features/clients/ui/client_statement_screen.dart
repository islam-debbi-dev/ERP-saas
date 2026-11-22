import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/share/pdf_share.dart';
import '../data/models/client.dart';
import '../data/repo/clients_repository.dart';

/// Relevé de compte of the last 90 days, with "Partager PDF" (the API's
/// French PDF of the same range).
class ClientStatementScreen extends StatefulWidget {
  const ClientStatementScreen({super.key, required this.clientId});

  final String clientId;

  /// Days covered, ending today (Algiers).
  static const days = 90;

  @override
  State<ClientStatementScreen> createState() => _ClientStatementScreenState();
}

class _ClientStatementScreenState extends State<ClientStatementScreen> {
  late final String _to = AlgiersDay.of();
  late final String _from = AlgiersDay.minusDays(ClientStatementScreen.days);
  bool _sharing = false;

  Future<void> _share() async {
    setState(() => _sharing = true);
    await sharePdf(
      context,
      path: '/clients/${widget.clientId}/statement/pdf',
      query: {'from': _from, 'to': _to},
      fileName: pdfName('releve-$_to', 'releve'),
    );
    if (mounted) setState(() => _sharing = false);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return BlocProvider(
      create: (_) => LoadCubit<ClientStatement>(
        () => getIt<ClientsRepository>().statement(
          widget.clientId,
          from: _from,
          to: _to,
        ),
      )..load(),
      child: Scaffold(
        appBar: AppBar(
          title: Text(context.tr('clients.statement')),
          actions: [
            IconButton(
              tooltip: context.tr('common.share_pdf'),
              onPressed: _sharing ? null : _share,
              icon: _sharing
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.ios_share),
            ),
          ],
        ),
        body:
            BlocBuilder<LoadCubit<ClientStatement>, LoadState<ClientStatement>>(
              builder: (context, state) => LoadStateView<ClientStatement>(
                state: state,
                onRetry: context.read<LoadCubit<ClientStatement>>().load,
                skeleton: const ListSkeleton(),
                builder: (context, st) => ListView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  children: [
                    Text(
                      context.tr(
                        'clients.statement_range',
                        args: {
                          'from': AlgiersDay.display(st.from),
                          'to': AlgiersDay.display(st.to),
                        },
                      ),
                      style: text.bodyMedium?.copyWith(
                        color: context.textMuted,
                      ),
                    ),
                    AppSpacing.gapMd,
                    _line(
                      context,
                      'clients.opening_balance',
                      st.openingBalance,
                    ),
                    const Divider(),
                    if (st.entries.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: AppSpacing.lg,
                        ),
                        child: Text(context.tr('clients.no_entries')),
                      ),
                    for (final e in st.entries)
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: AppSpacing.sm,
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(e.label, style: text.titleSmall),
                                  Text(
                                    AlgiersDay.displayDateTime(e.createdAt),
                                    style: text.bodySmall?.copyWith(
                                      color: context.textMuted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                AmountText(e.amount, style: text.titleSmall),
                                AmountText(
                                  e.runningBalance,
                                  style: text.bodySmall?.copyWith(
                                    color: context.textMuted,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    const Divider(),
                    _line(context, 'clients.total_debit', st.totalDebit),
                    _line(context, 'clients.total_credit', st.totalCredit),
                    _line(
                      context,
                      'clients.closing_balance',
                      st.closingBalance,
                      bold: true,
                    ),
                    AppSpacing.gapXl,
                    AppButton(
                      label: context.tr('common.share_pdf'),
                      icon: Icons.picture_as_pdf_outlined,
                      loading: _sharing,
                      onPressed: _share,
                    ),
                  ],
                ),
              ),
            ),
      ),
    );
  }

  Widget _line(
    BuildContext context,
    String key,
    Decimal value, {
    bool bold = false,
  }) {
    final text = Theme.of(context).textTheme;
    final style = bold ? text.titleMedium : text.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        children: [
          Expanded(child: Text(context.tr(key), style: style)),
          AmountText(value, style: style),
        ],
      ),
    );
  }
}
