# Running the app against a local backend

## 1. Start the API

```bash
cd backend
npm run dev            # http://localhost:5001, needs MongoDB (docker compose up -d mongo)
npm run seed           # demo data, incl. generated product photos and store logos/covers
```

Images are served by the API itself:

| URL | What |
|---|---|
| `/media/<id>/<thumb\|small\|medium\|large\|xlarge>` | optimized variants (WebP, JPEG fallback), `immutable` cache |
| `/uploads/...` | legacy files uploaded before the optimized pipeline |

Every image URL in an API response is rebuilt on the host the app called
(`backend/src/lib/publicUrls.js`), so the app always receives URLs it can reach.
In production (`NODE_ENV=production`) they use `PUBLIC_BASE_URL` instead.

## 2. Point the app at it

Set `API_BASE_URL` in `assets/config/env.default` (or pass
`--dart-define=API_BASE_URL=...`):

| Target | `API_BASE_URL` | Why |
|---|---|---|
| iOS simulator | `http://localhost:5001/api/v1` | the simulator shares the Mac's network |
| Android emulator | `http://10.0.2.2:5001/api/v1` | `localhost` is the emulator itself; `10.0.2.2` is the Mac |
| Real phone (same Wi-Fi) | `http://<Mac LAN IP>:5001/api/v1` | find it with `ipconfig getifaddr en0` |

Plain HTTP is allowed only for local development:

- iOS: `NSAllowsLocalNetworking` in `ios/Runner/Info.plist` (localhost, LAN IPs,
  `*.local`). Internet hosts still require HTTPS.
- Android: `usesCleartextTraffic` in `AndroidManifest.xml`.

## 3. Debugging images

In debug builds `NetImage` logs every failure:

```
NetImage failed: <url> → <error>
```

`Failed host lookup` / `Connection refused` means the URL's host is wrong for
this device (check `API_BASE_URL`). A 404 on `/uploads/...` means the file is
not in the API's `UPLOAD_DIR`.

## 4. Migrating old images

Images uploaded before the optimized pipeline keep working. To give them
thumbnails, blur placeholders and WebP:

```bash
cd backend
mongodump --uri "$MONGODB_URI" --out backup-$(date +%F)   # back up first
npm run images:migrate -- --dry-run                         # report only
npm run images:migrate                                      # safe to re-run
```

Original files in `UPLOAD_DIR` are never deleted.
