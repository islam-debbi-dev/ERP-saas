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
import '../../../core/models/erp_codes.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/network/money_action.dart';
import '../../../core/session/session_cubit.dart';
import '../../auth/ui/widgets/form_error_banner.dart';
import '../../catalog/ui/product_picker_screen.dart';
import '../../orders/data/repo/orders_repository.dart';
import '../../orders/ui/order_result_view.dart';
import '../../truck/data/current_truck.dart';
import '../data/models/pricing.dart';
import '../data/models/sale.dart';
import '../data/repo/sales_repository.dart';
import '../logic/basket.dart';
import '../logic/sale_basket_cubit.dart';
import 'sale_result_view.dart';
import 'widgets/basket_summary.dart';
import 'widgets/qty_stepper.dart';

/// What the basket becomes.
enum SaleMode {
  /// Vente directe from the truck (`POST /sales/quick`).
  direct,

  /// Prévente: a bon de commande, confirmed, delivered later.
  order,
}

/// Vente directe from the truck: basket priced by the API, packaging returned,
/// payment, GPS, `POST /sales/quick`. Pops with the saved [SaleResult] (the
/// visit links it), or null. In [SaleMode.order] the same basket becomes a
/// confirmed bon de commande and pops with the [Order].
class SaleScreen extends StatelessWidget {
  const SaleScreen({
    super.key,
    required this.client,
    this.mode = SaleMode.direct,
  });

  /// Null = vente comptoir (paid in full); required for an order.
  final BasketClient? client;
  final SaleMode mode;

  @override
  Widget build(BuildContext context) {
    final user = context.read<SessionCubit>().state.user;
    return BlocProvider(
      create: (_) {
        final cubit = SaleBasketCubit(
          getIt<SalesRepository>(),
          orders: mode == SaleMode.order ? getIt<OrdersRepository>() : null,
          client: client,
          policy: DiscountPolicy(
            canDiscount: user?.can(Permission.priceOverride) ?? false,
            aboveCeiling: user?.can(Permission.discountAboveX) ?? false,
            ceiling: null,
          ),
        );
        if (user?.can(Permission.priceOverride) ?? false) {
          getIt<SalesRepository>().maxDiscountPct().then((r) {
            if (r is Success<Decimal>) {
              cubit.policy = DiscountPolicy(
                canDiscount: true,
                aboveCeiling: cubit.policy.aboveCeiling,
                ceiling: r.data,
              );
            }
          });
        }
        return cubit;
      },
      child: _SaleView(mode: mode),
    );
  }
}

class _SaleView extends StatefulWidget {
  const _SaleView({required this.mode});

  final SaleMode mode;

  @override
  State<_SaleView> createState() => _SaleViewState();
}

class _SaleViewState extends State<_SaleView> {
  String? _truckId;
  List<PackagingType> _packagingTypes = const [];
  bool _locating = false;
  final _paidText = TextEditingController();
  final _note = TextEditingController();
  String? _requestedDate;

  bool get _isOrder => widget.mode == SaleMode.order;

