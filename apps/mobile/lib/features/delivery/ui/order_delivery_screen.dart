import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/amount_text.dart';
import '../../../core/components/widgets/load_state_view.dart';
import '../../../core/components/widgets/text_prompt.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/geo/geo_capture.dart';
import '../../../core/helpers/algiers_day.dart';
import '../../../core/helpers/money.dart';
import '../../../core/helpers/phone_links.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/erp_codes.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/network/money_action.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/session/session_cubit.dart';
import '../../../core/share/pdf_share.dart';
import '../../orders/data/models/order.dart';
import '../../orders/data/repo/orders_repository.dart';
import '../../sales/data/models/pricing.dart';
import '../../sales/data/repo/sales_repository.dart';
import '../../sales/logic/basket.dart';
import '../../sales/ui/sale_result_view.dart';
import '../../sales/ui/sale_screen.dart' show MoneyErrorCard;
import '../../sales/ui/widgets/basket_summary.dart';
import '../../sales/ui/widgets/doc_status_chip.dart';
import '../../sales/ui/widgets/qty_stepper.dart';
import '../logic/delivery_cubit.dart';
import '../logic/delivery_form.dart';

/// Livrer une commande: the delivered quantity per line (the ordered one by
/// default, 0 allowed), the truck's stock per line, packaging returned, what
/// the client pays now, GPS, then `POST /orders/:id/deliver`. The BL comes
/// from the truck the order was put on. Pops with `true` once delivered.
class OrderDeliveryScreen extends StatelessWidget {
  const OrderDeliveryScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context) => BlocProvider(
    create: (_) => DeliveryCubit(
      getIt<OrdersRepository>(),
      getIt<SalesRepository>(),
      orderId: orderId,
    )..load(),
    child: const _DeliveryView(),
  );
}

class _DeliveryView extends StatefulWidget {
  const _DeliveryView();

  @override
  State<_DeliveryView> createState() => _DeliveryViewState();
}

