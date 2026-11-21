import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/components/widgets/net_image.dart';
import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/paging/load_cubit.dart';
import '../../../core/service/api_result.dart';
import '../../cart/ui/widgets/order_summary.dart';
import '../../catalog/ui/widgets/load_state_view.dart';
import '../data/models/order.dart';
import '../data/repo/orders_repository.dart';
import 'widgets/order_status_chip.dart';
import '../../catalog/ui/widgets/product_customizer.dart';

/// `GET /orders/mine/:id` — progress, items, totals, and cancel while
/// pending. Pops with the latest [Order] so the list can update in place.
class OrderDetailsScreen extends StatelessWidget {
  const OrderDetailsScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context) {
    final repo = getIt<OrderRepository>();
    return BlocProvider(
      create: (_) => LoadCubit<Order>(() => repo.getMyOrder(orderId))..load(),
      child: BlocBuilder<LoadCubit<Order>, LoadState<Order>>(
        builder: (context, state) => PopScope<Order>(
          canPop: false,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) context.pop(state.data);
          },
          child: Scaffold(
            appBar: AppBar(
              title: Text(
                state.data == null
                    ? context.tr('jb.orders.detail_title')
                    : '#${state.data!.orderNumber}',
              ),
            ),
            body: RefreshIndicator(
              onRefresh: context.read<LoadCubit<Order>>().load,
              child: LoadStateView<Order>(
                state: state,
                onRetry: context.read<LoadCubit<Order>>().load,
                builder: (context, order) => _OrderBody(order: order),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OrderBody extends StatelessWidget {
  const _OrderBody({required this.order});

  final Order order;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.sm,
        AppSpacing.screenH,
        AppSpacing.huge,
      ),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                formatDateTime(context, order.createdAt),
                style: text.bodySmall,
              ),
            ),
            OrderStatusChip(status: order.status),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        _Progress(order: order),
        if (order.deliveryPerson != null) ...[
          const SizedBox(height: AppSpacing.lg),
          AppCard(
            child: Row(
              children: [
                const Icon(Icons.delivery_dining_rounded),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        context.tr('jb.orders.driver'),
                        style: text.bodySmall,
                      ),
                      Text(
                        order.deliveryPerson!.fullName,
                        style: text.titleSmall,
                      ),
                    ],
                  ),
                ),
                if (order.deliveryPerson!.phone.isNotEmpty)
                  IconButton.filledTonal(
                    tooltip: context.tr('phone'),
                    onPressed: () => launchUrl(
                      Uri(scheme: 'tel', path: order.deliveryPerson!.phone),
                    ),
                    icon: const Icon(Icons.call_rounded),
                  ),
              ],
            ),
          ),
        ],
        _section(context, 'jb.orders.items'),
        if (order.items.isEmpty && order.customRequest.isEmpty)
          Text(context.tr('no_data'), style: text.bodySmall),
        for (final item in order.items)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: AppRadius.smAll,
                  child: SizedBox(
                    width: 48,
                    height: 48,
                    child: NetImage(url: item.image, fit: BoxFit.contain),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.name, style: text.titleSmall),
                      if (item.variantLabel != null || item.options.isNotEmpty)
                        ChoicesSummary(
                          size: item.variantLabel,
                          supplements: [
                            for (final o in item.supplements) o.label,
                          ],
                          instructions: [
                            for (final o in item.instructions) o.label,
                          ],
                        ),
                      Text(
                        '${formatQty(context, item.qty, item.unit)} × ${formatDzd(context, item.unitPrice)}'
                        '${item.storeName.isEmpty ? '' : ' · ${item.storeName}'}',
                        style: text.bodySmall,
                      ),
                    ],
                  ),
                ),
                Text(
                  formatDzd(context, item.lineTotal),
                  style: AppTextStyles.label.copyWith(color: context.textMain),
                ),
              ],
            ),
          ),
        if (order.customRequest.isNotEmpty) ...[
          _section(context, 'jb.checkout.custom_request'),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(order.customRequest, style: text.bodyMedium),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  context.tr('jb.orders.pricing_${order.pricingStatus}'),
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
        ],
        _section(context, 'jb.checkout.address'),
        AppCard(
          child: Row(
            children: [
              const Icon(Icons.place_outlined),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      order.customer.address.trim().isEmpty
                          ? context.tr('jb.orders.address_to_confirm')
                          : order.customer.address,
                      style: text.bodyMedium,
                    ),
                    Text(
                      '${order.customer.name} · ${order.customer.phone}',
                      style: text.bodySmall,
                    ),
                    if (order.customer.note.isNotEmpty)
                      Text(order.customer.note, style: text.bodySmall),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        OrderSummary(
          subtotal: order.subtotal,
          deliveryFee: order.deliveryFee,
          total: order.total,
          customRequestAmount: order.customRequestAmount,
        ),
        if (order.status == OrderStatus.cancelled &&
            order.cancelReason.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          Text(
            context.tr(
              'jb.orders.cancel_reason',
              args: {
                'reason': context.tr('jb.cancel_reason.${order.cancelReason}'),
              },
            ),
            style: text.bodySmall,
          ),
        ],
        if (order.status.isCancelable) ...[
          const SizedBox(height: AppSpacing.xl),
          _CancelButton(order: order),
        ],
      ],
    );
  }

  Widget _section(BuildContext context, String key) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.xl, bottom: AppSpacing.sm),
    child: Text(
      context.tr(key),
      style: Theme.of(context).textTheme.titleMedium,
    ),
  );
}

