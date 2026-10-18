@AGENTS.md

Claude Code specifics:
- Start each phase in a fresh session (`/clear`) and paste the phase prompt from `docs/prompts/`.
- Use plan mode for the first message of a phase; implement only after the plan matches the prompt.
- Read `docs/domain.md` and `docs/architecture.md` only when the task needs them, not up front every time.