class _DeliveryViewState extends State<_DeliveryView> {
  final _paidText = TextEditingController();
  List<PackagingType> _packagingTypes = const [];
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    final user = context.read<SessionCubit>().state.user;
    if (user?.hasFeature(Feature.packaging) ?? false) {
      getIt<SalesRepository>().packagingTypes().then((r) {
        if (mounted && r is Success<List<PackagingType>>) {
          setState(() => _packagingTypes = r.data);
        }
      });
    }
  }

  @override
  void dispose() {
    _paidText.dispose();
    super.dispose();
  }

  void _setPaidText(Decimal? v) {
    _paidText.text = v == null
        ? ''
        : Money.format(v, currency: false, isolate: false);
    setState(() {});
  }

  Future<bool> _confirm(DeliveryState state) async {
    final form = state.form!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('delivery.confirm_title')),
        content: Text(
          context.tr(
            'delivery.confirm_body',
            args: {
              'lines': form.deliveredLineCount,
              'total': Money.format(form.totals.totalTtc),
              'paid': Money.format(state.paidOrZero),
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
            child: Text(context.tr('delivery.validate')),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _submit() async {
    final cubit = context.read<DeliveryCubit>();
    if (!cubit.state.canSubmit || !await _confirm(cubit.state)) return;
    if (!mounted) return;
    setState(() => _locating = true);
    final geo = await captureGeo(context);
    if (!mounted) return;
    setState(() => _locating = false);
    await cubit.submit(
      geo: geo,
      runner: MoneyActionRunner(askGeoNote: _askGeoNote),
    );
  }

  Future<String?> _askGeoNote(ApiError error) => askText(
    context,
    title: context.tr('geo.note_title'),
    message: apiErrorText(context, error),
    label: context.tr('geo.note_label'),
    minLength: 3,
    confirmLabel: context.tr('geo.note_send'),
  );

  Future<void> _typeQty(OrderLine line) async {
    final cubit = context.read<DeliveryCubit>();
    final typed = await askText(
      context,
      title: line.designation,
      label: context.tr(
        'delivery.qty_label',
        args: {'max': Qty.withUnit(line.qty, line.unitCode)},
      ),
      maxLength: 12,
    );
    if (typed == null) return;
    final v = Money.parseInput(typed);
    if (v != null) cubit.setQty(line, v);
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<DeliveryCubit, DeliveryState>(
      builder: (context, state) {
        final delivered = state.delivered;
        if (delivered != null) {
          final bl = state.bl;
          void done() => Navigator.of(context).pop(true);
          return bl != null
              ? SaleResultView(
                  result: bl,
                  title: context.tr('delivery.saved_title'),
                  onDone: done,
                )
              : DeliveredFallback(
                  number: delivered.saleNumber,
                  saleId: delivered.saleId,
                  totalTtc: delivered.saleTotalTtc,
                  onDone: done,
                );
        }
        final order = state.order;
        return Scaffold(
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(context.tr('delivery.deliver')),
                if (order != null)
                  Text(
                    order.client.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
          bottomNavigationBar: order == null || !order.isConfirmed
              ? null
              : _DeliverBar(
                  totalTtc: state.form!.totals.totalTtc,
                  busy: _locating || state.submitting,
                  onSubmit: state.canSubmit ? _submit : null,
                ),
          body: order == null
              ? LoadStateView<Order>(
                  state: LoadState<Order>(
                    loading: state.loading,
                    error: state.loadError,
                  ),
                  onRetry: context.read<DeliveryCubit>().load,
                  builder: (_, _) => const SizedBox.shrink(),
                )
              : _form(context, state),
        );
      },
    );
  }

  Widget _form(BuildContext context, DeliveryState state) {
    final cubit = context.read<DeliveryCubit>();
    final form = state.form!;
    final order = form.order;
    final totals = form.totals;
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        if (state.error != null) ...[
          MoneyErrorCard(
            error: state.error!,
            stockShort: (productId, available) {
              final match = order.lines.where((l) => l.productId == productId);
              if (match.isEmpty) return null;
              final l = match.first;
              return (
                l.designation,
                Qty.withUnit(
                  UnitConversion.fromBase(available, l.factorToBase),
                  l.unitCode,
                ),
              );
            },
          ),
          AppSpacing.gapLg,
        ],
        OrderHeaderCard(order: order),
        if (!order.isConfirmed) ...[
          AppSpacing.gapLg,
          AppCard(
            child: Text(
              context.tr(
                'delivery.not_deliverable',
                args: {'status': context.tr('status.${order.status}')},
              ),
            ),
          ),
        ] else ...[
          AppSpacing.gapXl,
          AppSectionHeader(
            title: context.tr('delivery.lines'),
            actionLabel: form.isPartial ? context.tr('delivery.all') : null,
            onAction: form.isPartial
                ? () {
                    for (final l in form.paidLines) {
                      cubit.deliverAll(l);
                    }
                  }
                : null,
          ),
          AppSpacing.gapSm,
          for (final l in form.paidLines) ...[
            DeliveryLineTile(
              form: form,
              line: l,
              onIncrement: () => cubit.increment(l),
              onDecrement: () => cubit.decrement(l),
              onType: () => _typeQty(l),
              onNone: () => cubit.deliverNone(l),
              onAll: () => cubit.deliverAll(l),
            ),
            AppSpacing.gapSm,
          ],
          if (!form.anyDelivered)
            Text(
              context.tr('delivery.nothing'),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (_packagingTypes.isNotEmpty) ...[
            AppSpacing.gapXl,
            AppSectionHeader(title: context.tr('sale.packaging_returned')),
            for (final t in _packagingTypes)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                child: Row(
                  children: [
                    Expanded(child: Text(t.name)),
                    QtyStepper(
                      label: '${state.packaging[t.id] ?? 0}',
                      onDecrement: () => cubit.setPackaging(
                        t.id,
                        (state.packaging[t.id] ?? 0) - 1,
                      ),
                      onIncrement: () => cubit.setPackaging(
                        t.id,
                        (state.packaging[t.id] ?? 0) + 1,
                      ),
                    ),
                  ],
                ),
              ),
          ],
          AppSpacing.gapXl,
          AppSectionHeader(title: context.tr('delivery.collected')),
          AppSpacing.gapSm,
          TextField(
            controller: _paidText,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(
              labelText: context.tr('sale.paid_now'),
              suffixText: 'DA',
              errorText:
                  _paidText.text.isNotEmpty &&
                      Money.parseInput(_paidText.text) == null
                  ? context.tr('sale.invalid_amount')
                  : null,
            ),
            onChanged: (v) {
              cubit.setPaid(v.trim().isEmpty ? null : Money.parseInput(v));
              setState(() {});
            },
          ),
          AppSpacing.gapSm,
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              ActionChip(
                avatar: const Icon(Icons.done_all, size: 18),
                label: Text(context.tr('sale.pay_all')),
                onPressed: () {
                  cubit.payAll();
                  _setPaidText(totals.totalTtc);
                },
              ),
              ActionChip(
                avatar: const Icon(Icons.schedule, size: 18),
                label: Text(context.tr('sale.all_credit')),
                onPressed: () {
                  cubit.setPaid(Decimal.zero);
                  _setPaidText(Decimal.zero);
                },
              ),
            ],
          ),
          AppSpacing.gapMd,
          SegmentedButton<PaymentModeValue>(
            segments: [
              for (final m in PaymentModeValue.values)
                ButtonSegment(
                  value: m,
                  label: Text(context.tr('payment.mode_${m.api}')),
                ),
            ],
            selected: {state.mode},
            showSelectedIcon: false,
            onSelectionChanged: (s) => cubit.setMode(s.first),
          ),
          AppSpacing.gapXl,
          BasketSummary(
            totalHt: totals.totalHt,
            totalTva: totals.totalTva,
            totalTtc: totals.totalTtc,
            paid: state.paidOrZero,
            credit: state.credit,
          ),
        ],
      ],
    );
  }
}

