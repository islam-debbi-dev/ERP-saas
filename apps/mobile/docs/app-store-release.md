# Publishing Jibli on the Apple App Store

The iOS project is configured for release: bundle id `org.jibli.app` (same as
the Android package id), display name "Jibli", iOS 15.0 minimum, iPhone and
iPad, privacy manifest in `ios/Runner/PrivacyInfo.xcprivacy`, export
compliance answered in `Info.plist`.

Everything below needs a Mac with Xcode and an Apple Developer account. Steps
marked **(Mac)** run on the Mac, steps marked **(Web)** run in a browser.

## 1. Apple Developer account (Web, one-time)

- Enrol at https://developer.apple.com/programs/ (99 USD per year).
- Decide first whose account it is. The seller name shown on the App Store is
  the account holder. The client owns Jibli, so the cleanest setup is the
  client's account (an organisation account needs a D-U-N-S number and takes a
  few days), with you added as Admin or App Manager under Users and Access.
  Moving an app to another account later is possible but slow.

## 2. Register the app (Web)

1. https://developer.apple.com/account → Identifiers → **+** → App IDs → App.
   Bundle ID: explicit, `org.jibli.app`. No capabilities needed for now (push
   notifications are not in the app yet).
2. https://appstoreconnect.apple.com → Apps → **+** → New App: platform iOS,
   name "Jibli", primary language, bundle id `org.jibli.app`, SKU e.g.
   `jibli-ios`.

The bundle id becomes permanent once a build is uploaded.

## 3. Signing (Mac)

```bash
cd mobile
flutter pub get
cd ios && pod install && cd ..
open ios/Runner.xcworkspace
```

In Xcode: Runner target → Signing & Capabilities → tick "Automatically manage
signing" and pick the team. Xcode creates the distribution certificate and
provisioning profile itself. Do this for the Release configuration too. Do not
commit the `DEVELOPMENT_TEAM` change if the team is the client's and you work
from several accounts; otherwise committing it is fine.

`pod install` also refreshes `ios/Podfile.lock`, which is out of date in the
repo. Commit the new lock file.

## 4. Point the build at production (Mac)

Same as Android: `assets/config/env.default` (gitignored) must contain

```
API_BASE_URL=https://api.jibli.org/api/v1
```

or pass `--dart-define=API_BASE_URL=...`. Without it the app falls back to a
placeholder host and the reviewer sees a broken app.

## 5. Version and build (Mac)

`pubspec.yaml` `version: 1.1.0+3` gives `CFBundleShortVersionString` 1.1.0 and
`CFBundleVersion` 3. Every upload needs a higher build number (after the `+`).

```bash
cd mobile
flutter clean
flutter build ipa --release
```

Output: `build/ios/ipa/*.ipa`. Upload it with the Transporter app (Mac App
Store) or open `build/ios/archive/Runner.xcarchive` in Xcode → Distribute App
→ App Store Connect. Apple processes the build in about 15 to 30 minutes, then
it shows under TestFlight.

### Signing and uploading from the command line

No Apple account is signed in to Xcode on the build Mac, so `flutter build ipa`
archives fine but fails at export ("No signing certificate iOS Distribution").
Use the App Store Connect API key instead (key file in `~/keys/`). Xcode then
creates the distribution certificate and profile itself and uploads the build.
The Runner target has `DEVELOPMENT_TEAM = JC87U689V7` committed.

`ExportOptions.plist`: `method` = `app-store-connect`, `destination` =
`upload`, `teamID` = `JC87U689V7`, `signingStyle` = `automatic`.

```bash
cd mobile
flutter build ipa --release   # archive succeeds, export step may fail; that is fine
xcodebuild -exportArchive \
  -archivePath build/ios/archive/Runner.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath /tmp/jibli-export \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/keys/AuthKey_<KEY_ID>.p8 \
  -authenticationKeyID <KEY_ID> -authenticationKeyIssuerID <ISSUER_ID>
```

The Issuer ID is at the top of App Store Connect, under Users and Access,
then Integrations, then App Store Connect API.

## 6. TestFlight (Web)

