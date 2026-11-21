# Publishing Debvora on Google Play

Debvora is signed with its **own** upload key. The key of the app this code was
copied from must never be used, copied into this repo or referenced here.
Until the key below exists, release builds are signed with the debug key
(`android/app/build.gradle.kts`): fine for testing on a phone, refused by Play.

## 1. One-time: create the Debvora upload keystore (on the owner's Mac)

```bash
mkdir -p ~/keystores/debvora
keytool -genkeypair -v \
  -keystore ~/keystores/debvora/upload-keystore.jks \
  -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload \
  -dname "CN=Debvora, O=Debvora, C=DZ"
```

Back the `.jks` file and its password up somewhere safe (password manager plus
an offline copy). Never commit it: `*.jks`, `*.keystore` and `key.properties`
are gitignored. With Play App Signing (the default) Google holds the real app
signing key and this is only the upload key; a lost upload key can be reset
through Play support, but that takes days.

Then create `android/key.properties` (gitignored) from
`android/key.properties.example`:

```properties
storePassword=<the keystore password>
keyPassword=<the key password; same as storePassword for PKCS12>
keyAlias=upload
storeFile=/Users/<you>/keystores/debvora/upload-keystore.jks
```

and give the release build type a signing config that reads it, in
`android/app/build.gradle.kts`:

```kotlin
val keystoreProperties = java.util.Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}
// inside android { }
signingConfigs {
    create("release") {
        keyAlias = keystoreProperties.getProperty("keyAlias")
        keyPassword = keystoreProperties.getProperty("keyPassword")
        storeFile = file(keystoreProperties.getProperty("storeFile"))
        storePassword = keystoreProperties.getProperty("storePassword")
    }
}
buildTypes { release { signingConfig = signingConfigs.getByName("release") } }
```

Debug builds and CI keep using the debug key.

## 2. Point the build at production

Create `assets/config/env.default` (gitignored) from `.env.example` and set:

```
API_BASE_URL=https://api.jibli.org/api/v1
```

(Use whatever `API_DOMAIN` is in `infra/.env` on the VPS.) You can also pass
`--dart-define=API_BASE_URL=...` to the build command instead.

## 3. Bump the version

In `pubspec.yaml`, `version: 1.0.0+1` means versionName `1.0.0`, versionCode
`1`. Every upload to Play needs a higher number after the `+`.

## 4. Build the bundle

```bash
cd mobile
flutter clean
flutter pub get
flutter build appbundle --release
```

Output: `build/app/outputs/bundle/release/app-release.aab`.

If `key.properties` is missing, the build silently signs with the debug key and
Play will refuse the upload, so check that step 1 is done.

The package id changed from `com.example.soft_smart_app_front`, so uninstall
the old app from test phones once; Android treats it as a different app.

## 5. Play Console

1. Developer account at https://play.google.com/console (one-time 25 USD).
   Decide first whether the account is yours or the client's: transferring an
   app between accounts later is possible but slow.
2. Create app → name "Jibli", default language, App, Free.
3. Fill the "Set up your app" tasks: privacy policy URL (required, host it on
   jibli.org), app access (give reviewers a test login), ads, content rating,
   target audience, data safety (the app collects name, phone, address and
   order history), government apps, financial features.
4. Store listing: short and full description, 512x512 icon, 1024x500 feature
   graphic, at least 2 phone screenshots.
5. Testing → Closed testing → create a release, upload the `.aab`.
   New personal developer accounts must run a closed test with at least 12
   testers for 14 days before they can apply for production access.
   Organisation accounts can go straight to production.
6. After the test period: Production → create release → upload → send for
   review (usually a few days for a first app).

## Notes

- Firebase: `android/app/google-services.json` is registered for the old
  package id and Firebase is not initialised anywhere in `lib/`, so the
  google-services Gradle plugin was removed. To add push notifications later,
  register an Android app for `org.jibli.app` in Firebase, download a new
  `google-services.json`, and re-add the plugin.
- The Fastlane Firebase App Distribution lane now reads its token from the
  `FIREBASE_TOKEN` environment variable. The token that used to be committed
  there must be revoked (`firebase logout --token <old token>` or
  re-run `firebase login:ci` and stop using the old one).
- Location, camera and media permissions were removed from the manifest because
  no code uses them. If a feature needs one later, add it back together with
  the matching Play Console declaration.
