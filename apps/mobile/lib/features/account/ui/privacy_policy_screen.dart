import 'package:flutter/material.dart';

import '../../../core/config/app_env.dart';
import 'widgets/info_page.dart';

/// What the field app records and why, including the location notice of
/// loi 18-07 (protection des données à caractère personnel).
class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final email = AppEnv.privacyEmail;
    return InfoPage(
      titleKey: 'privacy.title',
      sections: [
        const InfoSection('privacy.data_title', 'privacy.data_body'),
        const InfoSection('privacy.location_title', 'privacy.location_body'),
        const InfoSection(
          'privacy.controller_title',
          'privacy.controller_body',
        ),
        const InfoSection('privacy.rights_title', 'privacy.rights_body'),
        if (email.isNotEmpty)
          InfoSection(
            'privacy.contact_title',
            'privacy.contact_body',
            args: {'email': email},
          ),
      ],
    );
  }
}