  @override
  void initState() {
    super.initState();
    getIt<CurrentTruck>().get(refresh: true).then((v) {
      if (mounted) setState(() => _truckId = v?.id);
    });
    final user = context.read<SessionCubit>().state.user;
    if (!_isOrder && (user?.hasFeature(Feature.packaging) ?? false)) {
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
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final cubit = context.read<SaleBasketCubit>();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BlocProvider.value(
          value: cubit,
          child: ProductPickerScreen(truckId: _truckId),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final cubit = context.read<SaleBasketCubit>();
    if (cubit.state.submitting) return;
    if (_isOrder) {
      await cubit.submitOrder(requestedDate: _requestedDate, note: _note.text);
      return;
    }
    setState(() => _locating = true);
    final geo = await captureGeo(context);
    if (!mounted) return;
    setState(() => _locating = false);
    await cubit.submit(
      truckId: _truckId,
      geo: geo,
      runner: MoneyActionRunner(askGeoNote: (error) => _askGeoNote(error)),
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

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
    );
    if (picked != null) {
      setState(
        () => _requestedDate = AlgiersDay.of(
          DateTime.utc(picked.year, picked.month, picked.day, 12),
        ),
      );
    }
  }

  void _setPaidText(Decimal? v) {
    _paidText.text = v == null
        ? ''
        : Money.format(v, currency: false, isolate: false);
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SaleBasketCubit, SaleBasketState>(
      builder: (context, state) {
        final order = state.order;
        if (order != null) {
          return OrderResultView(
            order: order,
            onDone: () => Navigator.of(context).pop(order),
          );
        }
        final result = state.result;
        if (result != null) {
          return SaleResultView(
            result: result,
            onDone: () => Navigator.of(context).pop(result),
          );
        }
        return Scaffold(
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(context.tr(_isOrder ? 'order.title' : 'sale.title')),
                Text(
                  state.client?.name ?? context.tr('sale.counter'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            actions: [
              IconButton(
                tooltip: context.tr('catalog.pick_title'),
                onPressed: _pick,
                icon: const Icon(Icons.add_box_outlined),
              ),
            ],
          ),
          bottomNavigationBar: _SubmitBar(
            state: state,
            busy: _locating || state.submitting,
            label: context.tr(
              !_isOrder
                  ? 'sale.validate'
                  : state.orderDraft != null
                  ? 'order.confirm_again'
                  : 'order.save',
            ),
            onSubmit: state.isEmpty ? null : _submit,
          ),
          body: ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: [
              if (state.error != null) ...[
                SaleErrorCard(error: state.error!, lines: state.lines),
                AppSpacing.gapLg,
              ],
              if (state.orderDraft != null) ...[
                AppCard(child: Text(context.tr('order.draft_pending'))),
                AppSpacing.gapLg,
              ],
              if (state.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                  child: AppEmptyState(
                    icon: Icons.shopping_basket_outlined,
                    title: context.tr('sale.empty_title'),
                    message: context.tr('sale.empty_message'),
                    actionLabel: context.tr('sale.add_products'),
                    onAction: _pick,
                  ),
                )
              else ...[
                for (var i = 0; i < state.lines.length; i++) ...[
                  BasketLineTile(
                    index: i,
                    line: state.lines[i],
                    preview: state.preview,
                  ),
                  AppSpacing.gapSm,
                ],
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(AppSpacing.minTouch),
                  ),
                  onPressed: _pick,
                  icon: const Icon(Icons.add),
                  label: Text(context.tr('sale.add_products')),
                ),
                if (state.pricingError != null) ...[
                  AppSpacing.gapSm,
                  Text(
                    apiErrorText(context, state.pricingError!),
                    style: TextStyle(color: AppColors.error),
                  ),
                ],
                if (_isOrder) ...[
                  AppSpacing.gapXl,
                  AppSectionHeader(title: context.tr('order.details')),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_outlined),
                    title: Text(context.tr('order.requested_date')),
                    subtitle: Text(
                      _requestedDate == null
                          ? context.tr('order.no_date')
                          : AlgiersDay.display(_requestedDate!),
                    ),
                    onTap: _pickDate,
                  ),
                  TextField(
                    controller: _note,
                    maxLength: 255,
                    decoration: InputDecoration(
                      labelText: context.tr('order.note'),
                    ),
                  ),
                  if (state.preview != null)
                    BasketSummary(
                      totalHt: state.preview!.totalHt,
                      totalTva: state.preview!.totalTva,
                      totalTtc: state.preview!.totalTtc,
                    ),
                ],
                if (!_isOrder && _packagingTypes.isNotEmpty) ...[
                  AppSpacing.gapXl,
                  AppSectionHeader(
                    title: context.tr('sale.packaging_returned'),
                  ),
                  for (final t in _packagingTypes)
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.xs,
                      ),
                      child: Row(
                        children: [
                          Expanded(child: Text(t.name)),
                          QtyStepper(
                            label: '${state.packaging[t.id] ?? 0}',
                            onDecrement: () =>
                                context.read<SaleBasketCubit>().setPackaging(
                                  t.id,
                                  (state.packaging[t.id] ?? 0) - 1,
                                ),
                            onIncrement: () =>
                                context.read<SaleBasketCubit>().setPackaging(
                                  t.id,
                                  (state.packaging[t.id] ?? 0) + 1,
                                ),
                          ),
                        ],
                      ),
                    ),
                ],
                if (!_isOrder) ...[
                  AppSpacing.gapXl,
                  AppSectionHeader(title: context.tr('sale.payment')),
                  AppSpacing.gapSm,
                  TextField(
                    controller: _paidText,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
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
                      context.read<SaleBasketCubit>().setPaid(
                        v.trim().isEmpty ? null : Money.parseInput(v),
                      );
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
                        onPressed: state.estimatedTtc == null
                            ? null
                            : () {
                                context.read<SaleBasketCubit>().payAll();
                                _setPaidText(state.estimatedTtc);
                              },
                      ),
                      if (state.client != null)
                        ActionChip(
                          avatar: const Icon(Icons.schedule, size: 18),
                          label: Text(context.tr('sale.all_credit')),
                          onPressed: () {
                            context.read<SaleBasketCubit>().setPaid(
                              Decimal.zero,
                            );
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
                    onSelectionChanged: (s) =>
                        context.read<SaleBasketCubit>().setMode(s.first),
                  ),
                  AppSpacing.gapXl,
                  if (state.preview != null)
                    BasketSummary(
                      totalHt: state.preview!.totalHt,
                      totalTva: state.preview!.totalTva,
                      totalTtc: state.preview!.totalTtc,
                      paid: state.paidOrZero,
                      credit: state.estimatedCredit,
                    ),
                ],
              ],
            ],
          ),
        );
      },
    );
  }
}

