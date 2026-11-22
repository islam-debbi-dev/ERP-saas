# Branding

Debvora's brand lives in three places. The final colours and logo are not
decided yet; until then the app uses the current colours and a text logo.

## 1. Colours and texts: the env file (no code change)

`assets/config/env.default` (gitignored, created from `.env.example`), or
`--dart-define=KEY=value` at build time:

| Key | Use |
|---|---|
| `APP_NAME` | in-app name (wordmark, task switcher) |
| `APP_PRIMARY_COLOR` | brand accent `"#RRGGBB"` (quoted: an unquoted # starts a comment); its deep and tint shades are derived |
| `APP_SECONDARY_COLOR` | action colour (buttons, active tab), shown with a contrasting text |
| `SUPPORT_EMAIL`, `PRIVACY_EMAIL` | help and privacy screens |

Every colour in the widgets comes from `AppColors` (`lib/core/theme/app_theme.dart`)
or `Theme.of(context)`: brand colours from the two env keys, neutrals
(greys, success, error) as fixed tokens. Do not write a hex colour in a widget.

## 2. Native identity: `package_rename_config.yaml`

Launcher label, Android `applicationId` and iOS bundle id. Apply with:

```bash
dart run package_rename
```

## 3. Launcher icon and splash

Images in `assets/branding/` (today a text placeholder). Regenerate with:

```bash
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```

The in-app logo is `lib/core/components/logo/debvora_logo.dart`
(`DebvoraWordmark`, `BrandLoader`): replace it when the real logo arrives.
