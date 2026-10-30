@AGENTS.md

Claude Code specifics:
- Start each phase in a fresh session (`/clear`) and paste the phase prompt from `docs/prompts/`.
- Use plan mode for the first message of a phase; implement only after the plan matches the prompt.
- Save tokens with the `/graphify` skill: before reading or grepping widely, query the codebase knowledge graph (`graphify-out/`, git-ignored) to find the files a task touches, then open only those. If the graph is missing or older than the last merge, rebuild it with `/graphify` first.
- Read `docs/domain.md`, `docs/architecture.md` and `docs/ui.md` only when the task needs them, not up front every time.
- Phases with screens: load your UI / design skills before building them, and run the Cloudflare audit skill on the changed pages before finishing (`docs/ui.md` → Skills).