/// Total and "Valider la vente", one thumb away.
class _SubmitBar extends StatelessWidget {
  const _SubmitBar({
    required this.state,
    required this.busy,
    required this.label,
    this.onSubmit,
  });

  final String label;

  final SaleBasketState state;
  final bool busy;
  final VoidCallback? onSubmit;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final ttc = state.estimatedTtc;
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
                    context.tr('sale.total_ttc'),
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                  if (state.pricing || ttc == null)
                    Text(
                      state.isEmpty ? '—' : context.tr('sale.pricing'),
                      style: text.titleMedium,
                    )
                  else
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: AlignmentDirectional.centerStart,
                      child: AmountText(ttc, style: text.titleLarge),
                    ),
                ],
              ),
            ),
            AppSpacing.gapMd,
            Expanded(
              child: AppButton(
                label: label,
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

/// One basket line: product, unit, quantity, the API's price (promotion,
/// remise, free units).
class BasketLineTile extends StatelessWidget {
  const BasketLineTile({
    super.key,
    required this.index,
    required this.line,
    this.preview,
  });

  final int index;
  final BasketLine line;
  final PricingPreview? preview;

  Future<void> _discount(BuildContext context) async {
    final cubit = context.read<SaleBasketCubit>();
    final max = cubit.policy.maxPct;
    final typed = await askText(
      context,
      title: context.tr('sale.discount'),
      message: context.tr(
        'sale.discount_max',
        args: {'max': Qty.format(max, isolate: false)},
      ),
      label: '%',
      minLength: 1,
      maxLength: 6,
    );
    if (typed == null) return;
    final pct = Money.parseInput(typed);
    if (pct != null) cubit.setDiscount(index, pct);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final cubit = context.read<SaleBasketCubit>();
    final priced = preview?.paidLineOf(index);
    final free = preview?.freeLinesOf(index) ?? const <PricedLine>[];
    final units = line.product.units;
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  line.product.designation,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleSmall,
                ),
              ),
              IconButton(
                tooltip: context.tr('sale.remove_line'),
                visualDensity: VisualDensity.compact,
                onPressed: () => cubit.remove(index),
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
          Row(
            children: [
              if (units.length > 1)
                PopupMenuButton<String>(
                  tooltip: context.tr('sale.unit'),
                  initialValue: line.unit.unitId,
                  onSelected: (id) => cubit.setUnit(
                    index,
                    units.firstWhere((u) => u.unitId == id),
                  ),
                  itemBuilder: (_) => [
                    for (final u in units)
                      PopupMenuItem(value: u.unitId, child: Text(u.label)),
                  ],
                  child: Chip(
                    label: Text(line.unit.label),
                    avatar: const Icon(Icons.swap_vert, size: 18),
                  ),
                )
              else
                Chip(label: Text(line.unit.label)),
              const Spacer(),
              QtyStepper(
                label: Qty.format(line.qty),
                onDecrement: () => cubit.decrement(index),
                onIncrement: () => cubit.increment(index),
                decrementTooltip: context.tr('sale.less'),
                incrementTooltip: context.tr('sale.more'),
              ),
            ],
          ),
          if (priced != null) ...[
            AppSpacing.gapXs,
            Row(
              children: [
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: Money.ltr(
                            '${Qty.format(priced.qty, isolate: false)} × ${Money.format(priced.unitPriceHt, isolate: false)}',
                          ),
                        ),
                        if (priced.discountPct > Decimal.zero)
                          TextSpan(
                            text:
                                '  ${Money.ltr('−${Qty.format(priced.discountPct, isolate: false)} %')}',
                            style: const TextStyle(color: AppColors.success),
                          ),
                      ],
                    ),
                    style: text.bodySmall?.copyWith(color: context.textMuted),
                  ),
                ),
                AmountText(priced.lineHt, style: text.titleSmall),
              ],
            ),
            if (priced.promotion != null)
              Text(
                context.tr(
                  'sale.promo',
                  args: {'name': priced.promotion!.name},
                ),
                style: text.labelSmall?.copyWith(color: AppColors.success),
              ),
          ],
          for (final f in free)
            Text(
              context.tr(
                'sale.free_line',
                args: {
                  'qty': Qty.format(f.qty),
                  'unit': f.unitLabel,
                  'name': f.designation,
                },
              ),
              style: text.labelSmall?.copyWith(color: AppColors.success),
            ),
          if (cubit.policy.canDiscount)
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                onPressed: () => _discount(context),
                icon: const Icon(Icons.percent, size: 18),
                label: Text(
                  line.discountPct == null
                      ? context.tr('sale.discount')
                      : '${Qty.format(line.discountPct!)} %',
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A refused save, said clearly: over the plafond (with the figures), stock
/// short (with the product), or the API's message.
class SaleErrorCard extends StatelessWidget {
  const SaleErrorCard({super.key, required this.error, required this.lines});

  final ApiError error;
  final List<BasketLine> lines;

  @override
  Widget build(BuildContext context) => MoneyErrorCard(
    error: error,
    stockShort: (productId, available) {
      final match = lines.where((l) => l.product.id == productId);
      if (match.isEmpty) return null;
      final product = match.first.product;
      return (product.designation, stockText(product, available));
    },
  );
}

/// The error of a money action (sale, delivery): the API's translated
/// message, plus the plafond figures for CREDIT_LIMIT_EXCEEDED, the product
/// and what is left for STOCK_INSUFFICIENT ([stockShort] names them from the
/// product id and the available base quantity), and "retry is safe" when the
/// network failed.
class MoneyErrorCard extends StatelessWidget {
  const MoneyErrorCard({super.key, required this.error, this.stockShort});

  final ApiError error;
  final (String name, String qty)? Function(
    String productId,
    Decimal available,
  )?
  stockShort;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[apiErrorText(context, error)];
    if (error.code == 'CREDIT_LIMIT_EXCEEDED') {
      String amount(String key) {
        final v = error.detail(key);
        return v is String ? Money.format(Decimal.parse(v)) : '—';
      }

      parts.add(
        context.tr(
          'sale.credit_details',
          args: {
            'balance': amount('balance'),
            'limit': amount('limit'),
            'projected': amount('projected'),
          },
        ),
      );
    }
    if (error.code == 'STOCK_INSUFFICIENT' && stockShort != null) {
      final productId = error.detail('productId');
      final available = error.detail('available');
      final named = productId is String && available is String
          ? stockShort!(productId, Decimal.parse(available))
          : null;
      if (named != null) {
        parts.add(
          context.tr(
            'sale.stock_details',
            args: {'name': named.$1, 'qty': named.$2},
          ),
        );
      }
    }
    if (error.isOffline) parts.add(context.tr('sale.retry_safe'));
    return FormErrorBanner(message: parts.join('\n'));
  }
}
