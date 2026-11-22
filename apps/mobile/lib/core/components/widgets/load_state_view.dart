import 'package:flutter/material.dart';

import '../../design/design.dart';
import '../../localization/tr.dart';
import '../../network/error_messages.dart';
import '../../paging/load_cubit.dart';

/// Loading / error / content switch for a [LoadState]. [skeleton] shows on
/// the first load; afterwards [builder] keeps rendering during reloads.
class LoadStateView<T> extends StatelessWidget {
  const LoadStateView({
    super.key,
    required this.state,
    required this.onRetry,
    required this.builder,
    this.skeleton,
  });

  final LoadState<T> state;
  final VoidCallback onRetry;
  final Widget Function(BuildContext context, T data) builder;
  final Widget? skeleton;

  @override
  Widget build(BuildContext context) {
    final data = state.data;
    if (data != null) return builder(context, data);
    if (state.loading) return skeleton ?? const AppLoader(size: 72);
    return AppErrorState(
      title: context.tr('common.load_failed'),
      message: state.error == null ? null : apiErrorText(context, state.error!),
      retryLabel: context.tr('common.retry'),
      onRetry: onRetry,
    );
  }
}
