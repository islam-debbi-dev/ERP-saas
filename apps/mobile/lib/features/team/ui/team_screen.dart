import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/day_bar.dart';
import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../data/team_models.dart';
import '../data/team_repository.dart';
import 'team_widgets.dart';
import '../../main_screen/ui/widgets/custom_bottom_navigation.dart';

/// "Équipe": the supervisor's team on one day (today by default, or an
/// earlier day to correct a clôture). Who is in it is the API's answer.
class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key, this.onOpenMember, this.clock});

  /// Opens a member's day; the list reloads when it comes back.
  final Future<Object?> Function(
    BuildContext context,
    SellerDay member,
    String date,
  )?
  onOpenMember;

  /// Tests pin "today".
  final DateTime Function()? clock;

  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  /// Days back from today: 0 = today. Never a future day.
  int _back = 0;

  DateTime _now() => (widget.clock ?? DateTime.now)();
  String get _date => AlgiersDay.minusDays(_back, _now());

  @override
  Widget build(BuildContext context) {
    final date = _date;
    return BlocProvider(
      key: ValueKey(date),
      create: (_) =>
          LoadCubit<List<SellerDay>>(() => getIt<TeamRepository>().day(date))
            ..load(),
      child: Scaffold(
        appBar: AppBar(title: Text(context.tr('team.title'))),
        body: Column(
          children: [
            DayBar(
              label: _back == 0
                  ? context.tr('team.today')
                  : AlgiersDay.display(date),
              onPrevious: () => setState(() => _back++),
              onNext: _back == 0 ? null : () => setState(() => _back--),
            ),
            Expanded(
              child: _TeamList(date: date, onOpenMember: widget.onOpenMember),
            ),
          ],
        ),
      ),
    );
  }
}

class _TeamList extends StatelessWidget {
  const _TeamList({required this.date, this.onOpenMember});

  final String date;
  final Future<Object?> Function(
    BuildContext context,
    SellerDay member,
    String date,
  )?
  onOpenMember;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<LoadCubit<List<SellerDay>>>();
    return BlocBuilder<LoadCubit<List<SellerDay>>, LoadState<List<SellerDay>>>(
      builder: (context, state) => LoadStateView<List<SellerDay>>(
        state: state,
        onRetry: cubit.load,
        skeleton: const ListSkeleton(),
        builder: (context, team) => RefreshIndicator(
          onRefresh: cubit.load,
          child: team.isEmpty
              ? ListView(
                  padding: const EdgeInsets.only(top: AppSpacing.xxl),
                  children: [
                    AppEmptyState(
                      icon: Icons.groups_outlined,
                      title: context.tr('team.empty_title'),
                      message: context.tr('team.empty_message'),
                    ),
                  ],
                )
              : ListView.separated(
                  padding: EdgeInsetsDirectional.fromSTEB(
                    AppSpacing.lg,
                    AppSpacing.xs,
                    AppSpacing.lg,
                    CustomBottomNavigation.listEnd(context),
                  ),
                  itemCount: team.length,
                  separatorBuilder: (_, _) => AppSpacing.gapSm,
                  itemBuilder: (context, i) => SellerDayCard(
                    day: team[i],
                    onTap: onOpenMember == null
                        ? null
                        : () async {
                            await onOpenMember!(context, team[i], date);
                            await cubit.load();
                          },
                  ),
                ),
        ),
      ),
    );
  }
}
