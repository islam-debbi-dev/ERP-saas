# UI rules: phone first

Our users are traders and sellers. Many of them only have a mid-range Android phone with Chrome, and sellers use the app in the street. **Every screen must work on a phone as well as on a desktop.** A screen that is broken at phone width is a bug, and so is a missing RTL check.

Sizes to support:

| Size | Width × height | What it is |
|---|---|---|
| Small phone | 360 × 640 | the minimum, test it every time |
| Phone | 393 × 851 (Pixel 5) | Playwright `mobile` project |
| Tablet | 768 × 1024 | |
| Desktop | 1280 × 800 and wider | the office |

Arabic (RTL) is the default language, so check every screen in `ar` first, then in `fr`.

## Rules

1. **No horizontal page scroll** at 360 px. The sidebar becomes a sheet (`components/ui/sidebar.tsx` already does it). Header actions move into a menu.
2. **Lists and tables**: below `md`, show a **card list**. Each card has the main fields, the amount, the status and its actions in a menu. Lists used on the road (clients, products, documents, today's tournée, versements) must use cards. Big office tables (reports, stock card) can scroll inside their own container instead, with the first column sticky. Lists that grow use a "load more" button (cursor pagination).
3. **Forms**: one column on phone with labels above the fields. Inputs are at least 44 px tall and use a 16 px font, so iOS does not zoom. Use `inputMode="decimal"` for amounts and quantities, `inputMode="tel"` for phone numbers and `type="search"` for search fields. The main action sits in a **sticky bottom bar** (`pb-[env(safe-area-inset-bottom)]`). The keyboard must never hide the field being typed in.
4. **Dialogs**: on phone, open as a bottom or full-screen `Sheet`. On `md` and up, open as a centred `Dialog`. Use one shared `ResponsiveDialog` component, never two copies of a form.
5. **Touch**: targets are at least 44 × 44 px with 8 px between them. Nothing works only on hover: every tooltip or hover menu needs a tap equivalent.
6. **Amounts and numbers**: an amount never wraps in the middle (`whitespace-nowrap`, `tabular-nums`). Inside RTL text it stays left-to-right (`dir="ltr"` or `unicode-bidi: isolate` on the amount span). Use one shared `Amount` component.
7. **RTL**: use logical classes only (`ms-`, `pe-`, `start-`, `end-`, `text-start`). Direction icons (arrows, chevrons, "back") flip with `rtl:rotate-180`. Test long Arabic and French labels: no clipped buttons.
8. **Long text**: names truncate on one line, and a tap shows the full text. Never let a long client name push the amount off the screen.
9. **Charts**: use a responsive container, put the legend under the chart on phone and show fewer axis ticks.
10. **Slow phones, slow network**: show skeletons instead of blank screens and avoid layout shift. Virtualise lists above 200 rows. Lazy-load images. Show a clear message when the network is down, never a frozen button. Disable a submit button while its request runs (and the `Idempotency-Key` makes double taps safe anyway).
11. **Printing on phone**: "Imprimer" opens or shares the server PDF (download, WhatsApp share). Never use `window.print()` on the page.
12. **Accessibility**: every input has a label, every icon button has an `aria-label` (in the messages files), and colour contrast is at least 4.5:1. Status is never shown by colour alone.

## Building blocks (use them, do not rebuild them)

| Need | Use |
|---|---|
| A dialog or a confirmation | `components/ui/responsive-dialog.tsx` (bottom sheet below `md`, centred from `md`); `AlertDialog` shares the same layout. Width with `md:max-w-*`. |
| A list | `DataTable` (cards below `md`): give each column `meta: { card: 'title' \| 'subtitle' \| 'end' \| 'badge' \| 'leading' \| 'actions' \| 'hidden' }`; `mobile="scroll"` only for office tables. |
| A small table written by hand | add `stack-table` on the `<table>` and `data-label` / `data-cell="main\|actions\|end"` on the cells: rows become cards below `md`. |
| Header buttons | `PageHeader`: `actions` stay visible, `more` (back, edit, cancel…) fold into one menu on a phone. |
| The main action of a form | `StickyActions` (fixed above the home indicator on a phone, a plain row from `md`). |
| An amount | `<Amount value={…} />` (never `{formatDA(…)}` in JSX). |
| Print | `PrintButton` / `usePrint`: a new tab on a computer, the share sheet or the downloads on a phone. |

## Tests (every phase that adds or changes a screen)

- **Playwright mobile project**: `e2e/web/playwright.config.ts` has a `mobile` project (`devices['Pixel 5']`), and a 360 × 640 check runs too. Each new screen gets a test that opens it in `ar` at phone size and asserts:
  - no horizontal overflow: `document.documentElement.scrollWidth <= window.innerWidth`;
  - the main action is visible and clickable without scrolling sideways;
  - a screenshot is saved in `e2e/artifacts/mobile/<screen>-<locale>-<width>.png` for review.
- `e2e/web/mobile.spec.ts` already opens **every route** (read from the app folders) in `ar` and `fr` at 393 px (`mobile`) and 360 px (`mobile-360`), and fails when the page or a box inside it scrolls sideways, or when the browser has to zoom the page out. A new page is covered without touching it; add a step there for a new dialog or a new main action.
- Run it with `cd e2e && WEB=http://localhost:3000 API=http://localhost:3001 pnpm test:web` (all projects) or add `-- --project mobile --project mobile-360`.
- **Lighthouse (mobile)** on the main pages you changed: Performance ≥ 80 and Accessibility ≥ 90. Write the scores in the PR summary.
- By hand, once per phase: Chrome DevTools device toolbar at 360 px in `ar`, then a real Android phone if the phase adds a screen sellers use on the road.

## Skills (Claude Code on the owner's Mac)

The owner has **UI / design skills** and a **Cloudflare audit skill** installed in Claude Code.

- **Before building or changing screens**, check the skills available in the session and load the UI / design ones. Follow them for layout, spacing, components and visual polish. When a skill and this file disagree, this file wins on the rules above (phone first, RTL, accessibility); the skill wins on visual style.
- **At the end of the phase**, run the Cloudflare audit skill on the pages you changed (performance, accessibility, best practices, security headers). Fix what it reports as an error. List the rest in the PR summary under "Decisions" or "Parked ideas".
- If a skill is not available in the session, say so in the summary and apply this file alone.
