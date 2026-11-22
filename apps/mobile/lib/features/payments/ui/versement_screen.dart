import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/text_prompt.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/geo/geo_capture.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/network/money_action.dart';
import '../../auth/ui/widgets/form_error_banner.dart';
import '../../clients/data/models/client.dart';
import '../../clients/data/repo/clients_repository.dart';
import '../../sales/logic/basket.dart';
import '../data/repo/payments_repository.dart';
import '../logic/versement_cubit.dart';
import 'receipt_view.dart';

/// A versement from a client: amount, mode (espèces / chèque with number,
/// bank and due date / virement with its reference), optional allocation to
/// unpaid documents, GPS. Pops with the saved payment.
class VersementScreen extends StatelessWidget {
  const VersementScreen({super.key, required this.client});

  final BasketClient client;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => VersementCubit(
        getIt<PaymentsRepository>(),
        getIt<ClientsRepository>(),
        clientId: client.id,
      )..loadUnpaid(),
      child: _VersementView(client: client),
    );
  }
}

class _VersementView extends StatefulWidget {
  const _VersementView({required this.client});

  final BasketClient client;

  @override
  State<_VersementView> createState() => _VersementViewState();
}

class _VersementViewState extends State<_VersementView> {
  bool _locating = false;
  final _amount = TextEditingController();
  final Map<String, TextEditingController> _allocText = {};