/// Order number, client, requested date, truck, and call / WhatsApp.
class OrderHeaderCard extends StatelessWidget {
  const OrderHeaderCard({super.key, required this.order});

  final Order order;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final phone = order.client.phone;
    final hasPhone = phone != null && phone.trim().isNotEmpty;
    final date = order.requestedDate;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  order.number ?? context.tr('order.no_number'),
                  textDirection: TextDirection.ltr,
                  textAlign: TextAlign.start,
                  style: text.titleMedium,
                ),
              ),
              DocStatusChip(status: order.status),
            ],
          ),
          AppSpacing.gapXs,
          // Name and date on their own lines: a French name and an Arabic
          // date in one wrapped line read out of order in RTL.
          Text(order.client.name, style: text.bodyMedium),
          Text(
            date == null
                ? context.tr('order.no_date')
                : context.tr(
                    'order.for_date',
                    args: {'date': AlgiersDay.display(date)},
                  ),
            style: text.bodySmall?.copyWith(color: context.textMuted),
          ),
          if (order.deliveryVehicle != null) ...[
            AppSpacing.gapXs,
            Row(
              children: [
                Icon(
                  Icons.local_shipping_outlined,
                  size: 18,
                  color: context.textMuted,
                ),
                AppSpacing.gapXs,
                Expanded(
                  child: Text(
                    order.deliveryVehicle!.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                ),
              ],
            ),
          ],
          if (hasPhone) ...[
            AppSpacing.gapSm,
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                ActionChip(
                  avatar: const Icon(Icons.call_outlined, size: 18),
                  label: Text(context.tr('clients.call')),
                  onPressed: () => PhoneLinks.call(context, phone),
                ),
                if (PhoneLinks.whatsappNumber(phone) != null)
                  ActionChip(
                    avatar: const Icon(Icons.chat_outlined, size: 18),
                    label: Text(context.tr('clients.whatsapp')),
                    onPressed: () => PhoneLinks.whatsapp(context, phone),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// One paid line: what was ordered at which (frozen) price, the truck's
/// stock, the delivered quantity, and its free units.
class DeliveryLineTile extends StatelessWidget {
  static final _compact = TextButton.styleFrom(
    minimumSize: const Size(AppSpacing.minTouch, AppSpacing.minTouch),
    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
  );

  const DeliveryLineTile({
    super.key,
    required this.form,
    required this.line,
    required this.onIncrement,
    required this.onDecrement,
    required this.onType,
    required this.onNone,
    required this.onAll,
  });

  final DeliveryForm form;
  final OrderLine line;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;
  final VoidCallback onType;
  final VoidCallback onNone;
  final VoidCallback onAll;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final qty = form.qtyOf(line);
    final stock = form.stockInUnit(line);
    final over = form.overStock(line);
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            line.designation,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: text.titleSmall,
          ),
          const SizedBox(height: AppSpacing.xxs),
          Text(
            context.tr(
              'delivery.ordered',
              args: {
                'qty': Money.ltr(
                  '${Qty.format(line.qty, isolate: false)} ${line.unitCode} × ${Money.format(line.unitPriceHt, isolate: false)}',
                ),
              },
            ),
            style: text.bodySmall?.copyWith(color: context.textMuted),
          ),
          if (line.promotion != null)
            Text(
              context.tr('sale.promo', args: {'name': line.promotion!}),
              style: text.labelSmall?.copyWith(color: AppColors.success),
            ),
          if (stock != null)
            Row(
              children: [
                Icon(
                  over
                      ? Icons.warning_amber_rounded
                      : Icons.local_shipping_outlined,
                  size: 16,
                  color: over ? scheme.error : context.textMuted,
                ),
                const SizedBox(width: AppSpacing.xxs),
                Flexible(
                  child: Text(
                    context.tr(
                      over ? 'delivery.over_stock' : 'delivery.truck_stock',
                      args: {'qty': Qty.withUnit(stock, line.unitCode)},
                    ),
                    style: text.bodySmall?.copyWith(
                      color: over ? scheme.error : context.textMuted,
                    ),
                  ),
                ),
              ],
            ),
          AppSpacing.gapSm,
          Row(
            children: [
              // Wraps under itself rather than pushing the stepper off a
              // 360 dp screen in Arabic; each button keeps a 48 dp target.
              Expanded(
                child: Wrap(
                  children: [
                    TextButton(
                      style: _compact,
                      onPressed: qty == Decimal.zero ? null : onNone,
                      child: Text(context.tr('delivery.none')),
                    ),
                    TextButton(
                      style: _compact,
                      onPressed: form.isFull(line) ? null : onAll,
                      child: Text(context.tr('delivery.full')),
                    ),
                  ],
                ),
              ),
              QtyStepper(
                label: Qty.format(qty),
                onTapLabel: onType,
                onDecrement: onDecrement,
                onIncrement: form.isFull(line) ? null : onIncrement,
                decrementTooltip: context.tr('sale.less'),
                incrementTooltip: context.tr('sale.more'),
              ),
            ],
          ),
          for (final f in form.freeLinesOf(line))
            Text(
              context.tr(
                'sale.free_line',
                args: {
                  'qty': Qty.withUnit(form.freeQtyOf(f), f.unitCode),
                  'name': f.designation,
                },
              ),
              style: text.labelSmall?.copyWith(color: AppColors.success),
            ),
        ],
      ),
    );
  }
}

