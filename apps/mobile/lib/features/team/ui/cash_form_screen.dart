import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../sales/ui/sale_screen.dart' show MoneyErrorCard;
import '../data/team_models.dart';
import '../data/team_repository.dart';
import '../logic/team_cubits.dart';
import 'team_widgets.dart';

/// Close a member's day with the cash he handed (the écart is previewed,
/// then the server's is shown), or correct a closed day with a note and,
/// if it changed, a new count.
class CashFormScreen extends StatelessWidget {
  const CashFormScreen({super.key, required this.member, required this.mode});

  final SellerDay member;
  final CashFormMode mode;

  @override
  Widget build(BuildContext context) {
    final session = member.session!;
    return BlocProvider(
      create: (_) => CashFormCubit(
        getIt<TeamRepository>(),
        mode: mode,
        session: session,
        // Open: the live figure; closed: the one frozen at closing.
        expected: session.isOpen
            ? member.expected.total
            : session.expected.total,
      ),
      child: _CashFormView(member: member),
    );
  }
}

class _CashFormView extends StatefulWidget {
  const _CashFormView({required this.member});

  final SellerDay member;

  @override
  State<_CashFormView> createState() => _CashFormViewState();
}

class _CashFormViewState extends State<_CashFormView> {
  final _handed = TextEditingController();
  final _note = TextEditingController();

  @override
  void dispose() {
    _handed.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<bool> _confirm(CashFormCubit cubit) async {
    if (cubit.mode != CashFormMode.close) return true;
    final ecart = cubit.ecartPreview!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('team.confirm_close_title')),
        content: Text(
          context.tr(
            'team.confirm_close_body',
            args: {
              'expected': Money.format(cubit.expected),
              'handed': Money.format(cubit.state.handed!),
              'ecart': ecartLabel(context, ecart),
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.tr('team.close_day')),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _submit() async {
    final cubit = context.read<CashFormCubit>();
    if (!cubit.validate()) return;
    // A retry after a failure goes again without asking: same body, same key.
    if (cubit.state.error == null && !await _confirm(cubit)) return;
    if (!mounted) return;
    await cubit.submit();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<CashFormCubit, CashFormState>(
      builder: (context, state) {
        final cubit = context.read<CashFormCubit>();
        final text = Theme.of(context).textTheme;
        final close = cubit.mode == CashFormMode.close;
        final name = widget.member.seller.fullName;
        if (state.done) {
          return _ResultView(
            name: name,
            closed: state.closed,
            adjusted: state.adjusted,
          );
        }
        final errors = state.showErrors ? cubit.errors : const <String>[];
        final preview = cubit.ecartPreview;
        return Scaffold(
          appBar: AppBar(
            title: Text(
              context.tr(
                close ? 'team.close_title' : 'team.adjust_title',
                args: {'name': name},
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          bottomNavigationBar: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: AppButton(
                label: context.tr(close ? 'team.close_day' : 'team.adjust'),
                icon: Icons.check_circle_outline,
                loading: state.submitting,
                onPressed: _submit,
              ),
            ),
          ),
          body: ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: [
              if (state.error != null) ...[
                MoneyErrorCard(error: state.error!),
                AppSpacing.gapLg,
              ],
              AmountRow(
                label: context.tr('team.expected'),
                value: cubit.expected,
                style: text.titleSmall,
              ),
              if (!close && cubit.session.currentHanded != null)
                AmountRow(
                  label: context.tr('team.handed_before'),
                  value: cubit.session.currentHanded!,
                ),
              AppSpacing.gapMd,
              TextField(
                controller: _handed,
                autofocus: close,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                textDirection: TextDirection.ltr,
                style: text.headlineSmall,
                decoration: InputDecoration(
                  labelText: context.tr(
                    close ? 'team.handed_label' : 'team.new_count_label',
                  ),
                  suffixText: 'DA',
                  errorText: errors.contains('team.error_handed')
                      ? context.tr('team.error_handed')
                      : null,
                ),
                onChanged: (v) => cubit.setHanded(Money.parseInput(v)),
              ),
              if (preview != null) ...[
                AppSpacing.gapSm,
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        context.tr('team.preview'),
                        style: text.bodyMedium?.copyWith(
                          color: context.textMuted,
                        ),
                      ),
                    ),
                    AppSpacing.gapSm,
                    Flexible(
                      child: Text(
                        ecartLabel(context, preview),
                        textAlign: TextAlign.end,
                        style: text.titleSmall?.copyWith(
                          color: ecartColor(context, preview),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              AppSpacing.gapLg,
              TextField(
                controller: _note,
                maxLength: 255,
                minLines: 1,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: context.tr(
                    close ? 'team.note_label' : 'team.reason_label',
                  ),
                  errorText: errors.contains('team.error_note')
                      ? context.tr('team.error_note')
                      : null,
                ),
                onChanged: cubit.setNote,
              ),
              AppSpacing.gapSm,
              Text(
                context.tr('truck.cash_note'),
                style: AppTextStyles.caption.copyWith(color: context.textMuted),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// The day as the server saved it: its écart, and what is left on the truck.
class _ResultView extends StatelessWidget {
  const _ResultView({required this.name, this.closed, this.adjusted});

  final String name;
  final SessionCloseResult? closed;
  final SellerSession? adjusted;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final session = closed?.session ?? adjusted!;
    final ecart = session.currentEcart;
    final handed = session.currentHanded;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Text(
          context.tr(
            closed != null ? 'team.closed_title' : 'team.adjusted_title',
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: AppButton(
            label: context.tr('team.done'),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text(name, style: text.titleMedium),
          AppSpacing.gapMd,
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AmountRow(
                  label: context.tr('team.expected'),
                  value: session.expected.total,
                ),
                if (handed != null)
                  AmountRow(label: context.tr('team.handed'), value: handed),
                if (ecart != null) ...[
                  const Divider(),
                  Text(
                    context.tr('team.server_ecart'),
                    style: text.labelLarge?.copyWith(color: context.textMuted),
                  ),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: AlignmentDirectional.centerStart,
                    child: AmountText(
                      ecart,
                      style: text.headlineMedium?.copyWith(
                        color: ecartColor(context, ecart),
                      ),
                    ),
                  ),
                  Text(
                    ecartLabel(context, ecart),
                    style: text.bodyMedium?.copyWith(
                      color: ecartColor(context, ecart),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (closed != null) ...[
            AppSpacing.gapLg,
            AppSectionHeader(title: context.tr('team.truck_left')),
            if (closed!.truckStock.isEmpty)
              Text(
                context.tr('team.truck_left_none'),
                style: text.bodyMedium?.copyWith(color: context.textMuted),
              )
            else ...[
              for (final l in closed!.truckStock)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          l.designation,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodyMedium,
                        ),
                      ),
                      AppSpacing.gapSm,
                      Text(
                        Qty.withUnit(l.qtyBase, l.unitCode),
                        style: text.bodyMedium,
                      ),
                    ],
                  ),
                ),
              AppSpacing.gapSm,
              Text(
                context.tr('team.unload_hint'),
                style: AppTextStyles.caption.copyWith(color: context.textMuted),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
