import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../../core/session/session_cubit.dart';
import '../../../core/session/session_state.dart';
import '../../cart/logic/cart_cubit.dart';
import '../../cart/ui/widgets/order_summary.dart';
import '../../cart/ui/widgets/qty_stepper.dart';
import '../../order/data/repo/orders_repository.dart';
import '../logic/checkout_cubit.dart';

class CheckoutScreen extends StatelessWidget {
  const CheckoutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => CheckoutCubit(
        getIt<OrderRepository>(),
        getIt<CartCubit>(),
        context.read<SessionCubit>(),
      ),
      child: const _CheckoutView(),
    );
  }
}

class _CheckoutView extends StatefulWidget {
  const _CheckoutView();

  @override
  State<_CheckoutView> createState() => _CheckoutViewState();
}

class _CheckoutViewState extends State<_CheckoutView> {
  final _note = TextEditingController();
  final _customRequest = TextEditingController();
  bool _showCustomRequest = false;

  @override
  void dispose() {
    _note.dispose();
    _customRequest.dispose();
    super.dispose();
  }

  Future<void> _addAddress() async {
    await context.push(Routes.addressForm);
    if (mounted) context.read<CheckoutCubit>().syncAddresses();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<CheckoutCubit>();
    return BlocListener<SessionCubit, SessionState>(
      listener: (_, _) => cubit.syncAddresses(),
      child: BlocConsumer<CheckoutCubit, CheckoutState>(
        listener: (context, state) {
          if (state.placed != null) {
            context.go(Routes.home);
            context.push(Routes.orderPlaced(state.placed!.id));
          } else if (state.error != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(apiErrorText(context, state.error!))),
            );
            // A size / option of a line is no longer valid: back to the cart,
            // where that line shows the message and a "Fix" button.
            if (cubit.failedOnLine && context.canPop()) context.pop();
          }
        },
        builder: (context, state) => CartBuilder(
          builder: (context, cart) {
            final addresses = cubit.addresses;
            final hasContent =
                !cart.isEmpty || _customRequest.text.trim().isNotEmpty;
            // First thing still missing, shown above the disabled button.
            // The address is optional, so it never blocks the order.
            final String? blocker;
            if (!cart.orderingEnabled) {
              blocker = context.tr('jb.home.closed_message');
            } else if (!hasContent) {
              blocker = context.tr('jb.checkout.need_content');
            } else if (!cart.meetsMinimum) {
              blocker = context.tr(
                'jb.checkout.need_minimum',
                args: {
                  'amount': formatDzd(
                    context,
                    cart.minOrderAmount - cart.subtotal,
                  ),
                },
              );
            } else {
              blocker = null;
            }
            final canSubmit = blocker == null;
            return Scaffold(
              appBar: AppBar(title: Text(context.tr('jb.checkout.title'))),
              body: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screenH,
                  AppSpacing.sm,
                  AppSpacing.screenH,
                  AppSpacing.xl,
                ),
                children: [
                  _title(context, 'jb.checkout.address'),
                  for (final address in addresses) ...[
                    _AddressOption(
                      title: address.label,
                      subtitle: [
                        address.fullAddress,
                        if (address.city != null) address.city,
                      ].join(' · '),
                      selected: address.id == state.addressId,
                      onTap: () => cubit.selectAddress(address.id),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                  ],
                  // No address: the admin takes it during the confirmation call.
                  _AddressOption(
                    title: context.tr('jb.checkout.address_by_phone'),
                    subtitle: context.tr(
                      'jb.checkout.address_by_phone_caption',
                    ),
                    selected: state.addressId == null,
                    onTap: cubit.selectNoAddress,
                  ),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton.icon(
                      onPressed: _addAddress,
                      icon: const Icon(Icons.add_rounded),
                      label: Text(context.tr('jb.address.add')),
                    ),
                  ),
                  _title(context, 'jb.checkout.note'),
                  TextField(
                    controller: _note,
                    maxLength: 500,
                    minLines: 1,
                    maxLines: 3,
                    decoration: InputDecoration(
                      hintText: context.tr('jb.checkout.note_hint'),
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (_showCustomRequest || cart.isEmpty) ...[
                    _title(context, 'jb.checkout.custom_request'),
                    TextField(
                      controller: _customRequest,
                      maxLength: 1000,
                      minLines: 2,
                      maxLines: 4,
                      autofocus:
                          _showCustomRequest && _customRequest.text.isEmpty,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        hintText: context.tr('jb.checkout.custom_request_hint'),
                        counterText: '',
                      ),
                    ),
                  ] else
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton.icon(
                        onPressed: () =>
                            setState(() => _showCustomRequest = true),
                        icon: const Icon(Icons.add_rounded),
                        label: Text(
                          context.tr('jb.checkout.add_custom_request'),
                        ),
                      ),
                    ),
                  _title(context, 'jb.checkout.payment'),
                  AppCard(
                    child: Row(
                      children: [
                        Icon(Icons.payments_outlined, color: context.textMain),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                context.tr('jb.checkout.cod'),
                                style: AppTextStyles.label.copyWith(
                                  color: context.textMain,
                                ),
                              ),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                context.tr('jb.checkout.cod_caption'),
                                style: AppTextStyles.caption.copyWith(
                                  color: context.textMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  OrderSummary.fromCart(cart),
                ],
              ),
              bottomNavigationBar: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.screenH,
                    AppSpacing.sm,
                    AppSpacing.screenH,
                    AppSpacing.md,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (blocker != null) _BlockerHint(message: blocker),
                      AppButton(
                        label:
                            '${context.tr('jb.checkout.place_order')} · ${formatDzd(context, cart.total)}',
                        loading: state.submitting,
                        onPressed: canSubmit
                            ? () => cubit.submit(
                                note: _note.text,
                                customRequest: _customRequest.text,
                              )
                            : null,
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _title(BuildContext context, String key) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.lg, bottom: AppSpacing.sm),
    child: Text(
      context.tr(key),
      style: Theme.of(context).textTheme.titleMedium,
    ),
  );
}

class _AddressOption extends StatelessWidget {
  const _AddressOption({
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = context.isDarkMode ? AppColors.accent : AppColors.ink;
    final fill = selected
        ? (context.isDarkMode
              ? AppColors.accent.withValues(alpha: 0.12)
              : AppColors.accentTint)
        : context.fieldFill;
    return Material(
      color: fill,
      borderRadius: AppRadius.lgAll,
      child: InkWell(
        borderRadius: AppRadius.lgAll,
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: AppSpacing.card,
          decoration: BoxDecoration(
            borderRadius: AppRadius.lgAll,
            border: Border.all(
              color: selected ? accent : context.fieldBorder,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                color: selected ? accent : context.textFaint,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Why "Place order" is disabled.
class _BlockerHint extends StatelessWidget {
  const _BlockerHint({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final color = context.textMain;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
        child: Row(
          children: [
            Icon(Icons.info_outline_rounded, size: 18, color: color),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: AppTextStyles.label.copyWith(color: color),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
