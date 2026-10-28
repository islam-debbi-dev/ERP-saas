Read AGENTS.md and docs/ui.md before doing anything. Then check the skills available in this session and load the UI / design ones before touching a screen (docs/ui.md → Skills).

## Task: Phase 12b — Phone-ready UI: audit and fix every existing screen

Branch: `phase-12b-mobile-ui`. Phases 1–12 are merged. **No business logic, API or schema change in this phase**: screens, shared components, messages files and tests only.

### Why
Traders and sellers open the app on cheap Android phones. Today the web was built and tested on a desktop. Any screen that scrolls sideways, hides its button under the keyboard or clips Arabic text at 360 px loses us the client.

### Steps (commit after each one)
1. **Baseline**: add a `mobile` project to `e2e/web/playwright.config.ts` (`devices['Pixel 5']`) plus a 360 × 640 viewport, and a helper `expectNoHorizontalOverflow(page)`. Add `e2e/web/mobile.spec.ts`, which opens **every route** under `apps/web/src/app/(app)` and `(auth)` (list them from the folders, do not guess) in `ar` and `fr` at both widths. It saves a screenshot to `e2e/artifacts/mobile/` and checks the overflow. Run it and write the list of failing screens to `e2e/artifacts/mobile/BASELINE.md`. A red baseline is expected.
2. **Shared components first**, so the fix spreads to every page:
   - App shell: the header on phone (title, menu button, overflow menu for actions) and the sidebar as a sheet (check RTL: the sheet opens from the right in `ar`).
   - `ResponsiveDialog`: a `Sheet` on phone and a `Dialog` on `md+`. Move every existing dialog onto it (new versement, client form, product form, confirmations).
   - Data table → card list below `md` (docs/ui.md rule 2), with a per-table choice between "cards" and "scroll in its container".
   - `StickyActions` bar for forms (safe-area inset).
   - `Amount` component (nowrap, tabular-nums, LTR isolate, `1 234 567,89 DA`). Replace ad-hoc amount formatting in the components.
   - Inputs: 44 px minimum height, 16 px font, and the right `inputMode` on amount, quantity, phone and search fields.
3. **Pages, in this order** (most used on a phone first): login and password change → fast sale screen (line cards, sticky total + pay button, product search usable with the thumb) → clients list, client detail and relevé → new versement → products list and detail → stock and inventaire count screen → dashboard (cards stacked, charts responsive) → BL/facture list and detail (print = open/share the PDF) → purchases → imports → settings, users, audit log.
4. **Audit**: run the Cloudflare audit skill (or Lighthouse mobile when the skill is missing) on login, dashboard, fast sale, clients list and client detail. Fix the errors. Write the scores before/after in the PR summary.
5. **Re-run** `mobile.spec.ts`: all green at 360 and 393 in `ar` and `fr`. Update `BASELINE.md` to "all fixed" or list what is left, with the reason.

### Rules to respect
- Messages files `ar` / `fr` / `en` keep identical keys (the test checks it); new aria-labels go there too.
- Logical CSS only. No hard-coded strings. No new UI library: build on shadcn/ui and Tailwind already in the repo (AGENTS §2). A new dependency needs a one-line reason in the commit.
- Desktop must not get worse: the existing `web.spec.ts` checks stay green, and you check every changed page at 1280 px too.

### Tests
- `e2e/web/mobile.spec.ts` green (both widths, both locales, every route).
- Existing web unit tests and `e2e` web checks green; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually (DevTools at 360 px in `ar` + a real Android phone) / Decisions / audit scores / Next phase (13 Pilot & billing).
