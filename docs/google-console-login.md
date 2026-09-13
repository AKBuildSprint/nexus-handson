# Google Console login

Nexus uses Better Auth with Google as the only Console sign-in method. Google authenticates the person. The existing Nexus `store_memberships` row continues to select the Store, Owner/Staff role, and allowed actions.

## Google OAuth configuration

Create a Google OAuth client of type **Web application**. Register the exact Console origin and callback URL:

```text
Local origin:       http://127.0.0.1:5173
Local callback:     http://127.0.0.1:5173/api/auth/callback/google
Production callback: https://<console-origin>/api/auth/callback/google
```

Provide these server-side values without committing them:

```dotenv
BETTER_AUTH_SECRET=<at-least-32-random-characters>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
```

`CONSOLE_ORIGIN` in `wrangler.jsonc`, the browser origin, and the registered callback must match exactly. Do not expose the client secret through a `VITE_*` variable.

## Provision access

Provision each identity with its exact Google email, stable Google subject (`sub`), Store, and role:

```json
[
  {
    "email": "owner@example.com",
    "name": "Store Owner",
    "googleSubject": "<verified-google-sub>",
    "storeId": "store_nexus",
    "role": "owner"
  }
]
```

The Google subject must come from a verified Google authentication or trusted identity-administration process. Do not derive it from the email address and do not accept an unverified value supplied by the end user.

The provisioner creates the Better Auth user, prebinds `providerId=google` and `accountId=<sub>`, then creates the active Store membership. It creates no password. Migration `0011-google-account-binding-uniqueness.sql` enforces one Google subject per Nexus user and one Nexus user per Google subject. Repeating the exact input is a no-op; reusing a subject for another user, changing the bound subject, Store, or role fails closed.

Local provisioning remains dry-run-first and remote apply remains blocked. Supply the JSON through standard input or `NEXUS_S4_IDENTITIES_JSON`; do not put identity input or secrets in tracked files.

## Runtime behavior

The Console exposes only Google sign-in, the Google callback, and sign-out under `/api/auth`. Email/password signup and sign-in are unavailable. The callback must match a prebound Google subject, verified provider email, stored user email, and active membership. Every later Console request resolves the membership again, so revoking it removes access without changing the Google account.

Storefront routes do not require Google configuration. Automated tests stub the Google provider callback; a real Google consent smoke remains required before reporting a deployment ready.
