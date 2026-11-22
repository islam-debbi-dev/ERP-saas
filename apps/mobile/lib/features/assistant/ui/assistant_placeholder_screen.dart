import 'package:flutter/material.dart';

import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';

/// "Assistant": the AI assistant arrives in sub-phase M4. Until then the
/// entry says so, so the menu does not change when it lands.
class AssistantPlaceholderScreen extends StatelessWidget {
  const AssistantPlaceholderScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(context.tr('assistant.title'))),
    body: ListView(
      padding: const EdgeInsets.only(top: AppSpacing.xxl),
      children: [
        AppEmptyState(
          icon: Icons.auto_awesome_outlined,
          title: context.tr('assistant.soon_title'),
          message: context.tr('assistant.soon_message'),
        ),
      ],
    ),
  );
}
