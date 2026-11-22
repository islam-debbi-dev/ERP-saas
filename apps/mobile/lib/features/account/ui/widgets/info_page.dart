import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';

/// One titled paragraph of an [InfoPage] (i18n keys).
class InfoSection {
  const InfoSection(this.titleKey, this.bodyKey, {this.args});
  final String titleKey;
  final String bodyKey;
  final Map<String, Object>? args;
}

/// A static text page (help, privacy) made of translated sections.
class InfoPage extends StatelessWidget {
  const InfoPage({super.key, required this.titleKey, required this.sections});

  final String titleKey;
  final List<InfoSection> sections;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr(titleKey))),
      body: ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: sections.length,
        separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.md),
        itemBuilder: (context, i) {
          final s = sections[i];
          return AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(context.tr(s.titleKey), style: text.titleSmall),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  context.tr(s.bodyKey, args: s.args),
                  style: text.bodyMedium,
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
