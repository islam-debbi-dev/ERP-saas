import 'package:flutter/material.dart';
import 'package:orvynt_starter/core/config/app_env.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import '../../../core/helpers/url_helper.dart';
import '../../../core/theme/app_theme.dart';

class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final backgroundColor = isDark
        ? const Color(0xFF0D0D0D)
        : AppColors.surface;
    final cardColor = isDark ? AppColors.darkSurface : AppColors.surface;

    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        title: Text(
          localizations?.translate('privacy_policy') ?? 'Privacy Policy',
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
            _PolicyCard(
              cardColor: cardColor,
              title: 'Information We Collect',
              body:
                  'We may collect profile information, order details, and usage data to provide and improve our services.',
            ),
            _PolicyCard(
              cardColor: cardColor,
              title: 'How We Use Data',
              body:
                  'Your data is used to process orders, personalize your experience, provide support, and maintain app security.',
            ),
            _PolicyCard(
              cardColor: cardColor,
              title: 'Data Sharing',
              body:
                  'We do not sell your personal data. Data is only shared with trusted service providers when necessary to run the app.',
            ),
            _PolicyCard(
              cardColor: cardColor,
              title: 'Your Rights',
              body:
                  'You can view and correct your profile in the app, and delete your account at any time from Account > Delete account. For other requests, contact app support.',
            ),
            _PolicyCard(
              cardColor: cardColor,
              title: 'Contact',
              body:
                  'For any privacy questions, contact us at ${AppEnv.privacyEmail}.',
            ),
            TextButton.icon(
              onPressed: () =>
                  UrlHelper.launchUrl(context, 'https://jibli.org/privacy'),
              icon: const Icon(Icons.open_in_new),
              label: const Text('jibli.org/privacy'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PolicyCard extends StatelessWidget {
  const _PolicyCard({
    required this.cardColor,
    required this.title,
    required this.body,
  });

  final Color cardColor;
  final String title;
  final String body;

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
            title,
            style: Theme.of(
              context,
            ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(body, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}