/// Total to deliver and "Valider la livraison", one thumb away.
class _DeliverBar extends StatelessWidget {
  const _DeliverBar({
    required this.totalTtc,
    required this.busy,
    this.onSubmit,
  });

  final Decimal totalTtc;
  final bool busy;
  final VoidCallback? onSubmit;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.sm,
          AppSpacing.lg,
          AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          border: Border(top: BorderSide(color: context.fieldBorder)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    context.tr('delivery.to_deliver_ttc'),
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: AlignmentDirectional.centerStart,
                    child: AmountText(totalTtc, style: text.titleLarge),
                  ),
                ],
              ),
            ),
            AppSpacing.gapMd,
            Expanded(
              child: AppButton(
                label: context.tr('delivery.validate'),
                icon: Icons.check_circle_outline,
                loading: busy,
                onPressed: onSubmit,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Delivered, but the BL could not be read back: its number, its total and
/// the PDF, so the livreur is never left without proof.
class DeliveredFallback extends StatelessWidget {
  const DeliveredFallback({
    super.key,
    required this.number,
    required this.saleId,
    required this.totalTtc,
    required this.onDone,
  });

  final String? number;
  final String saleId;
  final Decimal totalTtc;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Text(context.tr('delivery.saved_title')),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: AppButton(
                  label: context.tr('common.share_pdf'),
                  icon: Icons.picture_as_pdf_outlined,
                  variant: AppButtonVariant.outline,
                  onPressed: () => sharePdf(
                    context,
                    path: '/documents/BL/$saleId/pdf',
                    fileName: pdfName(number, 'BL'),
                  ),
                ),
              ),
              AppSpacing.gapMd,
              Expanded(
                child: AppButton(
                  label: context.tr('sale.done'),
                  onPressed: onDone,
                ),
              ),
            ],
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          AppCard(
            child: Row(
              children: [
                const Icon(Icons.check_circle, color: AppColors.success),
                AppSpacing.gapSm,
                Expanded(
                  child: Text(
                    number ?? '—',
                    textDirection: TextDirection.ltr,
                    textAlign: TextAlign.start,
                    style: text.titleLarge,
                  ),
                ),
                AmountText(totalTtc, style: text.titleMedium),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
