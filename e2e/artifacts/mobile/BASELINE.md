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

## Result: 18 of 31 routes fail

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

## Routes that pass

`/achats/fournisseurs`, `/clients/[id]/modifier`, `/clients/nouveau`, `/inscription`, `/invitation/[token]`, `/login`, `/mot-de-passe`, `/parametres`, `/parametres/import`, `/produits/categories`, `/stock`, `/stock/inventaires`, `/tableau-de-bord`

## Seen on the screenshots, not caught by the overflow check

- The header shows the language switcher and theme toggle as separate buttons; on phone they should move into a menu.
- 17 components open a centred `Dialog` / `AlertDialog` on phone (new versement, client, product, stock, users, confirmations).
- `Input` and `NativeSelect` are 36 px tall (`h-9`), below the 44 px touch minimum (the font is already 16 px on phone).
- Forms keep their main action at the end of the page instead of a sticky bar.
