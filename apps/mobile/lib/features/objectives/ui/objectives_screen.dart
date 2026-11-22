import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../data/objectives.dart';

/// "Objectifs" (INCENTIVES): this month's targets with their progress, as
/// the API computes them live.
class ObjectivesScreen extends StatelessWidget {
  const ObjectivesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          LoadCubit<MyObjectives>(getIt<ObjectivesRepository>().mine)..load(),
      child: Scaffold(
        appBar: AppBar(title: Text(context.tr('objectives.title'))),
        body: BlocBuilder<LoadCubit<MyObjectives>, LoadState<MyObjectives>>(
          builder: (context, state) => LoadStateView<MyObjectives>(
            state: state,
            onRetry: context.read<LoadCubit<MyObjectives>>().load,
            skeleton: const ListSkeleton(rows: 3, rowHeight: 120),
            builder: (context, data) => RefreshIndicator(
              onRefresh: context.read<LoadCubit<MyObjectives>>().load,
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                children: [
                  Text(
                    context.tr(
                      'objectives.header',
                      args: {'period': data.period, 'days': data.daysLeft},
                    ),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Text(
                    context.tr(
                      'objectives.updated',
                      args: {'time': AlgiersDay.time(data.loadedAt)},
                    ),
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: context.textMuted),
                  ),
                  AppSpacing.gapLg,
                  if (data.items.isEmpty)
                    AppEmptyState(
                      icon: Icons.flag_outlined,
                      title: context.tr('objectives.none'),
                    )
                  else
                    for (final o in data.items) ...[
                      ObjectiveCard(objective: o),
                      AppSpacing.gapMd,
                    ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ObjectiveCard extends StatelessWidget {
  const ObjectiveCard({super.key, required this.objective});

  final Objective objective;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final o = objective;
    final value = Objective.progress(o.pct);
    final done = value >= 1;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  [
                    context.tr('objectives.metric_${o.metric}'),
                    if (o.scopeLabel != null) o.scopeLabel!,
                  ].join(' · '),
                  style: text.titleSmall,
                ),
              ),
              if (o.team)
                Chip(
                  label: Text(context.tr('objectives.team')),
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
          AppSpacing.gapSm,
          if (o.achieved != null && o.target != null)
            Text(
              '${Objective.formatValue(o.metric, o.achieved!)} / ${Objective.formatValue(o.metric, o.target!)}',
              style: text.titleMedium,
            )
          else
            Text(
              context.tr('objectives.hidden'),
              style: text.bodyMedium?.copyWith(color: context.textMuted),
            ),
          AppSpacing.gapSm,
          ClipRRect(
            borderRadius: AppRadius.pillAll,
            child: LinearProgressIndicator(
              value: value,
              minHeight: 8,
              color: done ? AppColors.success : null,
              backgroundColor: context.fieldBorder,
              semanticsLabel: context.tr('objectives.metric_${o.metric}'),
            ),
          ),
          AppSpacing.gapXs,
          Row(
            children: [
              if (o.pct != null)
                Text(
                  Objective.formatValue('STRIKE_RATE', o.pct!),
                  style: text.labelLarge,
                ),
              const Spacer(),
              if (o.nextRemaining != null && !done)
                Flexible(
                  child: Text(
                    context.tr(
                      'objectives.remaining',
                      args: {
                        'value': Objective.formatValue(
                          o.metric,
                          o.nextRemaining!,
                        ),
                      },
                    ),
                    textAlign: TextAlign.end,
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