/// Pending → Confirmed → Out for delivery → Delivered (or Cancelled).
class _Progress extends StatelessWidget {
  const _Progress({required this.order});

  final Order order;

  static const _steps = [
    OrderStatus.pending,
    OrderStatus.confirmed,
    OrderStatus.outForDelivery,
    OrderStatus.delivered,
  ];

  @override
  Widget build(BuildContext context) {
    if (order.status == OrderStatus.cancelled) {
      return AppCard(
        color: AppColors.error.withValues(alpha: 0.1),
        child: Row(
          children: [
            const Icon(Icons.cancel_outlined, color: AppColors.error),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                context.tr('jb.orders.cancelled_message'),
                style: AppTextStyles.body.copyWith(color: context.textMain),
              ),
            ),
          ],
        ),
      );
    }
    final current = _steps.indexOf(order.status);
    return AppCard(
      child: Column(
        children: [
          for (var i = 0; i < _steps.length; i++)
            _StepRow(
              label: orderStatusLabel(context, _steps[i]),
              time: _timeOf(_steps[i]),
              done: i <= current,
              active: i == current,
              last: i == _steps.length - 1,
            ),
        ],
      ),
    );
  }

  DateTime? _timeOf(OrderStatus status) => switch (status) {
    OrderStatus.pending => order.createdAt,
    OrderStatus.confirmed => order.confirmedAt,
    OrderStatus.outForDelivery => order.outForDeliveryAt,
    OrderStatus.delivered => order.deliveredAt,
    OrderStatus.cancelled => order.cancelledAt,
  };
}

class _StepRow extends StatelessWidget {
  const _StepRow({
    required this.label,
    required this.time,
    required this.done,
    required this.active,
    required this.last,
  });

  final String label;
  final DateTime? time;
  final bool done;
  final bool active;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final dot = done ? AppColors.yellowDeep : context.fieldBorder;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            children: [
              Container(
                width: 18,
                height: 18,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: done ? dot : Colors.transparent,
                  border: Border.all(color: dot, width: 2),
                ),
                child: done
                    ? const Icon(Icons.check, size: 12, color: AppColors.ink)
                    : null,
              ),
              if (!last)
                Expanded(
                  child: Container(
                    width: 2,
                    margin: const EdgeInsets.symmetric(vertical: 2),
                    color: done ? dot : context.fieldBorder,
                  ),
                ),
            ],
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: AppTextStyles.label.copyWith(
                      color: done ? context.textMain : context.textFaint,
                      fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                    ),
                  ),
                  if (time != null && done)
                    Text(
                      formatDateTime(context, time!),
                      style: AppTextStyles.caption.copyWith(
                        color: context.textMuted,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CancelButton extends StatefulWidget {
  const _CancelButton({required this.order});

  final Order order;

  @override
  State<_CancelButton> createState() => _CancelButtonState();
}

class _CancelButtonState extends State<_CancelButton> {
  bool _busy = false;

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(dialog.tr('jb.orders.cancel_title')),
        content: Text(dialog.tr('jb.orders.cancel_message')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(dialog.tr('jb.common.keep')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialog, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: Text(dialog.tr('jb.orders.cancel_confirm')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    final result = await getIt<OrderRepository>().cancelOrder(widget.order.id);
    if (!mounted) return;
    setState(() => _busy = false);
    switch (result) {
      case Success(:final data):
        context.read<LoadCubit<Order>>().set(data);
      case Failure(:final message):
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(apiErrorText(context, message))));
        // The order may have moved on (e.g. confirmed) — show its real state.
        context.read<LoadCubit<Order>>().load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppButton(
      label: context.tr('jb.orders.cancel_order'),
      variant: AppButtonVariant.outline,
      icon: Icons.close_rounded,
      loading: _busy,
      onPressed: _cancel,
    );
  }
}
