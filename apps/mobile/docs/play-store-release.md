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
API_BASE_URL=https://erp-saas-pi.vercel.app
DASHBOARD_URL=https://<the web dashboard>
```

No `/api/v1` suffix: the API has no global prefix. You can also pass
`--dart-define=API_BASE_URL=...` to the build command instead.

## 3. Bump the version

In `pubspec.yaml`, `version: 1.0.0+1` means versionName `1.0.0`, versionCode
`1`. Every upload to Play needs a higher number after the `+`.

## 4. Build the bundle

```bash
cd apps/mobile
flutter clean
flutter pub get
flutter build appbundle --release
```

Output: `build/app/outputs/bundle/release/app-release.aab`.
Check that step 1 is done: without the Debvora signing config the bundle is
signed with the debug key and Play refuses the upload.

## 5. Play Console

1. Developer account at https://play.google.com/console (one-time 25 USD),
   owned by the Debvora company account.
2. Create app → name "Debvora", default language Arabic, App, Free.
3. Fill the "Set up your app" tasks: privacy policy URL (required; a public
   page still has to be published), app access (give reviewers a test login of
   a demo seller), ads (none), content rating, target audience (adults, work
   app), data safety (name, phone, precise location at sale / versement / visit
   time only, business data of the grossiste), financial features (none: the
   app records sales and payments, it does not move money).
4. Store listing: short and full description in ar / fr, 512x512 icon,
   1024x500 feature graphic, at least 2 phone screenshots.
5. Testing → Closed testing → create a release, upload the `.aab`. A new
   personal developer account must run a closed test with at least 12 testers
   for 14 days; an organisation account can go straight to production.
6. Production → create release → upload → send for review.

## Notes

- Package id: `com.debvora.app` (`package_rename_config.yaml`, applied with
  `dart run package_rename`). It can never change once published.
- No Firebase and no push notifications for now (parked).
- Location (GPS at sale time) and camera (barcode scan) permissions are added
  with the features that use them, together with the matching Play Console
  declarations.