Internal testers (up to 100 people in your team) can install right away.
External testers need a short beta review. Test on a real iPhone before
sending to App Review, and on an iPad because the app is universal.

## 7. App Store Connect listing (Web)

- **Privacy Policy URL:** `https://jibli.org/privacy` (required).
- **Support URL:** `https://jibli.org` or a contact page.
- **App Privacy** questionnaire, answer exactly like the privacy manifest:
  Name, Phone Number, Email Address, Physical Address, Purchase History, User
  ID. All linked to the user, used for App Functionality only, no tracking.
- **Age rating** questionnaire (no objectionable content, so 4+).
- **Pricing and Availability:** Free. Availability: Algeria only, since
  delivery works only there. This also explains the app to the reviewer.
- **Category:** Food & Drink (or Shopping).
- **Screenshots:** 6.9" iPhone (1320 x 2868 or 1290 x 2796) is required, plus
  13" iPad (2064 x 2752) because the app supports iPad. Real app screens only.
- **Export compliance:** already answered by `ITSAppUsesNonExemptEncryption =
  false` in `Info.plist` (the app only uses HTTPS).

## 8. App Review rules to check before submitting

These are the App Review Guidelines items that matter for Jibli:

| Guideline | What Apple checks | State in Jibli |
|---|---|---|
| 2.1 App completeness | Reviewer can sign in and use every feature, backend is live with real content | Give a demo account in App Review Information (phone + password). Production must have real stores and products, an empty catalogue is rejected. |
| 4.2 Minimum functionality | Not just a website in a wrapper | Native app, fine. |
| 5.1.1(i) Privacy policy | Link in App Store Connect and inside the app | Account → Privacy Policy opens the in-app summary and jibli.org/privacy. |
| 5.1.1(v) Account deletion | Users who can create an account can delete it from inside the app | Account → Delete account (password-confirmed `DELETE /me`). Also jibli.org/delete-account on the web. |
| 5.1.1 Registration | No forced sign-up for features that don't need an account | Guests can browse; sign-in is only asked at checkout, orders and profile. |
| 5.1.2 Data use | Data used only for what is declared | Matches the privacy manifest; no ads, no analytics SDK. |
| 4.8 Sign in with Apple | Required only if the app offers Google/Facebook login | Phone + password only, so not required. If Google sign-in is turned on later, Sign in with Apple must be added too. |
| 3.1.1 / 3.1.3(e) Payments | Digital goods must use In-App Purchase | Physical goods delivered, cash on delivery, so no In-App Purchase needed. |
| 2.3 Metadata | Screenshots and description match the app | Use real screenshots in the reviewer's likely language (Arabic or French). |
| 2.5.4 / permissions | Every permission has a clear purpose string; no unused ones | Only camera and photo strings remain (image_picker is linked). Location keys were removed because no location plugin is in the app. |

In the App Review notes, say in English that Jibli is a local delivery app for
M'Sila, Algeria, that payment is cash on delivery, and give the demo account.
Reviewers are outside Algeria, so the demo account matters.

## 9. Submit (Web)

App Store Connect → the app → iOS App → add the build, fill "What's New"
(not needed for 1.0), then Add for Review → Submit. First reviews usually take
one to three days. Release can be manual or automatic after approval.

## Notes

- Push notifications: Firebase is not in the app. Adding push later needs the
  Push Notifications capability on the App ID, an APNs key, and a Firebase iOS
  app for `org.jibli.app`.
- Location: if a feature needs it later, add `NSLocationWhenInUseUsageDescription`
  back with a real reason, plus the matching App Privacy answer (Precise or
  Coarse Location).
- Privacy manifest: the Flutter plugins ship their own manifests. The app's
  manifest declares the collected data and UserDefaults (shared_preferences,
  reason CA92.1). If you add an analytics or crash SDK, update both the
  manifest and the App Privacy answers.
- Supporting iPad: once the app is live with iPad support, a later update
  cannot drop it. If you only want iPhone, change `TARGETED_DEVICE_FAMILY` to
  `1` in Xcode before the first upload.
