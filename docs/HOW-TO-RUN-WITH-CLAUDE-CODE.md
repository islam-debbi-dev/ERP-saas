# How to build this with Claude Code (and save tokens)

## One-time setup
1. Install Node 20+, pnpm 9+, Docker, Git, and Claude Code (`npm i -g @anthropic-ai/claude-code`).
2. `git clone https://github.com/islam-debbi-dev/ERP-saas && cd ERP-saas`
3. Run `claude` in the repo root. `CLAUDE.md` imports `AGENTS.md`, so the rules load automatically in every session. You never need to paste them.

## For each phase (repeat for every phase, in the order given in `docs/ROADMAP.md`)
1. `git checkout main && git pull` then `git checkout -b phase-NN-name`.
2. In Claude Code: `/clear` (fresh context = fewer tokens and no confusion from the previous phase).
3. Press **Shift+Tab** to switch to **plan mode**, then send:
   ```
   Do the task in @docs/prompts/phase-NN-name.md
   ```
   The `@` reference loads only that file. Check the plan: same scope as the prompt, nothing extra. Correct it before approving.
4. Phases with screens: your UI / design skills and the Cloudflare audit skill are installed in Claude Code on your Mac. The prompts tell Claude to load them, but check the plan names them; if not, say "load my UI skills first and run the Cloudflare audit at the end".
5. Approve the plan and let it work. If a step is big (phases 1, 6, 8), tell it to commit after each section.
6. When it says it's done, verify yourself:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
   Then follow its "How to test manually" list in the browser, on the desktop **and** in Chrome DevTools at 360 px in Arabic (and on your phone for screens sellers use outside).
7. Optional but worth it on phases 1, 3, 6, 7: run `/code-review` (or `/security-review` on 1 and 11) and fix what it finds.
8. Push, open a PR, merge into main. Next phase.

## Token-saving habits
- **One phase = one session.** Don't continue phase 7 in the phase 6 conversation. Use `/clear` between phases and `/compact` if a single phase gets long.
- **Point at files, don't paste them.** `@docs/domain.md` instead of copying text.
- **Don't ask it to read the whole repo.** The prompts say which docs to read; for code, name the module (`apps/api/src/sales`).
- **Fix forward with short messages.** "test X fails with Y, fix it" beats re-explaining the phase.
- **Use a cheaper model for small stuff.** `/model` to switch to Sonnet or Haiku for renames, UI text, small fixes; keep Opus for phases 1, 3, 6, 7, 8, 12.
- **Keep AGENTS.md short and true.** If you keep correcting the same thing, add one line to AGENTS.md instead of repeating it every session.

## When you'll need to step in
- Phase 8: check the PDF looks right on paper (print a real A5) and verify the timbre fiscal values against the current loi de finances.
- Phase 9: test with a real Excel file from your pilot grossiste before calling it done.
- Phase 12: you choose and pay for hosting and the backup bucket, and create the Sentry / uptime accounts.
- Phase 13: decide the prices in DZD.
- Phase 13b: decide which modules each plan includes (the prompt has a starting list).
- Phase 15: run the backfill script on staging first and compare stock totals before touching production.
- Phase 18: collect the real bonus rules (Excel files) of your pilot distributor and check that the five rule types cover them before starting.
- Phase 19: install Flutter and Android Studio, test on a real cheap Android phone and a real Bluetooth thermal printer.
- Phase 22: get a real dossier d'importation (invoices, douane, transitaire) from an importer to test the allocation.

## If something goes wrong
- Tests red and it keeps going in circles: `/clear`, then "Read AGENTS.md. On branch phase-NN, `pnpm test` fails with: <paste the error>. Find the cause and fix it."
- It built something outside the phase: tell it to revert that part and list it under "Parked ideas".
- A money or stock bug in an earlier phase: fix it on its own branch first (`fix/...`) with a test that reproduces it, then continue.
