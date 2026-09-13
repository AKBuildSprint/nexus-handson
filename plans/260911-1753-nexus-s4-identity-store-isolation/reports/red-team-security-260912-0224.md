# Security red-team review: S4 identity and Store isolation plan

Scope: `plans/260911-1753-nexus-s4-identity-store-isolation/{plan.md,contracts.md,acceptance.md,phase-01..08*.md}` plus relevant Worker, test, Better Auth 1.7.4 tagged source, and current Playwright/test helpers.

Review constraints honored: plan review only; no tests/build/install; no plan/code edits besides this report.

## Findings

### High: `/api/auth/*` exposes more native Better Auth surface than the S4 contract needs

Phase/section: `phase-03-authenticated-context.md` Requirements/Architecture and `phase-01-start.md` configuration contract.

Failure: the plan mounts every `/api/auth/*` GET/POST directly to Better Auth and returns the library response unchanged (`phase-03-authenticated-context.md:37`, `phase-03-authenticated-context.md:52-55`, `phase-03-authenticated-context.md:121-125`). S4 only needs sign-in, sign-out/session bootstrap, and disabled signup proof, while the pinned library exports account/user/session mutation endpoints such as `update-user`, `update-session`, `change-password`, account listing/linking, password reset, and native `/get-session`. The plan separately promises `/api/console/session` will omit session token/account fields (`contracts.md:21-23`), but native `/api/auth/get-session` returns the parsed library session/user object.

Evidence:

- Plan routes native auth broadly: `phase-03-authenticated-context.md:37`, `phase-03-authenticated-context.md:54`, `phase-03-authenticated-context.md:124`.
- Planned config does not set returned-field filtering for Better Auth session output: `phase-01-start.md:60-69`.
- Better Auth 1.7.4 route index exports user/session/account/password routes beyond sign-in/sign-out: upstream `packages/better-auth/src/api/routes/index.ts:1-12`.
- Better Auth 1.7.4 `/get-session` returns `{ session: parsedSession, user: parsedUser }`: upstream `packages/better-auth/src/api/routes/session.ts:29-71`, `session.ts:415-426`.
- Better Auth 1.7.4 core session schema includes `token`, `ipAddress`, `userAgent`, and `userId`: upstream `packages/core/src/db/get-tables.ts:130-190`.
- Better Auth 1.7.4 exposes `/update-user` and `/update-session` POST routes with session middleware: upstream `packages/better-auth/src/api/routes/update-user.ts:25-33`, `update-user.ts:120-143`, `packages/better-auth/src/api/routes/update-session.ts:17-24`, `update-session.ts:76-109`.

Impact: a signed-in browser can call unplanned native account/session routes that are not covered by the Nexus membership/action policy, and native session output can disclose token/session metadata that S4 intentionally keeps out of `GET /api/console/session`. This is not the current anonymous baseline; it is a plan contract gap introduced by the planned broad mount.

Minimal fix: replace the broad `/api/auth/*` pass-through with an explicit allowlist of required native endpoints, or add a wrapper that rejects unplanned native routes before `auth.handler`. Do not expose native `/get-session` to the Console UI; keep `GET /api/console/session` as the only session bootstrap. If native session routes remain exposed for client-library reasons, configure Better Auth session fields with `returned: false` for token/IP/user-agent where supported and add regression tests proving no session token/account rows are returned.

### High: auth/CSRF tests can validate the wrong trusted origin

Phase/section: `phase-01-start.md` Function checklist and `contracts.md` Origins.

Failure: the plan says local Console origin is `http://127.0.0.1:5173` and the Worker test origin is `https://local.invalid` (`contracts.md:36`). It also configures Better Auth `baseURL`/`trustedOrigins` from `env.CONSOLE_ORIGIN` (`phase-01-start.md:60-67`). But the Phase 1 auth fixture checklist says helpers send exact `https://local.invalid` origin (`phase-01-start.md:99`). Current worker test helpers build requests against `https://local.invalid` without an explicit browser `Origin` header (`tests/support/catalog-test-env.ts:120-134`).

Evidence:

- Canonical origin split: `contracts.md:36-38`.
- Phase 1 config trusts `env.CONSOLE_ORIGIN`: `phase-01-start.md:62-66`.
- Phase 1 fixture text requires `https://local.invalid` origin: `phase-01-start.md:99`.
- Existing helper URL is `https://local.invalid${path}` and currently injects only DB/FILES/STOREFRONT_ORIGIN/ASSETS, not `CONSOLE_ORIGIN` or an `Origin` header: `tests/support/catalog-test-env.ts:120-134`.
- Playwright Console origin defaults to `http://127.0.0.1:5173`: `playwright.config.ts:30-40`.

