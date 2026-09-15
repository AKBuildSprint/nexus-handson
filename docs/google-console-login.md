# Google Console login

Nexus uses Better Auth with Google as the only Console sign-in method. Google authenticates the person. The existing Nexus `store_memberships` row continues to select the Store, Owner/Staff role, and allowed actions.

## Google OAuth configuration

Create a Google OAuth client of type **Web application**. Register the exact Console origin and callback URL:

```text
Local origin:        http://127.0.0.1:5173
Local callback:      http://127.0.0.1:5173/api/auth/callback/google
Production origin:   https://nexus-handson-console.cppai.workers.dev
Production callback: https://nexus-handson-console.cppai.workers.dev/api/auth/callback/google
```

Provide these server-side values without committing them:

```dotenv
BETTER_AUTH_SECRET=<at-least-32-random-characters>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
INITIAL_OWNER_EMAIL=<verified-google-email-for-first-owner>
```

`CONSOLE_ORIGIN` in `wrangler.jsonc`, the browser origin, and the registered callback must match exactly. Do not expose the client secret through a `VITE_*` variable. Production Google OAuth must use the `cppai.workers.dev` Console origin above before any deployment; the Worker does not deploy as part of this document.

## First owner bootstrap and invitations

After an empty production migration, the first Console owner is the verified Google identity whose email equals `INITIAL_OWNER_EMAIL`. That bootstrap can succeed only once for `store_nexus`. Later owners are admitted only through a one-time invitation created by an active Owner.

An Owner issues an invitation for one normalized Google email. The raw token appears only in the create response fragment (`/console/login#invite=…`) and in the recipient's same-origin `POST /api/auth/sign-in/social` body. The Worker validates that raw token, then stores a server-keyed HMAC context in Better Auth OAuth state. Better Auth verification storage must not contain the raw token. Admission consumes the stored HMAC context, not a client-supplied token or digest. Existing bound, Staff, or revoked identities cannot be invited, promoted, or revived.

Migration [`0012-store-bootstrap-and-owner-invitations.sql`](../migrations/0012-store-bootstrap-and-owner-invitations.sql) holds the one-time bootstrap claim and hashed invitation rows. Do not rewrite applied migrations.

## Provision access

The S4 identity provisioner remains available for local dry-run validation of already-bound Google subjects. It is not required for first-owner bootstrap or Owner invitations, and remote apply remains blocked.

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

The Console exposes only Google sign-in, the Google callback, and sign-out under `/api/auth`. Email/password signup and sign-in are unavailable. Unknown Google accounts are denied unless they complete the one-time `INITIAL_OWNER_EMAIL` bootstrap or redeem a valid invitation. A provisioned or previously admitted callback must still match a bound Google subject, verified provider email, stored user email, and active membership. Every later Console request resolves the membership again, so revoking it removes access without changing the Google account.

On visibility, back-forward restoration, or a sibling-tab auth change, the Console hides and disables private content while checking the session. If the user, Store, role, and allowed actions are unchanged, Product drafts, selected delivery files, and CSV work remain mounted. A changed identity or access scope discards that state. Product save continuations wait for the session check before applying an acknowledgement or sending the next step.

A private endpoint returning `401` or `store_access_denied`, including CSV template download, clears the rendered identity and returns to sign-in. An older identity's delayed response cannot clear or restore the current identity.

Assignment and Refund decision commands save only pending action identifiers and the original idempotency key in this tab's `sessionStorage`, scoped to the verified user ID, Store ID, and role. Reload first resolves the session and refetches the Order, then offers an explicit retry of the same intent/key; it never automatically submits the command. Unavailable recovery storage blocks these commands before dispatch. Sign-out, confirmed expiry/access loss, or a changed user/Store/role clears the pending metadata. Credentials, Customer payloads, and Order capabilities are not stored with it; current server authorization still governs every retry.

Storefront routes do not require Google configuration. Automated tests stub the Google provider callback; a real Google consent smoke remains required before reporting a deployment ready.
