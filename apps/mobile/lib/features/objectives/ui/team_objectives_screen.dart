import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../data/objectives.dart';
import 'objectives_screen.dart' show ObjectiveCard;

/// The targets of one person (or of the supervisor's whole team).
class ObjectiveGroup {
  const ObjectiveGroup({required this.subjectName, required this.items});

  final String subjectName;
  final List<Objective> items;
}

/// Groups by subject, in the API's order (the supervisor's own targets
/// first, then his team's, then each member's).
List<ObjectiveGroup> groupBySubject(List<Objective> items) {
  final groups = <String, List<Objective>>{};
  final names = <String, String>{};
  for (final o in items) {
    final key = o.subjectId.isEmpty ? o.subjectName : o.subjectId;
    groups.putIfAbsent(key, () => []).add(o);
    names[key] = o.subjectName;
  }
  return [
    for (final e in groups.entries)
      ObjectiveGroup(subjectName: names[e.key]!, items: e.value),
  ];
}

/// "Objectifs de l'équipe" (INCENTIVES): this month's targets of the
/// supervisor and of each member, with live progress, read only. The data is
/// `GET /me/objectives`, which gives a supervisor his team's too; targets
/// are set by managers on the web.
class TeamObjectivesScreen extends StatelessWidget {
  const TeamObjectivesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          LoadCubit<MyObjectives>(getIt<ObjectivesRepository>().mine)..load(),
      child: Scaffold(
        appBar: AppBar(title: Text(context.tr('objectives.team_title'))),
        body: BlocBuilder<LoadCubit<MyObjectives>, LoadState<MyObjectives>>(
          builder: (context, state) {
            final cubit = context.read<LoadCubit<MyObjectives>>();
            return LoadStateView<MyObjectives>(
              state: state,
              onRetry: cubit.load,
              skeleton: const ListSkeleton(rows: 3, rowHeight: 120),
              builder: (context, data) {
                final text = Theme.of(context).textTheme;
                final groups = groupBySubject(data.items);
                return RefreshIndicator(
                  onRefresh: cubit.load,
                  child: ListView(
                    // Under the Plus tab: no bottom bar, only the safe area.
                    padding: EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      AppSpacing.lg,
                      AppSpacing.lg,
                      AppSpacing.xl + MediaQuery.paddingOf(context).bottom,
                    ),
                    children: [
                      Text(
                        context.tr(
                          'objectives.header',
                          args: {'period': data.period, 'days': data.daysLeft},
                        ),
                        style: text.titleMedium,
                      ),
                      Text(
                        context.tr(
                          'objectives.updated',
                          args: {'time': AlgiersDay.time(data.loadedAt)},
                        ),
                        style: text.bodySmall?.copyWith(
                          color: context.textMuted,
                        ),
                      ),
                      AppSpacing.gapLg,
                      if (groups.isEmpty)
                        AppEmptyState(
                          icon: Icons.flag_outlined,
                          title: context.tr('objectives.none'),
                        ),
                      for (final g in groups) ...[
                        AppSectionHeader(title: g.subjectName),
                        for (final o in g.items) ...[
                          ObjectiveCard(objective: o),
                          AppSpacing.gapMd,
                        ],
                        AppSpacing.gapSm,
                      ],
                    ],
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