Impact: CSRF/origin tests can pass by trusting the Worker/request URL origin instead of the actual browser Console origin, or fail in a way that tempts implementers to add `https://local.invalid` to trusted origins. Either outcome weakens the "exact configured Console origin only" guarantee and risks false confidence on S4-23/S4-32.

Minimal fix: separate request URL origin from browser `Origin` in all auth/Console helpers. For direct Worker tests, keep request URL `https://local.invalid`, inject `CONSOLE_ORIGIN: 'http://127.0.0.1:5173'`, and set `Origin: http://127.0.0.1:5173` for allowed Console mutations/auth flows. Add negative cases for `Origin: https://local.invalid`, absent Origin, `Origin: null`, Storefront origin, and valid Origin with contradictory `Sec-Fetch-Site`.

### Medium: auto-added Order contract headers can mask auth-before-contract regressions

Phase/section: `phase-03-authenticated-context.md` error ordering and S4-38 old-client coverage.

Failure: Phase 3 correctly requires auth/private resource checks before Order contract-version disclosure (`phase-03-authenticated-context.md:40-41`, `phase-03-authenticated-context.md:60`). However, the shared test helper silently adds `X-Nexus-Order-Contract: 2` for every Console/Storefront Order request if absent (`tests/support/catalog-test-env.ts:120-128`). The plan asks to update this helper but does not explicitly require raw no-contract/old-contract paths for anonymous, revoked, cross-Store, and missing-Origin requests.

Evidence:

- Required error order: `phase-03-authenticated-context.md:60`.
- Required old anonymous client denial: `phase-03-authenticated-context.md:111-112`, `phase-03-authenticated-context.md:117-119`.
- Existing helper injects the accepted contract header: `tests/support/catalog-test-env.ts:120-128`.
- Current Console Order routes check contract headers before any future auth boundary because they are anonymous today: `apps/worker/src/console-order-routes.ts:145-148`, `console-order-routes.ts:154-163`, `console-order-routes.ts:169-183`.

Impact: route tests built on the current helper can never prove that missing/stale contract headers do not preempt authentication, membership, origin, and concealment checks. An old anonymous client could still receive a `409 client_contract_outdated` instead of `401/403/404`, which leaks that the path/resource family is recognized and violates the planned canonical order.

Minimal fix: add a raw request helper that never injects contract headers, and require Phase 3/5/6 route matrices to cover missing header, stale header, valid header, and malformed header across anonymous, signed-in wrong Store, revoked member, and authorized caller. Assert auth/membership/origin/concealed 404 wins before 409 except after the caller is authorized to learn the target route/resource.

## Non-findings / verified coverage

- The plan correctly distinguishes existing anonymous bootstrap insecurity from planned S4 work; I did not flag current missing auth as a plan flaw.
- The plan preserves the three accepted product decisions: assigned-only Staff Orders, Staff read-only Products, and one terminal Refund Request with no S5 money movement (`plan.md:19-23`, `contracts.md:7-12`, `phase-06-refund-decisions.md:30-33`).
- Phase 5/6 substantially cover replay/recovery authorization branches that the current source exposes (`packages/orders/src/persistence/command-store.ts:207-252`, `command-store.ts:254-299`; planned coverage at `phase-05-assigned-order-access.md:56-62`, `phase-06-refund-decisions.md:57-64`).
- I initially checked capability-bearing E2E artifacts, but the latest Phase 7 plan now explicitly owns trace/video/HAR suppression and sanitized diagnostics for credential/capability handling (`phase-07-role-aware-experience.md:113`, `phase-07-role-aware-experience.md:140`). No finding remains there.

## Recommended actions

1. Add an auth route allowlist / native response redaction requirement before Phase 1/3 execution.
2. Correct Phase 1/3 test origin semantics so `CONSOLE_ORIGIN` and direct Worker request URL are not conflated.
3. Add raw no-contract/old-contract route tests before relying on Phase 3/5/6 auth-order evidence.

Status: DONE_WITH_CONCERNS
Summary: Three concrete security/evidence flaws found in the plan; no code or plan files were modified other than this requested report.
Concerns: Membership cardinality remains unresolved by design; I did not treat that as a flaw because the plan labels it as pending clarification and fail-closed.
