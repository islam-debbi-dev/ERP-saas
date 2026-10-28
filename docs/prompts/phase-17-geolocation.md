Read AGENTS.md and docs/domain.md (Sales force & distribution → Géolocalisation) before doing anything.

## Task: Phase 17 — Géolocalisation: invoice at the client's place, or flagged

Branch: `phase-17-geolocation`. Phases 1–14 are merged (16 too if done; visits get GPS only when it is). Feature flag: `GEO_CHECK`.

### Goal
When a seller creates a sale (and a versement or a visit), the app sends where he is. The API compares it with the client's saved location. Far away → the document is **flagged** and needs a note; the manager reviews flags. By default we flag, we do not block: GPS is often wrong indoors and a blocked real sale costs the client money.

### Domain rules to respect
- Tenant settings: `geoCheckMode` `OFF` / `FLAG` / `BLOCK` (default `FLAG` when the feature is on), `geoRadiusM` (default 150), `geoMaxAccuracyM` (default 200).
- **Client location is the reference**: `Client.lat`, `Client.lng` (`Decimal(9,6)`), `geoAccuracyM`, `geoSetAt`, `geoSetBy`.
  - Set once freely (first visit, or by a manager on the map). Any later change by a SELLER creates a `ClientGeoChangeRequest` (`PENDING` / `APPROVED` / `REJECTED`) that a MANAGER+ or the seller's SUPERVISOR approves. Approved changes are audited (before/after).
- **GeoCheck** append-only (tenantId, refType `SALE` / `PAYMENT` / `VISIT`, refId, userId, lat, lng, accuracyM, isMocked, capturedAt (device), receivedAt (server), distanceM, status, note, reviewStatus `NONE` / `JUSTIFIED` / `NOT_JUSTIFIED`, reviewedBy, reviewedAt). One row per document. A review is stored as a new `GeoCheckReview` row (append-only) and the cached `reviewStatus` is updated in the same transaction.
- **The API decides**, the client only sends raw data. The `geo` object is optional on `POST /sales`, `POST /payments`, `POST /visits` (zod schema in `packages/shared`). The check is written in the same transaction as the document.
- Status, first match wins:
  1. no geo sent → `NO_SIGNAL`
  2. `isMocked` → `MOCKED`
  3. accuracy > `geoMaxAccuracyM` → `LOW_ACCURACY`
  4. client has no location → `NO_CLIENT_GPS` (and the response offers to save this point as the client location)
  5. distance ≤ radius + accuracy → `OK`, else `FAR`
- Independently of the status, `GeoCheck.flags String[]` gets `LATE_SYNC` when capturedAt is more than 2 h before receivedAt (offline replay).
- Any status other than `OK` and `NO_CLIENT_GPS` requires a `note` (`GEO_NOTE_REQUIRED`). In `BLOCK` mode `FAR` and `MOCKED` are refused (`GEO_TOO_FAR`, `GEO_MOCKED`) unless the user has the new permission `GEO_OVERRIDE`.
- Client comptoir sales (no client) are not checked.
- Distance: Haversine in `packages/shared/geo.ts`, unit tested. No PostGIS.
- **Privacy (law 18-07)**: location is captured only at the moment of an operation, never tracked continuously. Add a one-line notice in the seller UI and in the tenant settings page. Do not add background tracking.

### API
- `PATCH /clients/:id/location`, `POST /clients/:id/location-requests`, `POST /location-requests/:id/approve|reject`.
- `GET /geo-checks?status=&sellerId=&from=&to=&reviewStatus=` (cursor), `POST /geo-checks/:id/review`.
- Report: flags per seller per month (used by phase 18 gates).

### Web
- Browser geolocation (`navigator.geolocation`, high accuracy, 10 s timeout) on the sale and versement screens when the feature is on; the note field appears when the API answers that a note is required.
- "Opérations signalées" page: list + map (react-leaflet with OpenStreetMap tiles) showing the client point, the operation point and the distance; justify / not justified buttons.
- Client page: map with the saved location, pending change requests.
- All strings in ar / fr / en.

### Tests
- Unit: Haversine (known city pairs), status rules table (each branch), radius + accuracy edge.
- Integration: sale with geo OK / FAR / MOCKED / no client GPS in FLAG and BLOCK modes; note required; `GEO_OVERRIDE`; idempotent replay of a sale does not create a second GeoCheck; seller change request flow; review audited; feature off → geo ignored, no rows; tenant isolation.

### Not in this phase
Continuous tracking, route playback, geofenced check-in reminders (parked).

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (18 Objectifs & primes).
