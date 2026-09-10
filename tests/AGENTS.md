# Tests

Local constraints only. Root [`AGENTS.md`](../AGENTS.md) is canonical.

Risk layers stay: `unit` (domain/pure rules), `integration` (D1/R2/HTTP/atomicity), `browser` (React contracts), `e2e` (two-origin journeys). `fixtures/` and `support/` are helpers — do not add them to Vitest/Playwright discovery.

Run from the repository root. Do not change business expectations to match a layout refactor. Do not move tests into apps or packages.
