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

## Communes data

The client form picks wilaya, daïra and commune from copies of
`packages/shared`. Tests fail when a copy differs.

- Communes and dairas: after a change to `communes.data.json`, run from
  `apps/mobile`:
  `cp ../../packages/shared/src/communes.data.json assets/data/`
- Wilaya names: edit `lib/core/locations/wilayas.dart` to match `wilayas.ts`.
- Review gate: `communes5969Reviewed` in
  `lib/core/locations/algeria_locations.dart` must equal
  `COMMUNES_59_69_REVIEWED` in `communes.ts`.
