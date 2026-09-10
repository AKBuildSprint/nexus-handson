# Google Console login

Nexus uses Better Auth for Google-only Console sign-in. Allowed Google accounts operate the existing Nexus store. There are no Owner/Staff roles or multiple-store memberships in this feature. Storefront product reads, order creation and private-order capabilities retain their existing contracts.

## Configure Google

Create a **Web application** OAuth client in Google Cloud and configure its consent screen. For an app in testing, add the intended Google accounts as test users. Register the exact Console origin as an authorized JavaScript origin and its `/api/auth/callback/google` URL as an authorized redirect URI.

For the repository's usual local Console address:

- Origin: `http://127.0.0.1:5173`
- Redirect URI: `http://127.0.0.1:5173/api/auth/callback/google`

For deployment, use the verified HTTPS API/Console origin returned by Wrangler. Do not use the distinct Storefront origin or guess a workers.dev hostname. The local browser address, `BETTER_AUTH_URL` and registered redirect must agree, including hostname and port.

Provider setup: [Better Auth Google documentation](https://better-auth.com/docs/authentication/google).

## Local configuration

Create an ignored `.dev.vars` file at the repository root with these values:

```dotenv
BETTER_AUTH_URL=http://127.0.0.1:5173
BETTER_AUTH_SECRET=<a cryptographically random secret of at least 32 characters>
GOOGLE_CLIENT_ID=<your Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
CONSOLE_ALLOWED_EMAILS=<comma-separated authorized Google email addresses>
```

Use exact email addresses. Comparison trims whitespace and ignores letter case; it does not expand domains, wildcards or Gmail aliases. Only verified Google emails are accepted. Empty/missing configuration leaves private access unavailable. Removing an email denies subsequent private requests even if that account still has a session.

Never put credentials into `VITE_*` variables, source, test fixtures, reports or commits. Restart the local Console server after changing `.dev.vars`. The root package scripts remain the command authority.

If Nexus displays “Google sign-in is not configured yet”, check that all five values above are present and nonempty, the secret has at least 32 characters, and the URL is a valid Console origin. This message comes from the local server's configuration check, before any Google OAuth request; it is not a Google Audience or script error. The Google button remains visible but disabled until setup is ready. After restarting the server, select **Try again** to recheck readiness.

Before applying migration `0008-console-google-auth.sql`, export the existing local D1 database to an ignored backup location, then apply migrations through root Wrangler:

```powershell
New-Item -ItemType Directory -Force .artifacts/backups
npx wrangler d1 export nexus-s1-468cba-db --local --output .artifacts/backups/before-google-auth.sql
npx wrangler d1 migrations apply nexus-s1-468cba-db --local
npm run dev:console -- --host 127.0.0.1 --port 5173
```

Use a unique backup filename for subsequent migrations. The migration adds auth tables and indexes; it does not rewrite catalog, orders, payments or historical actors.

### Blank page after dependency or configuration changes

If HTML and API requests work but the page is blank, inspect the browser's module requests. Stale Vite dependency versions can leave React or Better Auth requests under `/@fs/.../.vite-console/deps/` pending. Stop the existing Console dev server, then run the following from the repository root to rebuild its dependency cache on the same port:

```powershell
npm run dev:console -- --host 127.0.0.1 --port 5173 --strictPort --force
```

Reload the browser after startup. This rebuilds development dependencies; it does not change D1 data or OAuth credentials. See [Vite's dependency cache option](https://vite.dev/config/dep-optimization-options#optimizedeps-force).

## Runtime behavior

Opening Console shows the Google sign-in screen until the server validates a session. Google consent returns to the requested Console destination. Sign-out revokes the D1 session. Sessions expire seven days after sign-in without sliding renewal. Private API requests validate the session and allowed email on every request; cookie caching is disabled. Session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS.

Successful Google sign-in refreshes the stored profile, including the verified email, while retaining the same Google account identity. After a Google email rename, update the allowlist to the new address and sign in again.

Returning to Console through the browser's back/forward cache clears a pending sign-in and rechecks the session before enabling sign-in or showing private content.

All `/api/console` routes are private, including reads, import/template routes and file uploads/deletes. `GET /api/console/session` returns only the user's ID, display name and email. Private writes require an `Origin` header equal to the configured Console origin. Scripts calling Console APIs now need an authorized session cookie and that Origin header for writes; the Order contract header is still required.

Private errors use the existing JSON error envelope: `401 authentication_required`, `403 access_denied` or `invalid_origin`, and `503 auth_not_configured` or `auth_unavailable`. Authenticated unknown routes retain `404`. Google sign-in, callback and sign-out are handled beneath `/api/auth`; other auth methods and account-management endpoints are not exposed.

New Console Order commands record the signed-in user's ID and a `user` actor. Old bootstrap history remains unchanged and labeled as historical demo activity. Every allowed user currently has the same store-operator capabilities; sign-in does not add Owner/Staff authorization.

## Deployment and verification

Configure the five environment values on the existing API Worker; use Wrangler secrets for credentials and the email list. Back up remote D1 before applying the appended migration, and deploy with the repository's existing Console deployment command. Storefront needs no Google credentials. This document does not claim a deployment.

Local tests should exercise real persisted sessions, expiry/revocation, denied emails, OAuth state validation, origin checks and existing Storefront behavior. They cannot prove real Google consent without a configured OAuth client. For a live check, sign in with an allowed account, reload a private route, sign out and retry its API; repeat with an unlisted account. Check the Console at 375px as well as desktop.

The existing Playwright journeys need an authenticated Console session. Save a local browser storage state under ignored `.artifacts/` after Google sign-in and set `PLAYWRIGHT_CONSOLE_STORAGE_STATE` to that file before `npm run test:e2e`. Never commit or publish storage-state files: they contain a session cookie. The session must match the API/Console origin and configured secret. Storefront fetch calls continue to omit credentials even when the same browser is used to check Console workflows.

The remote smoke runner and CSV recount script accept the authorized session's complete Cookie header through `NEXUS_CONSOLE_COOKIE`. They attach it only to their Console requests, supply the matching Origin, and omit it from captured evidence. Dry-run smoke validation does not require a cookie. Never paste the cookie into a report or commit; these scripts still require the existing deployment/fixture authorization before execution.
