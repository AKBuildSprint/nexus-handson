CREATE TABLE store_bootstrap_claims (
  store_id TEXT PRIMARY KEY NOT NULL CHECK (store_id = 'store_nexus'),
  membership_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT store_bootstrap_claims_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT store_bootstrap_claims_membership_fk
    FOREIGN KEY (membership_id, store_id) REFERENCES store_memberships(id, store_id),
  CONSTRAINT store_bootstrap_claims_user_fk FOREIGN KEY (user_id) REFERENCES "user"("id"),
  CONSTRAINT store_bootstrap_claims_membership_unique UNIQUE (membership_id),
  CONSTRAINT store_bootstrap_claims_user_unique UNIQUE (user_id)
);

CREATE TABLE owner_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL CHECK (store_id = 'store_nexus'),
  token_digest TEXT NOT NULL CHECK (
    length(token_digest) = 64
    AND token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  context_hmac TEXT NOT NULL CHECK (
    length(context_hmac) = 64
    AND context_hmac NOT GLOB '*[^0-9a-f]*'
    AND context_hmac != token_digest
  ),
  target_email TEXT NOT NULL CHECK (
    length(target_email) BETWEEN 3 AND 320
    AND target_email = lower(target_email)
  ),
  role TEXT NOT NULL CHECK (role = 'owner'),
  issuer_membership_id TEXT NOT NULL,
  issuer_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  consumed_at TEXT,
  consumed_membership_id TEXT,
  consumed_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT owner_invitations_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT owner_invitations_issuer_membership_fk
    FOREIGN KEY (issuer_membership_id, store_id) REFERENCES store_memberships(id, store_id),
  CONSTRAINT owner_invitations_issuer_user_fk FOREIGN KEY (issuer_user_id) REFERENCES "user"("id"),
  CONSTRAINT owner_invitations_consumed_membership_fk
    FOREIGN KEY (consumed_membership_id, store_id) REFERENCES store_memberships(id, store_id),
  CONSTRAINT owner_invitations_consumed_user_fk FOREIGN KEY (consumed_user_id) REFERENCES "user"("id"),
  CONSTRAINT owner_invitations_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT owner_invitations_state CHECK (
    (
      revoked_at IS NULL
      AND consumed_at IS NULL
      AND consumed_membership_id IS NULL
      AND consumed_user_id IS NULL
    )
    OR (
      revoked_at IS NOT NULL
      AND consumed_at IS NULL
      AND consumed_membership_id IS NULL
      AND consumed_user_id IS NULL
    )
    OR (
      revoked_at IS NULL
      AND consumed_at IS NOT NULL
      AND consumed_membership_id IS NOT NULL
      AND consumed_user_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX owner_invitations_token_digest_unique
  ON owner_invitations (token_digest);

CREATE UNIQUE INDEX owner_invitations_context_hmac_unique
  ON owner_invitations (context_hmac);

CREATE INDEX owner_invitations_pending_lookup_idx
  ON owner_invitations (store_id, token_digest, target_email, expires_at)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

CREATE INDEX owner_invitations_pending_context_idx
  ON owner_invitations (store_id, context_hmac, target_email, expires_at)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;
