import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../logic/assistant_status_cubit.dart';

/// The assistant (phase 30 API), a sub-page of each role's "Plus": the
/// bottom bar hides by itself (#85).
class AssistantScreen extends StatelessWidget {
  const AssistantScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AssistantStatusCubit>().state.provider;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('assistant.title'))),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(top: AppSpacing.xxl),
              children: [
                AppEmptyState(
                  icon: Icons.auto_awesome_outlined,
                  title: context.tr('assistant.empty_title'),
                  message: context.tr('assistant.empty_help'),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsetsDirectional.all(AppSpacing.md),
              child: ProviderNotice(provider: provider),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Les réponses sont générées par une IA : {provider}…", under the input
/// like the web.
class ProviderNotice extends StatelessWidget {
  const ProviderNotice({super.key, required this.provider});

  final String? provider;

  @override
  Widget build(BuildContext context) {
    final name = provider == null
        ? ''
        : context.tr('assistant.provider.$provider');
    return Text(
      context.tr('assistant.notice', args: {'provider': name}),
      style: AppTextStyles.caption.copyWith(color: context.textMuted),
    );
  }
}
