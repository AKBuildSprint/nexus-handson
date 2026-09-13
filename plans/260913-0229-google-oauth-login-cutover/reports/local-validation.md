# Local validation

Validated on 2026-09-13 from the repository root.

- TDD red: the initial Google OAuth integration test failed because Google provisioning and the social sign-in route did not exist.
- Focused Google OAuth, auth runtime, route, schema, and concurrency tests passed after implementation.
- `npm test`: 230 workerd tests and 62 browser tests passed.
- `npm run build`: typecheck, Console/Worker production build, and production import-graph check passed.
- `npm run verification:s4-rehearsal:test`: 6 Node operator tests passed with migrations through 0011.
- `npm run test:e2e`: 30 Playwright tests passed, including 375 px and multi-tab Owner-to-Staff identity replacement.
- `git diff --check` passed.

The Google authorization-code exchange is stubbed in automated tests. No real Google consent, remote migration, remote provisioning, deployment, or remote smoke was performed.
