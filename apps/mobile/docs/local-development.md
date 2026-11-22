# Running the app against a local API

## 1. Start the API and the web dashboard

From the repo root (see the root README / AGENTS.md §6):

```bash
docker compose -f infra/docker-compose.yml up -d db db_test
pnpm db:migrate
pnpm db:seed          # demo tenant "Grossiste Demo" with a seller, a livreur, ...
pnpm dev              # API on http://localhost:3001, web on http://localhost:3000
```

## 2. Point the app at it

Copy `.env.example` to `assets/config/env.default` and set `API_BASE_URL`
(or pass `--dart-define=API_BASE_URL=...`):

| Target | `API_BASE_URL` | Why |
|---|---|---|
| Android emulator | `http://10.0.2.2:3001` | `localhost` is the emulator itself; `10.0.2.2` is the Mac |
| iOS simulator | `http://localhost:3001` | the simulator shares the Mac's network |
| Real phone (same Wi-Fi) | `http://<Mac LAN IP>:3001` | find it with `ipconfig getifaddr en0` |

Set `DASHBOARD_URL` the same way with port 3000 to test the "office role"
refusal link.

Plain HTTP is allowed only in development:

- Android: `usesCleartextTraffic` in `android/app/src/debug/AndroidManifest.xml`
  (debug builds only).
- iOS: `NSAllowsLocalNetworking` in `ios/Runner/Info.plist` (localhost, LAN
  IPs, `*.local`). Internet hosts still require HTTPS.

## 3. The app identifies itself as a native client

Every request carries `X-Client-Type: native`, so the API returns the refresh
token in the login / refresh body (the web uses a cookie) and counts the phone
as a mobile seat of the plan.
