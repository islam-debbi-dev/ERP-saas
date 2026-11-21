# White-label client onboarding

This document explains how to hand this Flutter codebase to a client as a
rebranded, sellable product. Per client you get one checkout: edit the env file
(and a handful of native/cloud settings that cannot be done via `.env`), run the
two renaming tools, and build a branded APK / IPA.

Everything that can be controlled by config lives in **one file**:
`assets/config/env.default`. The rest of this doc is the (unavoidably native)
companion checklist.

---

## 1. Runtime branding — the env file (no rebuild of code)

1. Copy `assets/config/env.default` into the working tree (it is gitignored —
   a fresh clone needs the copy). Template: `.env.example`.
2. Open `assets/config/env.default` and set:

| Key | What it does | Example |
| --- | --- | --- |
| `APP_NAME` | In-app name (MaterialApp `title`, task switcher label, auth screen, onboarding, notification fallback) | `Acme Market` |
| `APP_PRIMARY_COLOR` | Primary brand seed — whole theme derives from it | `#1B7F5E` |
| `APP_SECONDARY_COLOR` | Secondary brand seed / accent | `#F2B33D` |
| `APP_LOGO_ASSET` | Logo drawn on the auth screen. Replace `assets/main-logo.png`, or point this at another bundled asset | `assets/main-logo.png` |
| `SUPPORT_EMAIL` | Contact address in Help Center | `help@acme.com` |
| `PRIVACY_EMAIL` | Contact address in Privacy Policy | `privacy@acme.com` |
| `API_BASE_URL` | Backend base URL. **Empty = compiled-in fallback** (`ApiConstants.baseUrl`, a non-routable `https://api.example.com` placeholder) | `https://api.acme.com` |
| `GOOGLE_WEB_CLIENT_ID` | Enable the Google button (see 4) | `xxxx.apps.googleusercontent.com` |
| `APPLE_SERVICE_ID` | Enable the “Continue with Apple” button (see 6) | `com.example.app.signin` |

Precedence for every key: `--dart-define=KEY=value` > `assets/config/env.default`
> hardcoded fallback.

> **Social auth buttons are shown only when the matching key is non-empty.** If
> all three are empty, the login screen shows no social buttons at all.

### Build-time override (optional)
```sh
flutter run --dart-define=APP_NAME=MyBrand --dart-define=APP_PRIMARY_COLOR=#123456
```

---

## 2. Native identity (must be done per client — cannot be `.env`d)

Run once per client, in this order:

```sh
# 1) Application (bundle) identifier, e.g. com.client.company
flutter pub run change_app_package_name:main com.client.company

# 2) Human-readable app/product name + info plist label
flutter pub run package_rename package --name "Client App" \
  --org "com.client" --domain "company.com"

# 3) Launcher icon (uses assets/main-logo.png; edit the image, then:)
flutter pub run flutter_launcher_icons
```

- Home-screen launcher label = `package_rename` output (Android label /
  iOS `CFBundleDisplayName`). The `.env` `APP_NAME` only affects runtime
  strings (e.g. the task-switcher title).
- Always rebuild after renaming: `flutter clean && flutter pub get`.

---

## 3. Backend that must exist

- `POST /auth/login`, `POST /auth/register` (email/password).
- Social login: `POST /auth/{provider}` where `{provider}` ∈ `google`,
  `apple`. Body (`application/json`):

  ```json
  { "token": "<provider ID token/access token>", "socialAuth": "<provider>" }
  ```

  Response = same `ResAuth` shape as `/auth/login` (contains `token`, `role`, …).

- Any other endpoints referenced in `lib/core/service/api_constants.dart`
  (products, stores, orders, delivery, notifications, analytics). Point
  `API_BASE_URL` at the client’s backend instance.

---

## 4. Google sign-in setup

Runtime: `GOOGLE_WEB_CLIENT_ID` = the **Web application (server) client id**
from Google Cloud Console → Credentials. The app sends the resulting ID token
to your backend for verification.

Per-client native + cloud, required regardless of the env key:

1. Google Cloud project with the OAuth **client id** for the app’s package name
   (Android) and bundle id (iOS), plus SHA-1 fingerprints.
2. Replace `android/app/google-services.json` (regenerate, then it also feeds
   the existing Firebase/FCM setup) and `ios/Runner/GoogleService-Info.plist`
   for the client’s own project/app.
3. Verify `google_sign_in` on iOS with a real device — the simulator ignores
   the Sign-In sheet’s keychain in some Flutter versions.

## 5. Sign in with Apple

Runtime: `APPLE_SERVICE_ID` = your Services ID (reverse-domain string) from
developer.apple.com.

Per-client native (never renders on Android):
- Xcode → Target → “Sign in with Apple” capability enabled, bundle id must be
  registered with your Apple Developer team.
- Backend verifies the identity token; `sign_in_with_apple` supplies scopes
  `email` + `fullName`.

---

## 6. Verify per client

```sh
flutter analyze          # must stay at baseline (no errors)
flutter test             # includes social-auth-buttons visibility tests
flutter build apk --release
flutter build ios --release    # on macOS, after the native steps above
```

Manual smoke test on a real device:
1. Splash clears, colors/app name match the two env seeds.
2. Sign-in page: social buttons appear exactly for enabled providers.
3. Google / Apple flows each sign in and land on the app.

---

## Helpers in the code

- `lib/core/config/app_env.dart` — reads env with `--dart-define` > `.env` >
  fallback for every key, exposes `hasGoogleAuth` /
  `hasAppleAuth`, plus `appName` / `logoAsset` / `supportEmail` /
  `privacyEmail`. All hardcoded fallbacks are deliberately brand-neutral, so a
  forgotten key shows a generic placeholder instead of the previous client.
- `lib/core/components/brand_logo.dart` — auth-screen logo. Renders
  `AppEnv.logoAsset`; the scale+fade animation carries no per-client colors or
  geometry, so replacing the asset is the only step needed.
- `lib/features/auth/ui/widgets/social_auth_buttons.dart` — renders the social
  row; **empty providers → nothing rendered** (no stray “or”/divider).
- `lib/core/theme/app_theme*.dart` — theme derived from the two color seeds.
- `test/features/auth/social_auth_buttons_test.dart` — documents the
  show/hide contract.

## Adding a new client-specific value

Don't hardcode it. Add a key to `AppEnv` (a `String.fromEnvironment` const, a
getter using the `_str` helper, and a brand-neutral fallback), list it in
`assets/config/env.default` and `.env.example`, document it in the table above,
then consume it. `lib/` should contain **no** client names, emails, or backend
hosts.