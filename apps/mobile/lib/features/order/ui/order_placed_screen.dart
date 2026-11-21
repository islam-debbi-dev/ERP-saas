import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';

/// Confirmation after `POST /orders` succeeded.
class OrderPlacedScreen extends StatelessWidget {
  const OrderPlacedScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.screen,
          child: Column(
            children: [
              const Spacer(),
              Container(
                width: 112,
                height: 112,
                decoration: const BoxDecoration(
                  color: AppColors.yellow,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_rounded,
                  size: 60,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              Text(
                context.tr('jb.placed.title'),
                textAlign: TextAlign.center,
                style: text.headlineLarge,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                context.tr('jb.placed.message'),
                textAlign: TextAlign.center,
                style: text.bodyMedium?.copyWith(color: context.textMuted),
              ),
              const Spacer(),
              AppButton(
                label: context.tr('jb.placed.track'),
                onPressed: () => context.pushReplacement(Routes.order(orderId)),
              ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: context.tr('jb.placed.continue'),
                variant: AppButtonVariant.secondary,
                onPressed: () => context.go(Routes.home),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}
