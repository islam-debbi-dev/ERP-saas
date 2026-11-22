# Debvora: the field app

Flutter app for the field staff of a grossiste using this ERP: vendeur,
livreur, superviseur, magasinier. It talks to the NestJS API of this repo
(`apps/api`) and never decides a right the API does not enforce.

- Phase plan: `docs/prompts/phase-39-mobile-field-app.md` (repo root).
- Run locally: `docs/local-development.md`.
- Branding (colours, name, icons): `docs/branding.md`.
- Android release: `docs/play-store-release.md`.

```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter analyze
flutter test
flutter run
```

`apps/mobile` is not a pnpm package: pnpm and turbo ignore it.