  @override
  void dispose() {
    _amount.dispose();
    for (final c in _allocText.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final cubit = context.read<VersementCubit>();
    if (cubit.state.errors.isNotEmpty) {
      await cubit.submit(geo: null, runner: _runner);
      return;
    }
    setState(() => _locating = true);
    final geo = await captureGeo(context);
    if (!mounted) return;
    setState(() => _locating = false);
    await cubit.submit(geo: geo, runner: _runner);
  }

  MoneyActionRunner get _runner => MoneyActionRunner(
    askGeoNote: (error) => askText(
      context,
      title: context.tr('geo.note_title'),
      message: apiErrorText(context, error),
      label: context.tr('geo.note_label'),
      minLength: 3,
      confirmLabel: context.tr('geo.note_send'),
    ),
  );

  Future<void> _pickDueDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 30)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null && mounted) {
      context.read<VersementCubit>().setDueDate(
        AlgiersDay.of(DateTime.utc(picked.year, picked.month, picked.day, 12)),
      );
    }
  }

  void _toggleDoc(UnpaidDocument d, bool on) {
    final cubit = context.read<VersementCubit>();
    final form = cubit.state.form;
    final ctrl = _allocText.putIfAbsent(d.saleId, TextEditingController.new);
    if (!on) {
      ctrl.clear();
      cubit.allocate(d.saleId, null);
      return;
    }
    // Offer what is left of the amount, up to the document's remaining.
    final left = (form.amount ?? Decimal.zero) - form.allocated;
    var give = left < d.remaining ? left : d.remaining;
    if (give <= Decimal.zero) give = d.remaining;
    ctrl.text = Money.format(give, currency: false, isolate: false);
    cubit.allocate(d.saleId, give);
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<VersementCubit, VersementState>(
      builder: (context, state) {
        final payment = state.result;
        if (payment != null) {
          return ReceiptView(
            payment: payment,
            onDone: () => Navigator.of(context).pop(payment),
          );
        }
        final cubit = context.read<VersementCubit>();
        final form = state.form;
        final errors = state.showErrors ? state.errors : const <String>[];
        final text = Theme.of(context).textTheme;
        return Scaffold(
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(context.tr('versement.title')),
                Text(
                  widget.client.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
          bottomNavigationBar: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: AppButton(
                label: context.tr('versement.save'),
                icon: Icons.check_circle_outline,
                loading: _locating || state.submitting,
                onPressed: _submit,
              ),
            ),
          ),
          body: ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: [
              if (state.error != null) ...[
                FormErrorBanner(
                  message: [
                    apiErrorText(context, state.error!),
                    if (state.error!.isOffline)
                      context.tr('versement.retry_safe'),
                  ].join('\n'),
                ),
                AppSpacing.gapLg,
              ],
              if (widget.client.balance != null)
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        context.tr('clients.balance'),
                        style: text.bodyMedium?.copyWith(
                          color: context.textMuted,
                        ),
                      ),
                    ),
                    AmountText(
                      widget.client.balance!,
                      colorBySign: true,
                      style: text.titleMedium,
                    ),
                  ],
                ),
              AppSpacing.gapMd,
              TextField(
                controller: _amount,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                textDirection: TextDirection.ltr,
                style: text.headlineSmall,
                decoration: InputDecoration(
                  labelText: context.tr('versement.amount'),
                  suffixText: 'DA',
                  errorText: errors.contains('versement.error_amount')
                      ? context.tr('versement.error_amount')
                      : null,
                ),
                onChanged: (v) => cubit.setAmount(Money.parseInput(v)),
              ),
              AppSpacing.gapLg,
              SizedBox(
                width: double.infinity,
                child: SegmentedButton<PaymentModeValue>(
                  segments: [
                    for (final m in PaymentModeValue.values)
                      ButtonSegment(
                        value: m,
                        label: Text(context.tr('payment.mode_${m.api}')),
                      ),
                  ],
                  selected: {form.mode},
                  showSelectedIcon: false,
                  onSelectionChanged: (s) => cubit.setMode(s.first),
                ),
              ),
              if (form.mode != PaymentModeValue.especes) ...[
                AppSpacing.gapMd,
                TextField(
                  textDirection: TextDirection.ltr,
                  maxLength: 80,
                  decoration: InputDecoration(
                    labelText: context.tr(
                      form.mode == PaymentModeValue.cheque
                          ? 'versement.cheque_number'
                          : 'versement.transfer_reference',
                    ),
                    errorText: errors.contains('versement.error_cheque_number')
                        ? context.tr('versement.error_cheque_number')
                        : null,
                  ),
                  onChanged: cubit.setReference,
                ),
              ],
              if (form.mode == PaymentModeValue.cheque) ...[
                TextField(
                  maxLength: 80,
                  decoration: InputDecoration(
                    labelText: context.tr('versement.bank'),
                    errorText: errors.contains('versement.error_bank')
                        ? context.tr('versement.error_bank')
                        : null,
                  ),
                  onChanged: cubit.setBank,
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.event_outlined),
                  title: Text(context.tr('versement.due_date')),
                  subtitle: Text(
                    form.dueDate == null
                        ? context.tr('versement.pick_date')
                        : AlgiersDay.display(form.dueDate!),
                    style: errors.contains('versement.error_due_date')
                        ? const TextStyle(color: AppColors.error)
                        : null,
                  ),
                  onTap: _pickDueDate,
                ),
              ],
              AppSpacing.gapSm,
              TextField(
                maxLength: 255,
                decoration: InputDecoration(
                  labelText: context.tr('order.note'),
                ),
                onChanged: cubit.setNote,
              ),
              if (state.unpaid.isNotEmpty) ...[
                AppSpacing.gapLg,
                AppSectionHeader(title: context.tr('versement.allocate')),
                Text(
                  context.tr('versement.allocate_hint'),
                  style: text.bodySmall?.copyWith(color: context.textMuted),
                ),
                if (errors.contains('versement.error_allocation') ||
                    errors.contains('versement.error_allocated_sum'))
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.xs),
                    child: Text(
                      context.tr(
                        errors.contains('versement.error_allocated_sum')
                            ? 'versement.error_allocated_sum'
                            : 'versement.error_allocation',
                      ),
                      style: const TextStyle(color: AppColors.error),
                    ),
                  ),
                for (final d in state.unpaid)
                  _AllocationRow(
                    doc: d,
                    selected: form.allocations.containsKey(d.saleId),
                    controller: _allocText.putIfAbsent(
                      d.saleId,
                      TextEditingController.new,
                    ),
                    onToggle: (on) => _toggleDoc(d, on),
                    onAmount: (v) =>
                        cubit.allocate(d.saleId, Money.parseInput(v)),
                  ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _AllocationRow extends StatelessWidget {
  const _AllocationRow({
    required this.doc,
    required this.selected,
    required this.controller,
    required this.onToggle,
    required this.onAmount,
  });

  final UnpaidDocument doc;
  final bool selected;
  final TextEditingController controller;
  final ValueChanged<bool> onToggle;
  final ValueChanged<String> onAmount;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Column(
        children: [
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: selected,
            onChanged: (v) => onToggle(v ?? false),
            title: Text(
              doc.number ?? doc.type,
              textDirection: TextDirection.ltr,
              textAlign: TextAlign.start,
            ),
            subtitle: Text(AlgiersDay.display(doc.documentDate)),
            secondary: AmountText(doc.remaining, style: text.titleSmall),
          ),
          if (selected)
            Padding(
              padding: const EdgeInsetsDirectional.only(start: 56),
              child: TextField(
                controller: controller,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: context.tr('versement.allocated'),
                  suffixText: 'DA',
                ),
                onChanged: onAmount,
              ),
            ),
        ],
      ),
    );
  }
}
