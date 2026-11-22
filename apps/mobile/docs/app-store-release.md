# Debvora on the Apple App Store (not in phase 39)

The iOS release is parked: phase 39 ships Android first. The iOS project is
already set to bundle id `com.debvora.app` and display name "Debvora"
(`package_rename_config.yaml`).

When the iOS release is planned:

1. Apple Developer Program on the Debvora company account (99 USD / year).
2. developer.apple.com → Identifiers → App ID `com.debvora.app` (explicit).
3. App Store Connect → new app "Debvora", bundle id `com.debvora.app`.
4. `assets/config/env.default` with the production `API_BASE_URL` and
   `DASHBOARD_URL` (see `play-store-release.md` §2).
5. `flutter build ipa --release`, upload with Transporter or Xcode.
6. App Review notes (English): a work app for the field staff of a wholesaler;
   accounts are created by the company from the web dashboard (no sign-up in
   the app); give a demo seller login.
7. Privacy: a public privacy policy URL is required, plus the
   `ios/Runner/PrivacyInfo.xcprivacy` manifest kept in line with what the app
   collects (location at sale time once GPS is added).
