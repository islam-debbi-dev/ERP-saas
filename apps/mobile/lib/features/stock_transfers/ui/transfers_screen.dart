import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/widgets/day_bar.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/api_result.dart';
import '../../../core/paging/load_cubit.dart';
import '../../team/data/team_models.dart';
import '../data/stock_transfers_repository.dart';
import 'transfer_widgets.dart';

/// "Chargements": the open drafts, then the chargements / déchargements
/// validated on a day (today by default, never a future day), for every
/// truck in reach or one of them. Opens a transfer at `[basePath]/<id>`.
class TransfersScreen extends StatefulWidget {
  const TransfersScreen({
    super.key,
    required this.basePath,
    this.truckId,
    this.isTabRoot = true,
    this.onNew,
    this.clock,
  });

  final String basePath;

  /// A field user's own truck: the list is kept to it and has no chips.
  final String? truckId;

  /// The tab's root page sits above the bottom bar; a pushed list does not.
  final bool isTabRoot;

  /// "Nouveau chargement" (null = the user may not create one).
  final VoidCallback? onNew;

  /// Tests pin "today".
  final DateTime Function()? clock;

  @override
  State<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends State<TransfersScreen> {
  final _repo = getIt<StockTransfersRepository>();
  int _back = 0;
  String? _truck;
  List<TruckOption> _trucks = const [];

  DateTime _now() => (widget.clock ?? DateTime.now)();
  String get _date => AlgiersDay.minusDays(_back, _now());
  String? get _filter => widget.truckId ?? _truck;

  @override
  void initState() {
    super.initState();
    if (widget.truckId == null) {
      _repo.trucks().then((r) {
        if (mounted && r is Success<List<TruckOption>>) {
          setState(() => _trucks = r.data);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final date = _date;
    final filter = _filter;
    return BlocProvider(
      key: ValueKey('$date/$filter'),
      create: (_) =>
          LoadCubit<TransfersDay>(() => _repo.day(date, warehouseId: filter))
            ..load(),
      child: Scaffold(
        appBar: AppBar(title: Text(context.tr('transfer.title'))),
        body: Column(
          children: [
            DayBar(
              label: _back == 0
                  ? context.tr('team.today')
                  : AlgiersDay.display(date),
              onPrevious: () => setState(() => _back++),
              onNext: _back == 0 ? null : () => setState(() => _back--),
            ),
            if (widget.truckId == null && _trucks.isNotEmpty)
              SizedBox(
                height: AppSpacing.minTouch,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                  ),
                  children: [
                    _chip(context.tr('transfer.all_trucks'), null),
                    for (final t in _trucks) _chip(t.label, t.id, ltr: true),
                  ],
                ),
              ),
            Expanded(
              child: _List(
                basePath: widget.basePath,
                bottomPadding:
                    (widget.isTabRoot
                        ? AppSpacing.navClearance
                        : AppSpacing.xl) +
                    (widget.onNew == null ? 0 : 56),
              ),
            ),
          ],
        ),
        floatingActionButton: widget.onNew == null
            ? null
            : Padding(
                padding: EdgeInsets.only(bottom: widget.isTabRoot ? 88 : 0),
                child: FloatingActionButton.extended(
                  heroTag: 'new-load',
                  onPressed: widget.onNew,
                  icon: const Icon(Icons.add),
                  label: Text(context.tr('transfer.new_load')),
                ),
              ),
      ),
    );
  }

  Widget _chip(String label, String? id, {bool ltr = false}) => Padding(
    padding: const EdgeInsetsDirectional.only(end: AppSpacing.sm),
    child: Center(
      child: ChoiceChip(
        label: Text(
          label,
          textDirection: ltr ? TextDirection.ltr : null,
          maxLines: 1,
        ),
        selected: _truck == id,
        onSelected: (_) => setState(() => _truck = id),
      ),
    ),
  );
}

class _List extends StatelessWidget {
  const _List({required this.basePath, required this.bottomPadding});

  final String basePath;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<LoadCubit<TransfersDay>>();
    return BlocBuilder<LoadCubit<TransfersDay>, LoadState<TransfersDay>>(
      builder: (context, state) => LoadStateView<TransfersDay>(
        state: state,
        onRetry: cubit.load,
        skeleton: const ListSkeleton(),
        builder: (context, day) {
          Future<void> open(String id) async {
            await context.push('$basePath/$id');
            await cubit.load();
          }

          return RefreshIndicator(
            onRefresh: cubit.load,
            child: day.isEmpty
                ? ListView(
                    padding: EdgeInsets.only(bottom: bottomPadding),
                    children: [
                      AppEmptyState(
                        icon: Icons.move_to_inbox_outlined,
                        title: context.tr('transfer.empty'),
                      ),
                    ],
                  )
                : ListView(
                    padding: EdgeInsetsDirectional.fromSTEB(
                      AppSpacing.lg,
                      AppSpacing.sm,
                      AppSpacing.lg,
                      bottomPadding,
                    ),
                    children: [
                      if (day.drafts.isNotEmpty) ...[
                        _Section(context.tr('transfer.drafts')),
                        for (final t in day.drafts)
                          Padding(
                            padding: const EdgeInsets.only(
                              bottom: AppSpacing.sm,
                            ),
                            child: TransferTile(
                              transfer: t,
                              onTap: () => open(t.id),
                            ),
                          ),
                      ],
                      _Section(context.tr('transfer.done')),
                      if (day.done.isEmpty)
                        Text(
                          context.tr('truck.no_transfers'),
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(color: context.textMuted),
                        ),
                      for (final t in day.done)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: TransferTile(
                            transfer: t,
                            onTap: () => open(t.id),
                          ),
                        ),
                    ],
                  ),
          );
        },
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: AppSpacing.sm),
    child: Text(
      title,
      style: Theme.of(
        context,
      ).textTheme.titleSmall?.copyWith(color: context.textMuted),
    ),
  );
}
