# Phone baseline (phase 12b)

Run on 2026-10-28 against `main` (phases 1–12) with `e2e/web/mobile.spec.ts`: every route of
`apps/web/src/app/(app)` and `(auth)` (31 routes, read from the folders), in `ar` and `fr`, at
393 px (`mobile`, Pixel 5) and 360 px (`mobile-360`). 124 checks.

```bash
cd e2e && WEB=http://localhost:3000 API=http://localhost:3001 \
  pnpm exec playwright test --config web/playwright.config.ts --project mobile --project mobile-360
```

The check fails when the page is wider than the screen, or when a box inside it hides content to
the side (a table scrolling in its container hides the amount column), unless the box is marked
`data-scroll-x` (an office table allowed to scroll, docs/ui.md rule 2).

## Status after phase 12b: all fixed

Re-run on 2026-10-28 on the `phase-12b-mobile-ui` branch (production build): **31 of 31 routes
pass** in `ar` and `fr` at 360 and 393 px, plus two interaction checks per locale and width (the
new-versement sheet keeps its save button on screen; the fast sale keeps its total and the validate
button on screen after a line is added). 132 screen checks, 0 failures. The check is also stricter
than for the baseline: it fails when the browser has to zoom the page out to fit it (this caught
the dashboard).

Allowed to scroll inside their own box (`data-scroll-x`, first column pinned): the stock card
(`/stock/[productId]`) and the reports table (`/rapports`), the office tables of docs/ui.md rule 2.

Left as is, with the reason:

- Lighthouse Performance on the signed-in pages is 65–67 (target 80): LCP waits for the session
  refresh call and then the data call, both made from the browser. Moving the session check to the
  server is an architecture change, out of scope for a screens-only phase (see the PR, Parked ideas).

## Baseline (before phase 12b)

### Result: 18 of 31 routes fail

No page scrolls sideways as a whole (the shell already clips its content). Every failure is a
table that hides its columns to the side at phone width:

| Route | Fails at | What |
|---|---|---|
| `/achats` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (736px in 326px) |
| `/achats/[id]` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.overflow-x-auto.rounded-lg.border (736px in 276px) |
| `/achats/nouveau` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.overflow-x-auto.rounded-lg.border (736px in 276px) |
| `/clients` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (736px in 326px) |
| `/clients/[id]` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (672px in 326px) |
| `/parametres/journal` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (704px in 326px) |
| `/parametres/sessions` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (773px in 326px) |
| `/parametres/utilisateurs` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (704px in 326px) |
| `/produits` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (736px in 326px) |
| `/produits/[id]` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.overflow-x-auto.rounded-lg.border (640px in 276px) |
| `/produits/nouveau` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.overflow-x-auto.rounded-lg.border (640px in 276px) |
| `/rapports` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (640px in 326px) |
| `/stock/[productId]` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (736px in 326px) |
| `/stock/inventaires/[id]` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.overflow-x-auto.rounded-lg.border (544px in 326px) |
| `/ventes` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (977px in 326px) |
| `/ventes/[id]` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (704px in 326px) |
| `/ventes/nouvelle` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (704px in 276px) |
| `/versements` | ar 360, ar 393, fr 360, fr 393 | hides content to the side: div.relative.w-full.overflow-x-auto (736px in 326px) |

### Routes that pass

`/achats/fournisseurs`, `/clients/[id]/modifier`, `/clients/nouveau`, `/inscription`, `/invitation/[token]`, `/login`, `/mot-de-passe`, `/parametres`, `/parametres/import`, `/produits/categories`, `/stock`, `/stock/inventaires`, `/tableau-de-bord`

### Seen on the screenshots, not caught by the overflow check

- The header shows the language switcher and theme toggle as separate buttons; on phone they should move into a menu.
- 17 components open a centred `Dialog` / `AlertDialog` on phone (new versement, client, product, stock, users, confirmations).
- `Input` and `NativeSelect` are 36 px tall (`h-9`), below the 44 px touch minimum (the font is already 16 px on phone).
- Forms keep their main action at the end of the page instead of a sticky bar.

## Phase 13 (pilot & billing)

Re-run on 2026-10-28 on `phase-13-pilot-billing` (dev servers): **36 routes**, now including
`/parametres/abonnement`, `/support` and the super-admin area (`/admin/login`, `/admin`,
`/admin/societes/[id]`, signed in with password + TOTP through the real `admin:create` CLI), in
`ar` and `fr` at 360 and 393 px. Extra steps: the onboarding checklist on the dashboard, the
admin code step, and the record-payment sheet (its submit button stays on screen).
164 screen checks, 0 problems.

The PAST_DUE and SUSPENDED banners were checked by hand at 360 px in `ar` (subscription end moved
back in the dev database): one line of text with the "renew" button, no overflow.
