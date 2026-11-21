import 'package:flutter/material.dart';
import 'package:orvynt_starter/core/config/app_env.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import '../../../core/theme/app_theme.dart';

class HelpCenterScreen extends StatelessWidget {
  const HelpCenterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final backgroundColor = isDark ? AppColors.darkDeep : AppColors.surface;
    final cardColor = isDark ? AppColors.darkSurface : AppColors.surface;

    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        title: Text(
          localizations?.translate('help_center') ?? 'Help Center',
          style: Theme.of(context).textTheme.headlineLarge,
        ),
        backgroundColor: backgroundColor,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _InfoCard(
              cardColor: cardColor,
              icon: Icons.help_outline,
              title: localizations?.translate('help_center') ?? 'Help Center',
              description:
                  'Need help with your account, orders, or store? Our support team is here for you.',
            ),
            const SizedBox(height: 12),
            _HelpItem(
              cardColor: cardColor,
              question: 'How can I update my account information?',
              answer:
                  'Go to Account > Personal Account and update your details, then tap Save.',
            ),
            _HelpItem(
              cardColor: cardColor,
              question: 'How do I track my order?',
              answer:
                  'Open your orders from the app and check the latest delivery status there.',
            ),
            _HelpItem(
              cardColor: cardColor,
              question: 'How can I contact support?',
              answer:
                  'You can reach us anytime at ${AppEnv.supportEmail} and we will respond as soon as possible.',
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.cardColor,
    required this.icon,
    required this.title,
    required this.description,
  });

  final Color cardColor;
  final IconData icon;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    final textColor =
        Theme.of(context).textTheme.bodyMedium?.color ?? Colors.black;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: textColor),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  description,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HelpItem extends StatelessWidget {
  const _HelpItem({
    required this.cardColor,
    required this.question,
    required this.answer,
  });

  final Color cardColor;
  final String question;
  final String answer;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            question,
            style: Theme.of(
              context,
            ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(answer, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}
