@AGENTS.md

Claude Code specifics:
- Start each phase in a fresh session (`/clear`) and paste the phase prompt from `docs/prompts/`.
- Use plan mode for the first message of a phase; implement only after the plan matches the prompt.
- Read `docs/domain.md`, `docs/architecture.md` and `docs/ui.md` only when the task needs them, not up front every time.
- Phases with screens: load your UI / design skills before building them, and run the Cloudflare audit skill on the changed pages before finishing (`docs/ui.md` → Skills).
