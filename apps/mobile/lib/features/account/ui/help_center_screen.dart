import 'package:flutter/material.dart';

import '../../../core/config/app_env.dart';
import 'widgets/info_page.dart';

class HelpCenterScreen extends StatelessWidget {
  const HelpCenterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final support = AppEnv.supportEmail;
    return InfoPage(
      titleKey: 'help.title',
      sections: [
        const InfoSection('help.account_title', 'help.account_body'),
        const InfoSection('help.password_title', 'help.password_body'),
        const InfoSection('help.network_title', 'help.network_body'),
        if (support.isNotEmpty)
          InfoSection(
            'help.contact_title',
            'help.contact_body',
            args: {'email': support},
          ),
      ],
    );
  }
}
